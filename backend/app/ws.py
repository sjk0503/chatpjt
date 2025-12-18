from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from fastapi.encoders import jsonable_encoder
from starlette.websockets import WebSocket


@dataclass
class Client:
    websocket: WebSocket
    user_id: str
    role: str
    subscriptions: set[str] = field(default_factory=set)


class ConnectionManager:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._clients: dict[int, Client] = {}
        self._user_sockets: defaultdict[str, set[int]] = defaultdict(set)
        self._admin_sockets: set[int] = set()

    async def connect(self, websocket: WebSocket, *, user_id: str, role: str) -> int:
        await websocket.accept()
        client_id = id(websocket)
        client = Client(websocket=websocket, user_id=user_id, role=role)
        async with self._lock:
            self._clients[client_id] = client
            self._user_sockets[user_id].add(client_id)
            if role == "admin":
                self._admin_sockets.add(client_id)
        return client_id

    async def disconnect(self, websocket: WebSocket) -> None:
        client_id = id(websocket)
        async with self._lock:
            client = self._clients.pop(client_id, None)
            if client is None:
                return
            self._user_sockets[client.user_id].discard(client_id)
            if client.role == "admin":
                self._admin_sockets.discard(client_id)

    async def set_subscription(self, websocket: WebSocket, chat_type: str) -> None:
        client_id = id(websocket)
        async with self._lock:
            client = self._clients.get(client_id)
            if client is None:
                return
            client.subscriptions.add(chat_type)

    async def send_to_user(self, user_id: str, payload: dict[str, Any]) -> None:
        async with self._lock:
            socket_ids = list(self._user_sockets.get(user_id, set()))
            clients = [self._clients.get(sid) for sid in socket_ids]
        for client in clients:
            if client is None:
                continue
            await self._safe_send(client.websocket, payload)

    async def broadcast_to_admins(self, payload: dict[str, Any], *, require_subscription: str | None = None) -> None:
        async with self._lock:
            socket_ids = list(self._admin_sockets)
            clients = [self._clients.get(sid) for sid in socket_ids]
        for client in clients:
            if client is None:
                continue
            if require_subscription and require_subscription not in client.subscriptions:
                continue
            await self._safe_send(client.websocket, payload)

    async def _safe_send(self, websocket: WebSocket, payload: dict[str, Any]) -> None:
        try:
            await websocket.send_json(jsonable_encoder(payload))
        except Exception:
            # 클라이언트가 이미 끊긴 경우 등은 조용히 무시
            pass


manager = ConnectionManager()
