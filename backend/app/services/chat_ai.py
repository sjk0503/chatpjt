from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any

from ..db import db_conn, fetch_all, fetch_one
from .ai import AiResult, process_message
from .gpt_client import GptError, ToolCall, call_gpt_with_tools, parse_json_from_model


@dataclass(frozen=True)
class ChatAiDecision:
    category: str | None
    needs_human: bool
    response: str
    wait_time_minutes: int | None = None
    reason: str | None = None
    complete: bool = False
    summary: str | None = None


def _logger() -> logging.Logger:
    return logging.getLogger("uvicorn.error")


def _debug_enabled() -> bool:
    return str(os.getenv("GPT_DEBUG") or "").lower() in ("1", "true", "yes", "y")


def _format_conversation(rows: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for r in rows:
        sender = (r.get("sender_type") or "").strip()
        if sender == "user":
            prefix = "고객"
        else:
            # 고객에게는 AI/상담원 구분이 없어야 하므로, 단순히 '상담'으로 표기
            prefix = "상담"
        content = (r.get("content") or "").strip()
        if content:
            lines.append(f"{prefix}: {content}")
    return "\n".join(lines).strip()


def _looks_like_order_number(text: str) -> bool:
    upper = text.upper()
    if re.search(r"\bORD[- ]?\d{4}[- ]?\d+\b", upper):
        return True
    if re.search(r"\b\d{8,}\b", text):
        return True
    return False


def _refund_info_complete(conversation_rows: list[dict[str, Any]]) -> bool:
    # 환불 처리 대기(pending)로 넘기기 전에 최소한 주문번호/사유는 확보하도록 강제한다.
    text = "\n".join([(r.get("content") or "") for r in conversation_rows])
    has_order = _looks_like_order_number(text)
    has_reason = any(k in text for k in ["사유", "이유", "하자", "불량", "변심", "오배송", "파손", "반품", "취소"])
    return bool(has_order and has_reason)


def _strip_wait_message(text: str, wait_time_minutes: int) -> str:
    pat = re.compile(rf"\s*확인\s*후\s*{wait_time_minutes}\s*분\s*이내\s*답변드리겠습니다\.?\s*", re.MULTILINE)
    out = re.sub(pat, "\n", text).strip()
    return out


def _user_says_no_more(conversation_rows: list[dict[str, Any]]) -> bool:
    # 마지막 발화가 사용자이며 “더 이상 없음”을 명시하는지 확인
    last = conversation_rows[-1] if conversation_rows else {}
    if (last.get("sender_type") or "") != "user":
        return False
    last_user = (last.get("content") or "").strip().lower()
    if not last_user:
        return False
    # 종결 의사 표현 패턴(단순 부정 “아니요”는 제외)
    negative_patterns = [
        r"이상\s*없(습니다|어요|다)",
        r"더\s*없(습니다|어요|다)",
        r"없(습니다|어요|다)",
        r"괜찮(습니다|아요|다)",
        r"끝입니다",
        r"끝이에요",
        r"끝",
        r"됐습니다",
        r"됐어요",
        r"no more",
        r"no thanks",
    ]
    return any(re.search(pat, last_user) for pat in negative_patterns)


def _tool_defs() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "get_order_by_number",
                "description": "주문번호로 단일 주문 정보를 조회한다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "order_number": {"type": "string", "description": "주문번호(예: ORD-2025-0001)"},
                    },
                    "required": ["order_number"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_recent_orders",
                "description": "특정 고객의 최근 주문을 조회한다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "customer_id": {"type": "string", "description": "주문자 ID (미지정 시 현재 고객)"},
                        "limit": {"type": "integer", "description": "가져올 최대 개수 (기본 5)", "minimum": 1, "maximum": 20},
                    },
                },
            },
        },
    ]


def _run_tool(tc: ToolCall, default_customer_id: str | None) -> dict[str, Any]:
    name = tc.name
    args = tc.arguments or {}
    with db_conn() as conn:
        if name == "get_order_by_number":
            order_no = str(args.get("order_number") or "").strip()
            if not order_no:
                return {"ok": False, "message": "order_number가 비어 있습니다."}
            row = fetch_one(
                conn,
                "SELECT id, order_number, product_name, customer_id, ordered_at, shipping_status, updated_at FROM orders WHERE order_number=%s",
                (order_no,),
            )
            if not row:
                return {"ok": False, "message": "주문을 찾을 수 없습니다."}
            return {"ok": True, "order": row}

        if name == "list_recent_orders":
            customer_id = str(args.get("customer_id") or default_customer_id or "").strip()
            limit = args.get("limit")
            try:
                limit_int = int(limit)
            except Exception:
                limit_int = 5
            if limit_int <= 0 or limit_int > 20:
                limit_int = 5
            if not customer_id:
                return {"ok": False, "message": "customer_id가 필요합니다."}
            rows = fetch_all(
                conn,
                "SELECT id, order_number, product_name, customer_id, ordered_at, shipping_status, updated_at "
                "FROM orders WHERE customer_id=%s ORDER BY ordered_at DESC LIMIT %s",
                (customer_id, limit_int),
            )
            return {"ok": True, "orders": rows}

    return {"ok": False, "message": f"알 수 없는 함수 호출: {name}"}


async def decide_ai_reply(
    *,
    session_id: str | None = None,
    user_message: str,
    conversation_rows: list[dict[str, Any]],
    current_category: str | None,
    settings: dict[str, Any],
    admin_instruction: str | None = None,
    customer_id: str | None = None,
    customer_profile: str | None = None,
) -> ChatAiDecision:
    """
    GPT 기반으로 다음 응답/상태 전환을 결정한다.
    - 실패 시 기존 규칙 기반(process_message)으로 fallback.
    """
    categories = settings.get("categories") or ["주문 문의", "환불 요청", "기술 지원", "계정 관리"]
    if not isinstance(categories, list) or not categories:
        categories = ["주문 문의", "환불 요청", "기술 지원", "계정 관리"]
    categories = [str(x) for x in categories]

    response_guidelines = str(settings.get("company_policy") or "")
    company_policy = response_guidelines  # legacy 변수명 호환(fallback에서 사용)
    farewell = str(settings.get("farewell") or "도움 필요하시면 언제든 말씀해주세요. 좋은 하루 보내세요.")
    human_rules = str(settings.get("human_intervention_rules") or "")
    response_wait_time = int(settings.get("response_wait_time") or 5)
    auto_close = bool(settings.get("auto_close") if settings.get("auto_close") is not None else True)

    # 최신 사용자 발화를 포함한 리스트를 만들어 모델/판단에 사용한다.
    conversation_for_reasoning = list(conversation_rows)
    conversation_for_reasoning.append({"sender_type": "user", "content": user_message})
    conversation = _format_conversation(conversation_for_reasoning)

    system = (
        "너는 한국어 고객 상담 채팅을 처리하는 상담 어시스턴트다.\n"
        "중요 규칙:\n"
        "  같은 말 반복하지 말고 절대 길게 답변하지 않는다. 고객에게 'AI', '상담원' 등 주체를 드러내지 말고, 자연스럽고 친절하게 상담 톤으로 답변한다.\n"
        "  제공한 정보 외에 모르는 내용은 절대 억지로라도 묻지 않고, 답하지 않는다.(이러한 부분이 사람이 필요한 상황)\n"
        "  필요한 정보만 알려준다. 응답 기준을 참고하되, 정책 전문을 길게 나열하지 말고 요약/적용해준다.\n"
        "  첫 대화에서 카테고리를 하나 선택한다. 가능한 값은 categories 중 하나(없으면 '기타').\n"
        "  대화 도중 초기에 설정한 카테고리와 달라지면 카테고리를 갱신한다.\n"
        "  환불/취소/반품과 같이 AI가 직접적으로 처리하지 못하고 사람이 처리해야 하는 응대인 경우 또는 사내 정책에 따른 사유인 경우:\n"
        "    바로 처리 대기(pending)로 넘기지 말고, 먼저 반드시 필요한 정보(주문번호, 환불/반품 사유, 구매 시점/수령 여부 등)를 질문해서 확보한다.\n"
        "    (정보가 필요 없을 때도 있을 수 있다는 점을 유의하고, 이미 제공한 정보는 반복 요청하지 않는다.)\n"
        "  환불 예시 답변:\n"
        "    고객) 안녕하세요. 환불 관련해서 문의드릴려고 연락드렸습니다.\n"
        "    응대) 네, 고객님 어떤 상품을 환불하고 싶으신지 주문번호 확인 부탁드립니다.\n"
        "    고객) xxxxx 입니다.\n"
        "    응대) (먼저 주문번호를 DB에서 조회한 후) 확인 감사드립니다. *** 상품 맞으신가요? 또는 주문번호가 조회되지 않으면 다시 확인 요청.\n"
        "  필요한 정보가 모두 확보된 뒤에만 needs_human=true로 설정한다.\n"
        "- needs_human=true인 경우 고객에게 반드시 아래 문장을 포함해 안내한다:\n"
        f"  '확인 후 {response_wait_time}분 이내 답변드리겠습니다.'\n"
        "- admin_instruction이 비어있지 않으면, 이는 사람이 내려준 최신 지침이다. 이 내용을 기반으로 고객에게 자연스럽게 안내하되, 그대로 복붙하지 말고 핵심만 반영해 답변한다. 이미 해결/안내가 끝났다면 추가 질문 없이 짧게 마무리한다.\n"
        "  정책에 대한 질문이 들어오면, 한 번에 모든 정책을 알려주지 않는다.\n"
        "  auto_close가 true이고 상담이 확실히 마무리된 경우에만 complete=true로 설정한다.\n"
        "  추가로 도울 필요가 없냐고 물어보고 고객이 없다고 했을 때 대화 종료.\n"
        "- 출력은 반드시 JSON만. 다른 텍스트 금지.\n"
        "출력 스키마:\n"
        "{\n"
        '  \"category\": \"카테고리 문자열\",\n'
        '  \"needs_human\": true|false,\n'
        '  \"response\": \"고객에게 보낼 응답\",\n'
        '  \"reason\": \"needs_human 판단 이유(선택)\",\n'
        '  \"complete\": true|false,\n'
        '  \"summary\": \"pending/complete 시 관리자용 요약(선택)\"\n'
        "}\n"
    )

    user = (
        f"categories: {categories}\n"
        f"current_category: {current_category or ''}\n"
        f"response_guidelines:\n{response_guidelines}\n\n"
        f"human_intervention_rules:\n{human_rules}\n\n"
        f"customer_profile:\n{(customer_profile or '').strip()}\n\n"
        f"auto_close: {auto_close}\n"
        f"admin_instruction: {(admin_instruction or '').strip()}\n\n"
        f"conversation:\n{conversation}\n\n"
        f"latest_user_message:\n{user_message.strip()}\n"
    )

    try:
        if _debug_enabled():
            _logger().info(f"[AI] engine=gpt request session_id={session_id or ''}")
        tools = _tool_defs()
        resp = await asyncio.to_thread(
            call_gpt_with_tools,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            tools=tools,
            model="gpt-5-mini",
            max_output_tokens=700,
        )

        if resp.tool_calls:
            tool_msgs: list[dict[str, Any]] = []
            for tc in resp.tool_calls:
                result = _run_tool(tc, customer_id)
                tool_msgs.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "name": tc.name,
                        "content": json.dumps(result, ensure_ascii=False),
                    }
                )
            follow_messages = [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
                {
                    "role": "assistant",
                    "content": resp.message_text or None,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.name, "arguments": json.dumps(tc.arguments, ensure_ascii=False)},
                        }
                        for tc in resp.tool_calls
                    ],
                },
                *tool_msgs,
            ]
            resp2 = await asyncio.to_thread(
                call_gpt_with_tools,
                messages=follow_messages,
                tools=tools,
                model="gpt-5-mini",
                max_output_tokens=700,
            )
            data = parse_json_from_model(resp2.message_text or resp.message_text)
        else:
            data = parse_json_from_model(resp.message_text)

        category_raw = str(data.get("category") or "").strip()
        category = category_raw if category_raw else None
        if category and category not in categories and category != "기타":
            category = None

        needs_human = bool(data.get("needs_human")) if isinstance(data.get("needs_human"), (bool, int)) else False
        response_text = str(data.get("response") or "").strip()
        reason = str(data.get("reason") or "").strip() or None
        complete = bool(data.get("complete")) if isinstance(data.get("complete"), (bool, int)) else False
        summary = str(data.get("summary") or "").strip() or None

        # 관리자 지침이 있으면 재대기시키지 않고 바로 안내하도록 한다.
        if admin_instruction:
            needs_human = False
            reason = None

        if not response_text:
            raise GptError("GPT 응답(response)이 비어 있습니다.")

        # 환불 요청은 필요한 정보 수집 전에는 pending(=needs_human)으로 보내지 않는다.
        effective_category = category or current_category
        if effective_category == "환불 요청" and needs_human and not _refund_info_complete(conversation_rows):
            needs_human = False
            reason = None
            summary = None
            response_text = _strip_wait_message(response_text, response_wait_time)

        # 고객이 명확히 “더 이상 없음”을 표현하면 후속 질문 없이 바로 종료 멘트로 마무리
        if _user_says_no_more(conversation_for_reasoning):
            complete = True
            needs_human = False
            reason = None
            response_text = farewell

        # 자동 종료는 고객이 명확히 “더 이상 없다”를 표현했을 때만 허용
        if complete:
            complete = _user_says_no_more(conversation_for_reasoning)

        if needs_human and f"{response_wait_time}분 이내" not in response_text:
            response_text = (response_text + f"\n\n확인 후 {response_wait_time}분 이내 답변드리겠습니다.").strip()

        if _debug_enabled():
            _logger().info(
                f"[AI] engine=gpt ok session_id={session_id or ''} needs_human={needs_human} complete={bool(complete and auto_close)}"
            )
        return ChatAiDecision(
            category=category,
            needs_human=needs_human,
            response=response_text,
            wait_time_minutes=response_wait_time if needs_human else None,
            reason=reason,
            complete=complete and auto_close,
            summary=summary,
        )
    except Exception as e:
        _logger().warning(f"[AI] engine=fallback session_id={session_id or ''} reason={type(e).__name__}: {str(e)[:180]}")
        # fallback: 기존 규칙 기반
        ai: AiResult = process_message(
            user_message,
            company_policy=company_policy,
            categories=list(categories),
            human_intervention_rules=human_rules,
            response_wait_time=response_wait_time,
        )
        return ChatAiDecision(
            category=ai.category,
            needs_human=ai.needs_human,
            response=ai.response,
            wait_time_minutes=ai.wait_time_minutes,
            reason=ai.reason,
            complete=False,
            summary=None,
        )
