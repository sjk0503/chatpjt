from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..db import db_conn, execute, fetch_all, fetch_one, json_dumps, json_loads, utc_now
from ..schemas import ApiResponse, MessageOut, SendMessageRequest, SessionOut, UserOut
from ..services.ai import process_message
from ..ws import manager
from .auth import get_current_user
from .chatbot import get_settings_map

router = APIRouter(prefix="/api/chats", tags=["chats"])


def _dt_to_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _to_message_out(row: dict) -> MessageOut:
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
    )


def _to_session_out(row: dict) -> SessionOut:
    started_at = row.get("started_at")
    if isinstance(started_at, datetime) and started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    return SessionOut(
        id=row["id"],
        customer_id=row["customer_id"],
        category=row.get("category"),
        status=row["status"],
        handler_type=row["handler_type"],
        assigned_agent_id=row.get("assigned_agent_id"),
        started_at=started_at,
    )


@router.get("/session", response_model=ApiResponse)
async def get_or_create_session(current_user: UserOut = Depends(get_current_user)) -> ApiResponse:
    if current_user.role != "customer":
        raise HTTPException(status_code=403, detail="고객만 접근할 수 있습니다.")

    with db_conn() as conn:
        session = fetch_one(
            conn,
            "SELECT * FROM chat_sessions WHERE customer_id=%s AND status IN ('active','pending') ORDER BY started_at DESC LIMIT 1",
            (current_user.id,),
        )
        if session:
            messages = fetch_all(
                conn,
                "SELECT * FROM messages WHERE session_id=%s ORDER BY created_at ASC",
                (session["id"],),
            )
            return ApiResponse(
                success=True,
                data={
                    "session": _to_session_out(session).model_dump(),
                    "messages": [_to_message_out(m).model_dump() for m in messages],
                },
            )

        session_id = uuid.uuid4().hex
        now = utc_now()
        execute(
            conn,
            "INSERT INTO chat_sessions (id, customer_id, status, handler_type, started_at) VALUES (%s,%s,'active','ai',%s)",
            (session_id, current_user.id, now),
        )
        execute(
            conn,
            "INSERT INTO chat_session_metadata (session_id, unread_count, last_message, last_message_at, priority, wait_time_minutes) VALUES (%s,0,NULL,NULL,'medium',0)",
            (session_id,),
        )

        settings = get_settings_map(conn)
        greeting = settings.get("greeting") or "안녕하세요! 채팅 상담 서비스입니다. 무엇을 도와드릴까요?"
        msg_id = uuid.uuid4().hex
        execute(
            conn,
            "INSERT INTO messages (id, session_id, sender_type, sender_id, content, attachments, is_read, created_at) VALUES (%s,%s,'ai',NULL,%s,NULL,TRUE,%s)",
            (msg_id, session_id, greeting, now),
        )
        execute(
            conn,
            "UPDATE chat_session_metadata SET last_message=%s, last_message_at=%s WHERE session_id=%s",
            (greeting, now, session_id),
        )

        session_row = fetch_one(conn, "SELECT * FROM chat_sessions WHERE id=%s", (session_id,))
        messages = fetch_all(conn, "SELECT * FROM messages WHERE session_id=%s ORDER BY created_at ASC", (session_id,))

    return ApiResponse(
        success=True,
        data={
            "session": _to_session_out(session_row).model_dump() if session_row else {"id": session_id},
            "messages": [_to_message_out(m).model_dump() for m in messages],
        },
    )


@router.post("/messages", response_model=ApiResponse)
async def send_message(req: SendMessageRequest, current_user: UserOut = Depends(get_current_user)) -> ApiResponse:
    content = req.content.strip()
    if not content:
        return ApiResponse(success=False, message="메시지 내용이 비어있습니다.")

    with db_conn() as conn:
        session = fetch_one(conn, "SELECT * FROM chat_sessions WHERE id=%s", (req.session_id,))
        if not session:
            return ApiResponse(success=False, message="세션을 찾을 수 없습니다.")

        if current_user.role == "customer" and session["customer_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")

        sender_type = "user" if current_user.role == "customer" else "agent"
        msg_id = uuid.uuid4().hex
        now = utc_now()
        execute(
            conn,
            "INSERT INTO messages (id, session_id, sender_type, sender_id, content, attachments, is_read, created_at) VALUES (%s,%s,%s,%s,%s,%s,FALSE,%s)",
            (
                msg_id,
                req.session_id,
                sender_type,
                current_user.id,
                content,
                json_dumps(req.attachments or []) if req.attachments is not None else None,
                now,
            ),
        )
        execute(
            conn,
            "UPDATE chat_session_metadata SET last_message=%s, last_message_at=%s WHERE session_id=%s",
            (content, now, req.session_id),
        )
        if sender_type == "user":
            execute(
                conn,
                "UPDATE chat_session_metadata SET unread_count = unread_count + 1 WHERE session_id=%s",
                (req.session_id,),
            )

        message_row = fetch_one(conn, "SELECT * FROM messages WHERE id=%s", (msg_id,))
        message_out = _to_message_out(message_row).model_dump() if message_row else {"id": msg_id, "content": content}

        await manager.send_to_user(session["customer_id"], {"type": "new_message", "data": {"message": message_out}})
        await manager.broadcast_to_admins(
            {"type": "new_message", "data": {"session_id": req.session_id, "message": message_out}},
            require_subscription=session["status"],
        )
        if sender_type == "user":
            await manager.broadcast_to_admins(
                {"type": "customer_message", "data": {"session_id": req.session_id, "message": message_out}},
                require_subscription=session["status"],
            )
            meta = fetch_one(conn, "SELECT unread_count FROM chat_session_metadata WHERE session_id=%s", (req.session_id,))
            await manager.broadcast_to_admins(
                {"type": "unread_count_updated", "data": {"session_id": req.session_id, "unread_count": int((meta or {}).get('unread_count') or 0)}},
                require_subscription=session["status"],
            )

        if sender_type == "agent":
            # 상담원 메시지는 여기서 종료
            return ApiResponse(success=True, data={"message": message_out})

        if session["handler_type"] == "agent":
            return ApiResponse(success=True, data={"message": message_out})

        settings = get_settings_map(conn)
        categories = json_loads(settings.get("categories")) or ["주문 문의", "환불 요청", "기술 지원", "계정 관리"]
        company_policy = settings.get("company_policy") or ""
        human_rules = settings.get("human_intervention_rules") or ""
        response_wait_time = int(settings.get("response_wait_time") or 5)

        ai = process_message(
            content,
            company_policy=company_policy,
            categories=list(categories),
            human_intervention_rules=human_rules,
            response_wait_time=response_wait_time,
        )

        if session.get("category") is None and ai.category:
            execute(conn, "UPDATE chat_sessions SET category=%s WHERE id=%s", (ai.category, req.session_id))

        next_admin_bucket = "active"
        if ai.needs_human and session["status"] != "pending":
            execute(
                conn,
                "UPDATE chat_sessions SET status='pending', pending_at=%s WHERE id=%s",
                (now, req.session_id),
            )
            next_admin_bucket = "pending"
            await manager.broadcast_to_admins(
                {
                    "type": "session_status_changed",
                    "data": {"session_id": req.session_id, "status": "pending", "handler_type": "ai"},
                }
            )
            customer = fetch_one(conn, "SELECT email FROM users WHERE id=%s", (session["customer_id"],))
            await manager.broadcast_to_admins(
                {
                    "type": "new_chat_session",
                    "data": {
                        "session": {
                            "id": req.session_id,
                            "customer_name": (customer or {}).get("email"),
                            "category": ai.category,
                            "started_at": _dt_to_iso(session.get("started_at")),
                        }
                    },
                },
                require_subscription="pending",
            )

        ai_msg_id = uuid.uuid4().hex
        execute(
            conn,
            "INSERT INTO messages (id, session_id, sender_type, sender_id, content, attachments, is_read, created_at) VALUES (%s,%s,'ai',NULL,%s,NULL,TRUE,%s)",
            (ai_msg_id, req.session_id, ai.response, now),
        )
        execute(
            conn,
            "UPDATE chat_session_metadata SET last_message=%s, last_message_at=%s WHERE session_id=%s",
            (ai.response, now, req.session_id),
        )
        ai_row = fetch_one(conn, "SELECT * FROM messages WHERE id=%s", (ai_msg_id,))
        ai_out = _to_message_out(ai_row).model_dump() if ai_row else {"id": ai_msg_id, "content": ai.response}

    await manager.send_to_user(session["customer_id"], {"type": "new_message", "data": {"message": ai_out}})
    await manager.broadcast_to_admins(
        {"type": "new_message", "data": {"session_id": req.session_id, "message": ai_out}},
        require_subscription=next_admin_bucket,
    )
    return ApiResponse(success=True, data={"message": message_out})


@router.get("/messages/{session_id}", response_model=ApiResponse)
def list_messages(session_id: str, current_user: UserOut = Depends(get_current_user)) -> ApiResponse:
    with db_conn() as conn:
        session = fetch_one(conn, "SELECT * FROM chat_sessions WHERE id=%s", (session_id,))
        if not session:
            return ApiResponse(success=False, message="세션을 찾을 수 없습니다.")
        if current_user.role == "customer" and session["customer_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")
        if current_user.role == "admin":
            execute(conn, "UPDATE chat_session_metadata SET unread_count=0 WHERE session_id=%s", (session_id,))
            execute(conn, "UPDATE messages SET is_read=TRUE WHERE session_id=%s AND sender_type='user'", (session_id,))
        messages = fetch_all(conn, "SELECT * FROM messages WHERE session_id=%s ORDER BY created_at ASC", (session_id,))
        return ApiResponse(success=True, data={"messages": [_to_message_out(m).model_dump() for m in messages]})
