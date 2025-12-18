from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..db import db_conn, execute, fetch_all, fetch_one, utc_now
from ..db import json_loads
from ..schemas import ApiResponse, CompleteRequest, MessageOut, ProvideInfoRequest, TakeoverRequest, UserOut
from ..services.ai import process_message
from ..ws import manager
from .auth import get_current_user
from .chatbot import get_settings_map

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _require_admin(user: UserOut) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="관리자만 접근할 수 있습니다.")


def _dt_to_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _to_message_out(row: dict) -> dict:
    created_at = row.get("created_at")
    if isinstance(created_at, datetime) and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return MessageOut(
        id=row["id"],
        session_id=row.get("session_id"),
        sender_type=row["sender_type"],
        sender_id=row.get("sender_id"),
        content=row["content"],
        attachments=json_loads(row.get("attachments")) if row.get("attachments") is not None else None,
        is_read=bool(row.get("is_read")) if row.get("is_read") is not None else None,
        created_at=created_at,
    ).model_dump()


@router.get("/chats/active", response_model=ApiResponse)
def list_active_chats(
    category: str = "all",
    search: str = "",
    current_user: UserOut = Depends(get_current_user),
) -> ApiResponse:
    _require_admin(current_user)
    search = (search or "").strip().lower()

    with db_conn() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT
              s.id,
              s.customer_id,
              u.email AS customer_name,
              s.category,
              m.last_message,
              m.last_message_at,
              s.handler_type,
              m.unread_count
            FROM chat_sessions s
            JOIN users u ON u.id = s.customer_id
            LEFT JOIN chat_session_metadata m ON m.session_id = s.id
            WHERE s.status='active'
            """,
            (),
        )

    def match(r: dict) -> bool:
        if category != "all" and (r.get("category") or "") != category:
            return False
        if search and search not in (r.get("customer_name") or "").lower():
            return False
        return True

    chats = []
    for r in rows:
        if not match(r):
            continue
        chats.append(
            {
                "id": r["id"],
                "customer_id": r["customer_id"],
                "customer_name": r.get("customer_name"),
                "category": r.get("category") or "미분류",
                "last_message": r.get("last_message") or "",
                "timestamp": _dt_to_iso(r.get("last_message_at")),
                "status": "agent" if r.get("handler_type") == "agent" else "ai",
                "unread": int(r.get("unread_count") or 0),
            }
        )
    return ApiResponse(success=True, data={"chats": chats})


@router.get("/chats/pending", response_model=ApiResponse)
def list_pending_chats(
    category: str = "all",
    search: str = "",
    current_user: UserOut = Depends(get_current_user),
) -> ApiResponse:
    _require_admin(current_user)
    search = (search or "").strip().lower()

    with db_conn() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT
              s.id,
              s.customer_id,
              u.email AS customer_name,
              s.category,
              s.pending_at,
              m.last_message,
              m.priority
            FROM chat_sessions s
            JOIN users u ON u.id = s.customer_id
            LEFT JOIN chat_session_metadata m ON m.session_id = s.id
            WHERE s.status='pending'
            """,
            (),
        )

    now = utc_now()
    chats = []
    for r in rows:
        if category != "all" and (r.get("category") or "") != category:
            continue
        if search and search not in (r.get("customer_name") or "").lower():
            continue
        pending_at: datetime | None = r.get("pending_at")
        if pending_at and pending_at.tzinfo is None:
            pending_at = pending_at.replace(tzinfo=timezone.utc)
        wait_minutes = 0
        if pending_at:
            wait_minutes = int((now - pending_at).total_seconds() // 60)
        chats.append(
            {
                "id": r["id"],
                "customer_id": r["customer_id"],
                "customer_name": r.get("customer_name"),
                "category": r.get("category") or "미분류",
                "issue": r.get("last_message") or "사람 개입이 필요합니다.",
                "wait_time": wait_minutes,
                "priority": (r.get("priority") or "medium"),
            }
        )
    return ApiResponse(success=True, data={"chats": chats})


@router.get("/chats/completed", response_model=ApiResponse)
def list_completed_chats(
    category: str = "all",
    handler: str = "all",
    dateRange: str = "all",
    search: str = "",
    current_user: UserOut = Depends(get_current_user),
) -> ApiResponse:
    _require_admin(current_user)
    search = (search or "").strip().lower()

    with db_conn() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT
              s.id,
              s.customer_id,
              u.email AS customer_name,
              s.category,
              s.handler_type,
              s.duration_minutes,
              s.completed_at,
              s.summary
            FROM chat_sessions s
            JOIN users u ON u.id = s.customer_id
            WHERE s.status='completed'
            ORDER BY s.completed_at DESC
            """,
            (),
        )

    chats = []
    cutoff: datetime | None = None
    if dateRange == "today":
        now = utc_now()
        cutoff = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif dateRange == "week":
        cutoff = utc_now() - timedelta(days=7)
    elif dateRange == "month":
        cutoff = utc_now() - timedelta(days=30)

    cutoff_aware: datetime | None = None
    if cutoff is not None:
        cutoff_aware = cutoff.replace(tzinfo=timezone.utc) if cutoff.tzinfo is None else cutoff

    for r in rows:
        if category != "all" and (r.get("category") or "") != category:
            continue
        handled_by = "AI" if r.get("handler_type") == "ai" else "상담원"
        if handler != "all" and handler != handled_by:
            continue
        if search and search not in (r.get("customer_name") or "").lower():
            continue
        completed_at = r.get("completed_at")
        if cutoff_aware and isinstance(completed_at, datetime):
            completed_at_aware = completed_at.replace(tzinfo=timezone.utc) if completed_at.tzinfo is None else completed_at
            if completed_at_aware < cutoff_aware:
                continue
        chats.append(
            {
                "id": r["id"],
                "customer_id": r["customer_id"],
                "customer_name": r.get("customer_name"),
                "category": r.get("category") or "미분류",
                "handled_by": handled_by,
                "duration": int(r.get("duration_minutes") or 0),
                "completed_at": _dt_to_iso(r.get("completed_at")),
                "summary": r.get("summary") or "",
            }
        )
    return ApiResponse(success=True, data={"chats": chats})


@router.post("/chats/{session_id}/takeover", response_model=ApiResponse)
async def takeover(
    session_id: str,
    req: TakeoverRequest,
    current_user: UserOut = Depends(get_current_user),
) -> ApiResponse:
    _require_admin(current_user)
    if req.agent_id != current_user.id:
        raise HTTPException(status_code=403, detail="agent_id가 현재 사용자와 일치하지 않습니다.")

    with db_conn() as conn:
        session = fetch_one(conn, "SELECT * FROM chat_sessions WHERE id=%s", (session_id,))
        if not session:
            return ApiResponse(success=False, message="세션을 찾을 수 없습니다.")
        execute(
            conn,
            "UPDATE chat_sessions SET handler_type='agent', assigned_agent_id=%s, status='active', pending_at=NULL WHERE id=%s",
            (current_user.id, session_id),
        )

    await manager.send_to_user(session["customer_id"], {"type": "agent_connected", "data": {"session_id": session_id, "message": "상담원이 연결되었습니다."}})
    await manager.broadcast_to_admins(
        {"type": "session_status_changed", "data": {"session_id": session_id, "status": "active", "handler_type": "agent"}}
    )
    return ApiResponse(success=True, message="상담원 모드로 전환되었습니다.")


@router.post("/chats/{session_id}/provide-info", response_model=ApiResponse)
async def provide_info(
    session_id: str,
    req: ProvideInfoRequest,
    current_user: UserOut = Depends(get_current_user),
) -> ApiResponse:
    _require_admin(current_user)
    now = utc_now()

    with db_conn() as conn:
        session = fetch_one(conn, "SELECT * FROM chat_sessions WHERE id=%s", (session_id,))
        if not session:
            return ApiResponse(success=False, message="세션을 찾을 수 없습니다.")

        settings = get_settings_map(conn)
        categories = settings.get("categories")
        company_policy = settings.get("company_policy") or ""
        human_rules = settings.get("human_intervention_rules") or ""
        wait_time = int(settings.get("response_wait_time") or 5)

        # pending → active로 복귀시키고 AI가 응답하도록 처리
        execute(conn, "UPDATE chat_sessions SET status='active', handler_type='ai' WHERE id=%s", (session_id,))
        ai = process_message(
            req.info,
            company_policy=company_policy,
            categories=list(categories) if isinstance(categories, list) else ["주문 문의", "환불 요청", "기술 지원", "계정 관리"],
            human_intervention_rules=human_rules,
            response_wait_time=wait_time,
        )

        msg_id = uuid.uuid4().hex
        execute(
            conn,
            "INSERT INTO messages (id, session_id, sender_type, sender_id, content, attachments, is_read, created_at) VALUES (%s,%s,'ai',NULL,%s,NULL,TRUE,%s)",
            (msg_id, session_id, ai.response, now),
        )
        execute(
            conn,
            "UPDATE chat_session_metadata SET last_message=%s, last_message_at=%s WHERE session_id=%s",
            (ai.response, now, session_id),
        )
        msg_row = fetch_one(conn, "SELECT * FROM messages WHERE id=%s", (msg_id,))
        message_out = _to_message_out(msg_row) if msg_row else {"id": msg_id, "content": ai.response}

    await manager.send_to_user(session["customer_id"], {"type": "new_message", "data": {"message": message_out}})
    await manager.broadcast_to_admins({"type": "session_status_changed", "data": {"session_id": session_id, "status": "active", "handler_type": "ai"}})
    return ApiResponse(success=True, message="AI에게 정보를 전달했습니다. AI가 고객에게 응답합니다.")


@router.post("/chats/{session_id}/complete", response_model=ApiResponse)
async def complete_chat(
    session_id: str,
    req: CompleteRequest,
    current_user: UserOut = Depends(get_current_user),
) -> ApiResponse:
    _require_admin(current_user)
    now = utc_now()

    with db_conn() as conn:
        session = fetch_one(conn, "SELECT * FROM chat_sessions WHERE id=%s", (session_id,))
        if not session:
            return ApiResponse(success=False, message="세션을 찾을 수 없습니다.")
        started_at: datetime | None = session.get("started_at")
        duration = 0
        if started_at:
            # DB는 naive datetime을 사용(backend/app/db.py의 utc_now 참고).
            # 드물게 tz-aware로 들어오는 경우가 있어도 duration 계산은 항상 UTC naive로 맞춘다.
            now_naive = now
            if now_naive.tzinfo is not None:
                now_naive = now_naive.astimezone(timezone.utc).replace(tzinfo=None)
            started_at_naive = started_at
            if started_at_naive.tzinfo is not None:
                started_at_naive = started_at_naive.astimezone(timezone.utc).replace(tzinfo=None)
            duration = int((now_naive - started_at_naive).total_seconds() // 60)
        execute(
            conn,
            "UPDATE chat_sessions SET status='completed', completed_at=%s, duration_minutes=%s, summary=%s WHERE id=%s",
            (now, duration, req.summary, session_id),
        )

        settings = get_settings_map(conn)
        farewell = settings.get("farewell") or "상담이 완료되었습니다. 좋은 하루 되세요!"
        msg_id = uuid.uuid4().hex
        execute(
            conn,
            "INSERT INTO messages (id, session_id, sender_type, sender_id, content, attachments, is_read, created_at) VALUES (%s,%s,'ai',NULL,%s,NULL,TRUE,%s)",
            (msg_id, session_id, farewell, now),
        )

    await manager.send_to_user(session["customer_id"], {"type": "session_completed", "data": {"session_id": session_id, "message": farewell}})
    await manager.broadcast_to_admins({"type": "session_status_changed", "data": {"session_id": session_id, "status": "completed", "handler_type": session.get("handler_type")}})
    return ApiResponse(success=True, message="상담이 종료되었습니다.")


@router.get("/chats/{session_id}/summary", response_model=ApiResponse)
def get_summary(session_id: str, current_user: UserOut = Depends(get_current_user)) -> ApiResponse:
    _require_admin(current_user)
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
            return ApiResponse(success=False, message="세션을 찾을 수 없습니다.")
        last_user_msg = fetch_one(
            conn,
            "SELECT content FROM messages WHERE session_id=%s AND sender_type='user' ORDER BY created_at DESC LIMIT 1",
            (session_id,),
        )

    core_summary = f"고객이 '{session.get('category') or '미분류'}' 관련 문의를 하고 있습니다."
    current_issues = []
    if session.get("category") == "주문 문의":
        current_issues.append("주문번호 미확인")
    if session.get("category") == "환불 요청":
        current_issues.append("구매일/주문번호 확인 필요")
    if last_user_msg and "오류" in (last_user_msg.get("content") or ""):
        current_issues.append("오류 내용 확인 필요")

    return ApiResponse(
        success=True,
        data={
            "summary": {
                "core_summary": core_summary,
                "current_issues": current_issues,
                "customer_info": {
                    "email": session.get("customer_email"),
                    "started_at": _dt_to_iso(session.get("started_at")),
                },
            }
        },
    )
