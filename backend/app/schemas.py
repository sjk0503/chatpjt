from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class ApiResponse(BaseModel):
    success: bool = True
    message: str | None = None
    data: Any | None = None


class LoginRequest(BaseModel):
    email: str
    password: str
    role: Literal["customer", "admin"]


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: Literal["customer", "admin"]


class LoginResponseData(BaseModel):
    user: UserOut
    token: str


class SendMessageRequest(BaseModel):
    session_id: str
    content: str
    attachments: list[str] | None = None


class MessageOut(BaseModel):
    id: str
    session_id: str | None = None
    sender_type: Literal["user", "ai", "agent"]
    sender_id: str | None = None
    content: str
    attachments: list[Any] | None = None
    is_read: bool | None = None
    created_at: datetime | None = None


class SessionOut(BaseModel):
    id: str
    customer_id: str
    category: str | None = None
    status: Literal["active", "pending", "completed"]
    handler_type: Literal["ai", "agent"]
    assigned_agent_id: str | None = None
    started_at: datetime | None = None


class TakeoverRequest(BaseModel):
    agent_id: str


class ProvideInfoRequest(BaseModel):
    info: str = Field(min_length=1)


class CompleteRequest(BaseModel):
    summary: str = Field(min_length=1)


class OrderOut(BaseModel):
    id: str
    order_number: str
    product_name: str
    customer_id: str
    ordered_at: datetime | None = None
    shipping_status: str
    updated_at: datetime | None = None


class CreateOrderRequest(BaseModel):
    order_number: str = Field(min_length=1)
    product_name: str = Field(min_length=1)
    customer_id: str = Field(min_length=1)
    ordered_at: datetime | None = None
    shipping_status: Literal["preparing", "shipped", "delivered", "cancelled"] | None = None


class UpdateOrderStatusRequest(BaseModel):
    shipping_status: Literal["preparing", "shipped", "delivered", "cancelled"]


class ChatbotSettingsOut(BaseModel):
    greeting: str
    farewell: str
    company_policy: str
    categories: list[str]
    human_intervention_rules: str
    response_wait_time: int
    auto_close: bool


class ChatbotSettingsUpdate(BaseModel):
    greeting: str
    farewell: str
    company_policy: str
    categories: list[str]
    human_intervention_rules: str
    response_wait_time: int
    auto_close: bool
