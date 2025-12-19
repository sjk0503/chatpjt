from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Request

from ..db import db_conn, execute, fetch_all, fetch_one, json_dumps, json_loads, utc_now
from ..schemas import ApiResponse, MessageOut, SendMessageRequest, SessionOut, UserOut
from ..services.chat_ai import decide_ai_reply
from ..services.chat_summary import build_completed_summary_text, build_pending_summary_text
from ..ws import manager
from .auth import get_current_user
from .chatbot import get_settings_map

router = APIRouter(prefix="/api/chats", tags=["chats"])
UPLOAD_MAX_BYTES = 20 * 1024 * 1024  # 20MB


def _uploads_dir() -> str:
    return os.path.join(os.path.dirname(__file__), "..", "..", "uploads")


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


@router.post("/upload", response_model=ApiResponse)
async def upload_file(
    request: Request,
    session_id: str = Form(...),
    file: UploadFile = File(...),
    current_user: UserOut = Depends(get_current_user),
) -> ApiResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="파일명이 비어 있습니다.")

    with db_conn() as conn:
        session = fetch_one(conn, "SELECT * FROM chat_sessions WHERE id=%s", (session_id,))
        if not session:
            raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
        if current_user.role == "customer" and session["customer_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")

    upload_dir = os.path.join(_uploads_dir(), session_id)
    os.makedirs(upload_dir, exist_ok=True)

    original_name = file.filename
    _, ext = os.path.splitext(original_name)
    saved_name = f"{uuid.uuid4().hex}{ext}"
    saved_path = os.path.join(upload_dir, saved_name)

    total = 0
    try:
        with open(saved_path, "wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > UPLOAD_MAX_BYTES:
                    raise HTTPException(status_code=400, detail="파일은 최대 20MB까지 업로드할 수 있습니다.")
                f.write(chunk)
    except Exception:
        if os.path.exists(saved_path):
            try:
                os.remove(saved_path)
            except Exception:
                pass
        raise

    is_image = (file.content_type or "").startswith("image/")
    base_url = str(request.base_url).rstrip("/")
    url = f"/uploads/{session_id}/{saved_name}"
    absolute_url = f"{base_url}{url}"
    attachment = {
        "url": absolute_url,
        "name": original_name,
        "size": total,
        "mime": file.content_type,
        "is_image": is_image,
    }
    return ApiResponse(success=True, data={"attachment": attachment})


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

        # pending/completed 상태에서는 AI가 추가 응답하지 않는다(사람/처리 대기 흐름 유지).
        if session["handler_type"] == "agent" or session["status"] != "active":
            return ApiResponse(success=True, data={"message": message_out})

        settings = get_settings_map(conn)
        conversation_rows = fetch_all(
            conn,
            "SELECT sender_type, content, created_at FROM messages WHERE session_id=%s ORDER BY created_at ASC",
            (req.session_id,),
        )
        admin_instruction_row = fetch_one(
            conn,
            "SELECT content FROM messages WHERE session_id=%s AND sender_type='agent' ORDER BY created_at DESC LIMIT 1",
            (req.session_id,),
        )
        admin_instruction = (admin_instruction_row or {}).get("content")
        customer_profile = ""
        try:
            user_row = fetch_one(conn, "SELECT email, name FROM users WHERE id=%s", (session.get("customer_id"),))
            if user_row:
                customer_profile = f"id={session.get('customer_id')}, email={user_row.get('email')}, name={user_row.get('name')}"
        except Exception:
            customer_profile = f"id={session.get('customer_id')}"

        decision = await decide_ai_reply(
            session_id=req.session_id,
            user_message=content,
            conversation_rows=conversation_rows,
            current_category=session.get("category"),
            settings=settings,
            customer_id=session.get("customer_id"),
            customer_profile=customer_profile,
            admin_instruction=admin_instruction,
        )

        if decision.category and decision.category != session.get("category"):
            execute(conn, "UPDATE chat_sessions SET category=%s WHERE id=%s", (decision.category, req.session_id))

        next_admin_bucket = "active"
        if decision.needs_human and session["status"] != "pending":
            execute(
                conn,
                "UPDATE chat_sessions SET status='pending', pending_at=%s WHERE id=%s",
                (now, req.session_id),
            )
            next_admin_bucket = "pending"
            # pending 요약은 항상 별도 요약기로 생성(모델이 summary에 'pending' 같은 값을 넣는 경우 방지)
            try:
                pending_summary = await build_pending_summary_text(req.session_id, latest_user_message=content)
            except Exception:
                pending_summary = ""
            if pending_summary:
                execute(conn, "UPDATE chat_sessions SET summary=%s WHERE id=%s", (pending_summary, req.session_id))
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
                            "category": decision.category,
                            "started_at": _dt_to_iso(session.get("started_at")),
                        }
                    },
                },
                require_subscription="pending",
            )

        # AI가 종료를 판단한 경우: 종료 멘트 + 세션 완료 처리(고객 입력 잠금/자동 로그아웃 UX 트리거)
        if decision.complete:
            completed_summary = (decision.summary or "").strip()
            if not completed_summary:
                try:
                    completed_summary = await build_completed_summary_text(req.session_id)
                except Exception:
                    completed_summary = ""

            started_at = session.get("started_at")
            duration = 0
            if started_at:
                now_naive = now.astimezone(timezone.utc).replace(tzinfo=None) if now.tzinfo is not None else now
                started_at_naive = (
                    started_at.astimezone(timezone.utc).replace(tzinfo=None) if started_at.tzinfo is not None else started_at
                )
                duration = int((now_naive - started_at_naive).total_seconds() // 60)

            execute(
                conn,
                "UPDATE chat_sessions SET status='completed', completed_at=%s, duration_minutes=%s, summary=%s WHERE id=%s",
                (now, duration, completed_summary or None, req.session_id),
            )

            ai_msg_id = uuid.uuid4().hex
            execute(
                conn,
                "INSERT INTO messages (id, session_id, sender_type, sender_id, content, attachments, is_read, created_at) VALUES (%s,%s,'ai',NULL,%s,NULL,TRUE,%s)",
                (ai_msg_id, req.session_id, decision.response, now),
            )
            execute(
                conn,
                "UPDATE chat_session_metadata SET last_message=%s, last_message_at=%s WHERE session_id=%s",
                (decision.response, now, req.session_id),
            )
            await manager.send_to_user(
                session["customer_id"],
                {"type": "session_completed", "data": {"session_id": req.session_id, "message": decision.response}},
            )
            await manager.broadcast_to_admins(
                {"type": "session_status_changed", "data": {"session_id": req.session_id, "status": "completed", "handler_type": "ai"}}
            )
            return ApiResponse(success=True, data={"message": message_out})

        ai_msg_id = uuid.uuid4().hex
        execute(
            conn,
            "INSERT INTO messages (id, session_id, sender_type, sender_id, content, attachments, is_read, created_at) VALUES (%s,%s,'ai',NULL,%s,NULL,TRUE,%s)",
            (ai_msg_id, req.session_id, decision.response, now),
        )
        execute(
            conn,
            "UPDATE chat_session_metadata SET last_message=%s, last_message_at=%s WHERE session_id=%s",
            (decision.response, now, req.session_id),
        )
        ai_row = fetch_one(conn, "SELECT * FROM messages WHERE id=%s", (ai_msg_id,))
        ai_out = _to_message_out(ai_row).model_dump() if ai_row else {"id": ai_msg_id, "content": decision.response}

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
