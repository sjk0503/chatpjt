from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..db import db_conn, execute, fetch_all, fetch_one, json_dumps, json_loads
from ..schemas import ApiResponse, ChatbotSettingsOut, ChatbotSettingsUpdate, UserOut
from .auth import get_current_user

router = APIRouter(prefix="/api/admin/chatbot", tags=["chatbot"])


DEFAULT_SETTINGS: dict[str, Any] = {
    "greeting": "안녕하세요! 채팅 상담 서비스입니다. 무엇을 도와드릴까요?",
    "farewell": "상담이 완료되었습니다. 좋은 하루 되세요!",
    "company_policy": "환불은 구매 후 7일 이내에 가능합니다.\n배송비는 고객 부담입니다.\n제품 하자의 경우 무료 교환이 가능합니다.",
    "categories": ["주문 문의", "환불 요청", "기술 지원", "계정 관리"],
    "human_intervention_rules": "고객이 환불을 요청하는 경우\n기술적 문제 해결이 어려운 경우\n고객이 불만을 표현하는 경우",
    "response_wait_time": 5,
    "auto_close": True,
}


def _require_admin(user: UserOut) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="관리자만 접근할 수 있습니다.")


def get_settings_map(conn) -> dict[str, Any]:
    rows = fetch_all(conn, "SELECT setting_key, setting_value FROM chatbot_settings", ())
    data: dict[str, Any] = dict(DEFAULT_SETTINGS)
    for r in rows:
        key = r["setting_key"]
        val = r["setting_value"]
        if key in ("categories",):
            data[key] = json_loads(val) or DEFAULT_SETTINGS[key]
        elif key in ("response_wait_time",):
            try:
                data[key] = int(val)
            except Exception:
                data[key] = DEFAULT_SETTINGS[key]
        elif key in ("auto_close",):
            data[key] = str(val).lower() in ("1", "true", "yes", "y")
        else:
            data[key] = val
    return data


def _upsert_setting(conn, key: str, value: str, updated_by: str | None) -> None:
    exists = fetch_one(conn, "SELECT id FROM chatbot_settings WHERE setting_key=%s", (key,))
    if exists:
        execute(
            conn,
            "UPDATE chatbot_settings SET setting_value=%s, updated_by=%s WHERE setting_key=%s",
            (value, updated_by, key),
        )
    else:
        execute(
            conn,
            "INSERT INTO chatbot_settings (setting_key, setting_value, updated_by) VALUES (%s,%s,%s)",
            (key, value, updated_by),
        )


@router.get("/settings", response_model=ApiResponse)
def get_settings(current_user: UserOut = Depends(get_current_user)) -> ApiResponse:
    _require_admin(current_user)
    with db_conn() as conn:
        data = get_settings_map(conn)
    out = ChatbotSettingsOut(**data)
    return ApiResponse(success=True, data=out.model_dump())


@router.put("/settings", response_model=ApiResponse)
def update_settings(payload: ChatbotSettingsUpdate, current_user: UserOut = Depends(get_current_user)) -> ApiResponse:
    _require_admin(current_user)
    with db_conn() as conn:
        current = get_settings_map(conn)

        greeting = payload.greeting if payload.greeting is not None else current.get("greeting")
        farewell = payload.farewell if payload.farewell is not None else current.get("farewell")
        company_policy = payload.company_policy if payload.company_policy is not None else current.get("company_policy")

        categories_raw = payload.categories if payload.categories is not None else current.get("categories") or []
        categories = [c.strip() for c in categories_raw if isinstance(c, str) and c.strip()]
        if not categories:
            categories = DEFAULT_SETTINGS["categories"]

        human_rules = (
            payload.human_intervention_rules
            if payload.human_intervention_rules is not None
            else current.get("human_intervention_rules")
        )

        wait_time = payload.response_wait_time if payload.response_wait_time is not None else current.get("response_wait_time", 5)
        try:
            wait_time_int = int(wait_time)
        except Exception:
            wait_time_int = 5
        if wait_time_int <= 0:
            wait_time_int = 5

        auto_close = payload.auto_close if payload.auto_close is not None else current.get("auto_close", True)
        auto_close_bool = bool(auto_close)

        _upsert_setting(conn, "greeting", greeting, current_user.id)
        _upsert_setting(conn, "farewell", farewell, current_user.id)
        _upsert_setting(conn, "company_policy", company_policy, current_user.id)
        _upsert_setting(conn, "categories", json_dumps(categories), current_user.id)
        _upsert_setting(conn, "human_intervention_rules", human_rules, current_user.id)
        _upsert_setting(conn, "response_wait_time", str(wait_time_int), current_user.id)
        _upsert_setting(conn, "auto_close", "true" if auto_close_bool else "false", current_user.id)
    return ApiResponse(success=True, message="설정이 저장되었습니다.")
