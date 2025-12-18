from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AiResult:
    category: str
    needs_human: bool
    response: str
    wait_time_minutes: int | None = None
    reason: str | None = None


def _contains_any(text: str, keywords: list[str]) -> bool:
    lower = text.lower()
    return any(k.lower() in lower for k in keywords)


def classify_category(message: str, categories: list[str]) -> str:
    if _contains_any(message, ["환불", "취소", "반품"]):
        return "환불 요청" if "환불 요청" in categories else categories[0]
    if _contains_any(message, ["배송", "도착", "주문", "택배"]):
        return "주문 문의" if "주문 문의" in categories else categories[0]
    if _contains_any(message, ["로그인", "오류", "에러", "버그", "안 돼", "안돼"]):
        return "기술 지원" if "기술 지원" in categories else categories[0]
    if _contains_any(message, ["비밀번호", "계정", "가입", "인증"]):
        return "계정 관리" if "계정 관리" in categories else categories[0]
    return categories[0] if categories else "기타"


def needs_human_intervention(message: str, category: str, rules_text: str) -> tuple[bool, str | None]:
    if category == "환불 요청":
        return True, "환불 요청으로 사람 개입이 필요합니다."
    if _contains_any(message, ["불만", "화나", "최악", "환불해", "신고"]):
        return True, "고객 불만 표현으로 사람 개입이 필요합니다."
    # rules_text는 현재는 참고만 (실서비스에서는 LLM 룰 기반 판단)
    return False, None


def generate_response(message: str, *, company_policy: str, category: str, needs_human: bool, wait_time: int) -> str:
    if needs_human:
        return f"말씀해주신 내용은 확인 후 {wait_time}분 이내에 답변드리겠습니다. 잠시만 기다려주세요."
    if category == "주문 문의":
        return "주문번호를 알려주시면 배송 상태를 확인해드리겠습니다."
    if category == "기술 지원":
        return "불편을 드려 죄송합니다. 사용 중인 기기/브라우저와 오류 메시지를 알려주시면 빠르게 도와드릴게요."
    if category == "계정 관리":
        return "계정 관련 확인을 위해 가입 이메일과 본인 확인 정보를 알려주세요."
    if category == "환불 요청":
        return f"환불 정책은 아래와 같습니다:\n{company_policy}\n구매일과 주문번호를 알려주시면 확인해드릴게요."
    return "문의 내용을 확인했습니다. 추가로 필요한 정보가 있으신가요?"


def process_message(
    message: str,
    *,
    company_policy: str,
    categories: list[str],
    human_intervention_rules: str,
    response_wait_time: int,
) -> AiResult:
    category = classify_category(message, categories)
    needs_human, reason = needs_human_intervention(message, category, human_intervention_rules)
    response = generate_response(
        message,
        company_policy=company_policy,
        category=category,
        needs_human=needs_human,
        wait_time=response_wait_time,
    )
    return AiResult(
        category=category,
        needs_human=needs_human,
        response=response,
        wait_time_minutes=response_wait_time if needs_human else None,
        reason=reason,
    )

