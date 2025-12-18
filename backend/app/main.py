from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketDisconnect

from .config import load_settings
from .routes import admin, auth, chatbot, chats
from .security import decode_token
from .ws import manager


def create_app() -> FastAPI:
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"), override=False)
    settings = load_settings()

    app = FastAPI(title="ai3pjt-backend", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins or ["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)
    app.include_router(chats.router)
    app.include_router(admin.router)
    app.include_router(chatbot.router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        token = websocket.query_params.get("token")
        if not token:
            await websocket.close(code=4401)
            return
        try:
            payload = decode_token(token)
        except Exception:
            await websocket.close(code=4401)
            return
        user_id = str(payload.get("sub") or "")
        role = str(payload.get("role") or "")
        if not user_id or role not in ("customer", "admin"):
            await websocket.close(code=4401)
            return

        await manager.connect(websocket, user_id=user_id, role=role)
        try:
            while True:
                msg = await websocket.receive_json()
                msg_type = msg.get("type")
                data = msg.get("data") or {}

                if msg_type == "subscribe_chats" and role == "admin":
                    chat_type = str(data.get("chat_type") or "")
                    if chat_type in ("active", "pending", "completed"):
                        await manager.set_subscription(websocket, chat_type)
                elif msg_type == "typing":
                    # 현재는 서버 단에서 별도 브로드캐스트하지 않음
                    continue
                elif msg_type == "agent_message" and role == "admin":
                    # 프론트가 WS로 보내도 되지만, 저장은 REST(/api/chats/messages)로 통일 권장
                    # 여기서는 클라이언트에게 "받았다" 정도의 최소 ACK만 제공
                    await websocket.send_json({"type": "ack", "data": {"ok": True}})
                elif msg_type == "send_message" and role == "customer":
                    await websocket.send_json({"type": "ack", "data": {"ok": True}})
                else:
                    await websocket.send_json({"type": "error", "data": {"message": "지원하지 않는 이벤트입니다."}})
        except WebSocketDisconnect:
            pass
        finally:
            await manager.disconnect(websocket)

    return app


app = create_app()
