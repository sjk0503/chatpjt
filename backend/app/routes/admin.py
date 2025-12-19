from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..db import db_conn, execute, fetch_all, fetch_one, utc_now
from ..db import json_loads
from ..schemas import ApiResponse, CompleteRequest, MessageOut, ProvideInfoRequest, TakeoverRequest, UserOut
from ..services.chat_ai import decide_ai_reply
from ..services.chat_summary import build_admin_summary, build_completed_summary_text
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
              s.summary,
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
        if pending_at:
            pending_at_aware = pending_at.replace(tzinfo=timezone.utc) if pending_at.tzinfo is None else pending_at.astimezone(timezone.utc)
            now_aware = now.replace(tzinfo=timezone.utc) if now.tzinfo is None else now.astimezone(timezone.utc)
            wait_minutes = int((now_aware - pending_at_aware).total_seconds() // 60)
        else:
            wait_minutes = 0
        issue_preview = (r.get("summary") or "").strip() or (r.get("last_message") or "").strip() or "사람 개입이 필요합니다."
        chats.append(
            {
                "id": r["id"],
                "customer_id": r["customer_id"],
                "customer_name": r.get("customer_name"),
                "category": r.get("category") or "미분류",
                "issue": issue_preview,
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

    with db_conn() as conn:
        session = fetch_one(conn, "SELECT * FROM chat_sessions WHERE id=%s", (session_id,))
        if not session:
            return ApiResponse(success=False, message="세션을 찾을 수 없습니다.")

        # pending → active로 복귀시키고, 관리자 지침을 그대로 전달
        now = utc_now()
        execute(conn, "UPDATE chat_sessions SET status='active', handler_type='ai', pending_at=NULL WHERE id=%s", (session_id,))

        admin_reply = req.info.strip()
        msg_id = uuid.uuid4().hex
        execute(
            conn,
            "INSERT INTO messages (id, session_id, sender_type, sender_id, content, attachments, is_read, created_at) VALUES (%s,%s,'agent',NULL,%s,NULL,TRUE,%s)",
            (msg_id, session_id, admin_reply, now),
        )
        execute(
            conn,
            "UPDATE chat_session_metadata SET last_message=%s, last_message_at=%s WHERE session_id=%s",
            (admin_reply, now, session_id),
        )

        # 대화 맥락과 설정을 불러와 GPT로 실제 고객 응답을 생성
        messages = fetch_all(conn, "SELECT sender_type, content, created_at FROM messages WHERE session_id=%s ORDER BY created_at ASC", (session_id,))
        settings = get_settings_map(conn)
        customer_profile = ""
        try:
            user_row = fetch_one(conn, "SELECT email, name FROM users WHERE id=%s", (session.get("customer_id"),))
            if user_row:
                customer_profile = f"id={session.get('customer_id')}, email={user_row.get('email')}, name={user_row.get('name')}"
        except Exception:
            customer_profile = f"id={session.get('customer_id')}"

        last_user_row = fetch_one(
            conn,
            "SELECT content FROM messages WHERE session_id=%s AND sender_type='user' ORDER BY created_at DESC LIMIT 1",
            (session_id,),
        )
        last_user_message = (last_user_row or {}).get("content") or admin_reply

        decision = await decide_ai_reply(
            session_id=session_id,
            user_message=last_user_message,
            conversation_rows=messages,
            current_category=session.get("category"),
            settings=settings,
            customer_id=session.get("customer_id"),
            customer_profile=customer_profile,
            admin_instruction=admin_reply,
        )

        if decision.category and decision.category != session.get("category"):
            execute(conn, "UPDATE chat_sessions SET category=%s WHERE id=%s", (decision.category, session_id))

        # 종료 판단 시 완료 처리
        if decision.complete:
            try:
                completed_summary = await build_completed_summary_text(session_id)
            except Exception:
                completed_summary = decision.summary or ""

            started_at: datetime | None = session.get("started_at")
            duration = 0
            if started_at:
                now_naive = now.astimezone(timezone.utc).replace(tzinfo=None) if now.tzinfo is not None else now
                started_at_naive = started_at.astimezone(timezone.utc).replace(tzinfo=None) if started_at.tzinfo is not None else started_at
                duration = int((now_naive - started_at_naive).total_seconds() // 60)

            execute(
                conn,
                "UPDATE chat_sessions SET status='completed', completed_at=%s, duration_minutes=%s, summary=%s WHERE id=%s",
                (now, duration, completed_summary or None, session_id),
            )

            ai_msg_id = uuid.uuid4().hex
            execute(
                conn,
                "INSERT INTO messages (id, session_id, sender_type, sender_id, content, attachments, is_read, created_at) VALUES (%s,%s,'ai',NULL,%s,NULL,TRUE,%s)",
                (ai_msg_id, session_id, decision.response, now),
            )
            execute(
                conn,
                "UPDATE chat_session_metadata SET last_message=%s, last_message_at=%s WHERE session_id=%s",
                (decision.response, now, session_id),
            )
            ai_row = fetch_one(conn, "SELECT * FROM messages WHERE id=%s", (ai_msg_id,))
            ai_out = _to_message_out(ai_row) if ai_row else {"id": ai_msg_id, "content": decision.response}
        else:
            ai_msg_id = uuid.uuid4().hex
            execute(
                conn,
                "INSERT INTO messages (id, session_id, sender_type, sender_id, content, attachments, is_read, created_at) VALUES (%s,%s,'ai',NULL,%s,NULL,TRUE,%s)",
                (ai_msg_id, session_id, decision.response, now),
            )
            execute(
                conn,
                "UPDATE chat_session_metadata SET last_message=%s, last_message_at=%s WHERE session_id=%s",
                (decision.response, now, session_id),
            )
            ai_row = fetch_one(conn, "SELECT * FROM messages WHERE id=%s", (ai_msg_id,))
            ai_out = _to_message_out(ai_row) if ai_row else {"id": ai_msg_id, "content": decision.response}

    # 고객에게는 GPT가 생성한 응답만 전달한다.
    await manager.send_to_user(session["customer_id"], {"type": "new_message", "data": {"message": ai_out}})
    await manager.broadcast_to_admins({"type": "session_status_changed", "data": {"session_id": session_id, "status": "active", "handler_type": "ai"}})
    if decision.complete:
        await manager.send_to_user(session["customer_id"], {"type": "session_completed", "data": {"session_id": session_id, "message": decision.response}})
        await manager.broadcast_to_admins({"type": "session_status_changed", "data": {"session_id": session_id, "status": "completed", "handler_type": session.get("handler_type")}})
    else:
        await manager.broadcast_to_admins(
            {"type": "new_message", "data": {"session_id": session_id, "message": ai_out}},
            require_subscription="active",
        )

    return ApiResponse(success=True, message="AI에게 정보를 전달했습니다. AI가 고객에게 응답했습니다.")


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
        summary_text = (req.summary or "").strip()
        if not summary_text:
            # pydantic에서 min_length=1이라 보통 비어있지 않지만, 안전하게 fallback 처리
            summary_text = "상담이 종료되었습니다."
        # 가능하면 종료 요약을 GPT로 생성해 저장한다(실패 시 요청 값 유지).
        try:
            gpt_summary = await build_completed_summary_text(session_id)
            if (gpt_summary or "").strip():
                summary_text = gpt_summary.strip()
        except Exception:
            pass

        execute(
            conn,
            "UPDATE chat_sessions SET status='completed', completed_at=%s, duration_minutes=%s, summary=%s WHERE id=%s",
            (now, duration, summary_text, session_id),
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
async def get_summary(session_id: str, current_user: UserOut = Depends(get_current_user)) -> ApiResponse:
    _require_admin(current_user)
    try:
        s = await build_admin_summary(session_id)
        return ApiResponse(
            success=True,
            data={
                "summary": {
                    "core_summary": s.core_summary,
                    "current_issues": s.current_issues,
                    "customer_info": {"email": s.customer_email, "started_at": s.started_at},
                }
            },
        )
    except ValueError:
        return ApiResponse(success=False, message="세션을 찾을 수 없습니다.")

    return ApiResponse(
        success=True,
        data={
            "summary": {
                "core_summary": "상담 내용을 요약하는 중입니다.",
                "current_issues": [],
                "customer_info": {"email": None, "started_at": None},
            }
        },
    )
