from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from ..db import db_conn, fetch_all, fetch_one
from ..routes.chatbot import get_settings_map
from .gpt_client import GptError, call_gpt_text, parse_json_from_model


@dataclass(frozen=True)
class AdminSummary:
    core_summary: str
    current_issues: list[str]
    customer_email: str | None
    started_at: str | None


def _logger() -> logging.Logger:
    return logging.getLogger("uvicorn.error")


def _debug_enabled() -> bool:
    return str(os.getenv("GPT_DEBUG") or "").lower() in ("1", "true", "yes", "y")


def _dt_to_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _format_conversation(rows: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for r in rows:
        sender = r.get("sender_type") or "unknown"
        if _is_user(sender):
            prefix = "고객"
        else:
            # 고객에게는 AI/상담원 구분이 없어야 하므로, 요약에서도 단순히 '상담'으로 취급
            prefix = "상담"
        content = (r.get("content") or "").strip()
        if not content:
            continue
        lines.append(f"{prefix}: {content}")
    return "\n".join(lines).strip()


def _is_user(sender: str) -> bool:
    s = (sender or "").lower()
    return s in ("user", "customer")


def _debug_log_conversation(session_id: str, conversation: str, user_only: str, latest_user: str) -> None:
    if not _debug_enabled():
        return
    _logger().warning(
        f"[SUMMARY-PENDING] session={session_id} conversation={conversation[:4000]} | user_only={user_only[:1000]} | latest_user={latest_user}"
    )


def _debug_log_rows(session_id: str, rows: list[dict[str, Any]]) -> None:
    if not _debug_enabled():
        return
    preview = [
        {
          "sender": r.get("sender_type"),
          "content": (r.get("content") or "")[:200],
          "created_at": str(r.get("created_at")),
        }
        for r in rows
    ]
    _logger().warning(f"[SUMMARY-PENDING-ROWS] session={session_id} rows={preview}")


async def build_admin_summary(session_id: str) -> AdminSummary:
    with db_conn() as conn:
        session = fetch_one(
            conn,
            """
            SELECT s.id, s.customer_id, s.started_at, u.email AS customer_email, s.category
            FROM chat_sessions s
            JOIN users u ON u.id=s.customer_id
            WHERE s.id=%s
            """,
            (session_id,),
        )
        if not session:
            raise ValueError("세션을 찾을 수 없습니다.")

        settings = get_settings_map(conn)
        rows = fetch_all(
            conn,
            "SELECT sender_type, content, created_at FROM messages WHERE session_id=%s ORDER BY created_at ASC",
            (session_id,),
        )

    conversation = _format_conversation(rows)
    if latest_user_message and latest_user_message.strip():
        # 대화 목록에 아직 반영되지 않은 최신 사용자 발화를 포함
        conversation = (conversation + f"\n고객: {latest_user_message.strip()}").strip()
    categories = settings.get("categories") or []
    category = session.get("category") or "미분류"

    system = (
        "너는 고객 상담 내용을 관리자에게 보여줄 요약을 작성한다.\n"
        "대화 내용을 바탕으로 핵심 요약과 현재 이슈 목록을 간결하게 만들어라.\n"
        "반드시 JSON만 출력하라.\n"
        "출력 스키마:\n"
        "{\n"
        '  "core_summary": "한두 문장",\n'
        '  "current_issues": ["이슈1","이슈2"]\n'
        "}\n"
    )
    user = (
        f"카테고리 후보: {categories}\n"
        f"현재 카테고리: {category}\n\n"
        f"대화 내용:\n{conversation}\n"
    )

    try:
        if _debug_enabled():
            _logger().info(f"[SUMMARY] engine=gpt request session_id={session_id}")
        resp = await asyncio.to_thread(
            call_gpt_text,
            model="gpt-5-mini",
            system=system,
            user=user,
            max_output_tokens=500,
        )
        data = parse_json_from_model(resp.output_text)
        core = str(data.get("core_summary") or "").strip()
        issues = data.get("current_issues") if isinstance(data.get("current_issues"), list) else []
        issues_out = [str(x).strip() for x in issues if str(x).strip()]
        if not core:
            core = "상담 내용을 요약하는 중입니다."
        if _debug_enabled():
            _logger().info(f"[SUMMARY] engine=gpt ok session_id={session_id}")
        return AdminSummary(
            core_summary=core,
            current_issues=issues_out[:10],
            customer_email=session.get("customer_email"),
            started_at=_dt_to_iso(session.get("started_at")),
        )
    except GptError as e:
        _logger().warning(f"[SUMMARY] engine=fallback session_id={session_id} reason={str(e)[:180]}")
        # 최소 fallback
        last_user = ""
        for r in reversed(rows):
            if r.get("sender_type") == "user":
                last_user = (r.get("content") or "").strip()
                break
        return AdminSummary(
            core_summary=last_user or "상담 내용을 요약하는 중입니다.",
            current_issues=[],
            customer_email=session.get("customer_email"),
            started_at=_dt_to_iso(session.get("started_at")),
        )


async def build_pending_summary_text(session_id: str, latest_user_message: str | None = None) -> str:
    with db_conn() as conn:
        rows = fetch_all(
            conn,
            "SELECT sender_type, content, created_at FROM messages WHERE session_id=%s ORDER BY created_at ASC",
            (session_id,),
        )
    _debug_log_rows(session_id, rows)
    conversation = _format_conversation(rows)
    if latest_user_message and latest_user_message.strip():
        conversation = (conversation + f"\n고객: {latest_user_message.strip()}").strip()
    user_only_list = [
        (r.get("content") or "").strip()
        for r in rows
        if _is_user(r.get("sender_type") or "") and (r.get("content") or "").strip()
    ]
    if latest_user_message and latest_user_message.strip():
        user_only_list.append(latest_user_message.strip())
    user_only = "\n".join(user_only_list).strip()
    latest_user = ""
    for r in reversed(rows):
        if _is_user(r.get("sender_type") or "") and (r.get("content") or "").strip():
            latest_user = (r.get("content") or "").strip()
            break
    _debug_log_conversation(session_id, conversation, user_only, latest_user or latest_user_message or "")

    # 사용자 발화가 전혀 없으면 GPT를 호출하지 않고 안내만 반환
    if not user_only:
        return "사용자 문의가 아직 입력되지 않았습니다."

    system = (
        "너는 관리자에게 전달할 '처리 대기' 요약을 작성한다.\n"
        "- 반드시 '사용자 발화'를 기준으로 요약한다. 상담원/AI 발화는 참고만 한다.\n"
        "- 최근 사용자 메시지(예: \"로그인이 안돼요\")에 담긴 구체적 문제를 첫 문장에 넣고, 필요하면 이전 사용자 발화를 보태어 2~3문장으로 요약한다.\n"
        "- 인사/상담 의사 표현만 반복하지 말고, 구체적 문제를 summary에 포함한다.\n"
        "- 정책/매장 안내 등 템플릿성 문구는 요약에 넣지 않는다.\n"
        "- action_items는 대화에서 실제로 언급된 추가 확인 사항이 있을 때만 bullet로 적고, 없으면 빈 배열로 둔다.\n"
        "- JSON만 출력.\n"
        "출력 스키마:\n"
        "{\n"
        '  "summary": "요약(2~3문장)",\n'
        '  "action_items": ["확인할 것1","확인할 것2"]\n'
        "}\n"
    )
    user = (
        f"대화 내용:\n{conversation}\n"
        f"사용자 발화만 모아둔 목록(없으면 최근 메시지라도 포함):\n{user_only or '(사용자 발화 없음)'}\n"
        "위 대화를 근거로 작성하고, 불필요한 정책 나열은 넣지 말 것.\n"
        "summary에는 최신 사용자 메시지에서 언급한 구체적 요청/문제를 반드시 포함하고, 상담원/AI가 말한 내용은 참고만 할 것.\n"
    )

    try:
        resp = await asyncio.to_thread(
            call_gpt_text,
            model="gpt-5-mini",
            system=system,
            user=user,
            max_output_tokens=500,
        )
        data = parse_json_from_model(resp.output_text)
        summary = str(data.get("summary") or "").strip()
        items = data.get("action_items") if isinstance(data.get("action_items"), list) else []
        items_out = [str(x).strip() for x in items if str(x).strip()]
        if not summary:
            # summary가 비면 최신 사용자 메시지를 그대로 요약으로 활용
            summary = latest_user or "관리자 확인이 필요합니다."
        if items_out:
            bullets = "\n".join([f"- {x}" for x in items_out[:10]])
            return (summary + "\n" + bullets).strip()
        return summary
    except Exception:
        # fallback: 마지막 고객 메시지
        last_user = ""
        for r in reversed(rows):
            if r.get("sender_type") == "user":
                last_user = (r.get("content") or "").strip()
                break
        return last_user or "관리자 확인이 필요합니다."


async def build_completed_summary_text(session_id: str) -> str:
    with db_conn() as conn:
        settings = get_settings_map(conn)
        rows = fetch_all(
            conn,
            "SELECT sender_type, content, created_at FROM messages WHERE session_id=%s ORDER BY created_at ASC",
            (session_id,),
        )
    conversation = _format_conversation(rows)
    system = (
        "너는 상담 종료 요약을 작성한다.\n"
        "대화 전체를 보고, 핵심을 3~6줄 내로 요약해라.\n"
        "반드시 JSON만 출력하라.\n"
        "출력 스키마:\n"
        '{ "summary": "요약 텍스트(여러 줄 가능)" }\n'
    )
    user = (
        f"응답 기준:\n{settings.get('company_policy') or ''}\n\n"
        f"대화 내용:\n{conversation}\n"
    )

    try:
        resp = await asyncio.to_thread(
            call_gpt_text,
            model="gpt-5-mini",
            system=system,
            user=user,
            max_output_tokens=700,
        )
        data = parse_json_from_model(resp.output_text)
        summary = str(data.get("summary") or "").strip()
        return summary or "상담이 종료되었습니다."
    except Exception:
        return "상담이 종료되었습니다."
