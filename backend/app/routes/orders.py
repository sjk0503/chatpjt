from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..db import db_conn, execute, fetch_all, fetch_one, utc_now
from ..schemas import ApiResponse, CreateOrderRequest, UpdateOrderStatusRequest, UserOut
from .auth import get_current_user

router = APIRouter(prefix="/api/orders", tags=["orders"])
admin_router = APIRouter(prefix="/api/admin/orders", tags=["admin-orders"])


def _require_admin(user: UserOut) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="관리자만 접근할 수 있습니다.")


def _dt_to_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _to_db_utc_naive(dt: datetime) -> datetime:
    # DB는 naive datetime(UTC 기준)을 사용한다. (backend/app/db.py의 utc_now 참고)
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _order_out(row: dict) -> dict:
    return {
        "id": row["id"],
        "order_number": row["order_number"],
        "product_name": row["product_name"],
        "customer_id": row["customer_id"],
        "ordered_at": _dt_to_iso(row.get("ordered_at")),
        "shipping_status": row.get("shipping_status") or "preparing",
        "updated_at": _dt_to_iso(row.get("updated_at")),
    }


@router.get("", response_model=ApiResponse)
def list_my_orders(
    status: str | None = None,
    current_user: UserOut = Depends(get_current_user),
) -> ApiResponse:
    if current_user.role != "customer":
        raise HTTPException(status_code=403, detail="고객만 접근할 수 있습니다.")

    with db_conn() as conn:
        if status:
            rows = fetch_all(
                conn,
                """
                SELECT id, order_number, product_name, customer_id, ordered_at, shipping_status, updated_at
                FROM orders
                WHERE customer_id=%s AND shipping_status=%s
                ORDER BY ordered_at DESC
                """,
                (current_user.id, status),
            )
        else:
            rows = fetch_all(
                conn,
                """
                SELECT id, order_number, product_name, customer_id, ordered_at, shipping_status, updated_at
                FROM orders
                WHERE customer_id=%s
                ORDER BY ordered_at DESC
                """,
                (current_user.id,),
            )
    return ApiResponse(success=True, data={"orders": [_order_out(r) for r in rows]})


@router.get("/{order_number}", response_model=ApiResponse)
def get_my_order(
    order_number: str,
    current_user: UserOut = Depends(get_current_user),
) -> ApiResponse:
    if current_user.role != "customer":
        raise HTTPException(status_code=403, detail="고객만 접근할 수 있습니다.")

    with db_conn() as conn:
        row = fetch_one(
            conn,
            """
            SELECT id, order_number, product_name, customer_id, ordered_at, shipping_status, updated_at
            FROM orders
            WHERE order_number=%s
            """,
            (order_number,),
        )
    if not row:
        return ApiResponse(success=False, message="주문을 찾을 수 없습니다.")
    if row["customer_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")
    return ApiResponse(success=True, data={"order": _order_out(row)})


@admin_router.get("", response_model=ApiResponse)
def admin_list_orders(
    customer_id: str | None = None,
    status: str | None = None,
    order_number: str | None = None,
    current_user: UserOut = Depends(get_current_user),
) -> ApiResponse:
    _require_admin(current_user)

    where = []
    params: list[str] = []
    if customer_id:
        where.append("customer_id=%s")
        params.append(customer_id)
    if status:
        where.append("shipping_status=%s")
        params.append(status)
    if order_number:
        where.append("order_number LIKE %s")
        params.append(f"%{order_number}%")

    where_sql = ""
    if where:
        where_sql = "WHERE " + " AND ".join(where)

    with db_conn() as conn:
        rows = fetch_all(
            conn,
            f"""
            SELECT id, order_number, product_name, customer_id, ordered_at, shipping_status, updated_at
            FROM orders
            {where_sql}
            ORDER BY ordered_at DESC
            """,
            tuple(params),
        )
    return ApiResponse(success=True, data={"orders": [_order_out(r) for r in rows]})


@admin_router.get("/{order_number}", response_model=ApiResponse)
def admin_get_order(
    order_number: str,
    current_user: UserOut = Depends(get_current_user),
) -> ApiResponse:
    _require_admin(current_user)
    with db_conn() as conn:
        row = fetch_one(
            conn,
            """
            SELECT id, order_number, product_name, customer_id, ordered_at, shipping_status, updated_at
            FROM orders
            WHERE order_number=%s
            """,
            (order_number,),
        )
    if not row:
        return ApiResponse(success=False, message="주문을 찾을 수 없습니다.")
    return ApiResponse(success=True, data={"order": _order_out(row)})


@admin_router.post("", response_model=ApiResponse)
def admin_create_order(
    req: CreateOrderRequest,
    current_user: UserOut = Depends(get_current_user),
) -> ApiResponse:
    _require_admin(current_user)

    ordered_at = utc_now()
    if req.ordered_at is not None:
        ordered_at = _to_db_utc_naive(req.ordered_at)

    shipping_status = req.shipping_status or "preparing"
    order_id = uuid.uuid4().hex

    with db_conn() as conn:
        # 고객 존재 확인
        customer = fetch_one(conn, "SELECT id FROM users WHERE id=%s AND role='customer'", (req.customer_id,))
        if not customer:
            return ApiResponse(success=False, message="주문자(customer_id)를 찾을 수 없습니다.")

        # 주문번호 중복 방지
        existing = fetch_one(conn, "SELECT id FROM orders WHERE order_number=%s", (req.order_number,))
        if existing:
            return ApiResponse(success=False, message="이미 존재하는 주문번호입니다.")

        execute(
            conn,
            """
            INSERT INTO orders (id, order_number, product_name, customer_id, ordered_at, shipping_status)
            VALUES (%s,%s,%s,%s,%s,%s)
            """,
            (order_id, req.order_number, req.product_name, req.customer_id, ordered_at, shipping_status),
        )
        row = fetch_one(
            conn,
            """
            SELECT id, order_number, product_name, customer_id, ordered_at, shipping_status, updated_at
            FROM orders
            WHERE id=%s
            """,
            (order_id,),
        )

    return ApiResponse(success=True, data={"order": _order_out(row) if row else {"id": order_id}})


@admin_router.patch("/{order_number}/status", response_model=ApiResponse)
def admin_update_order_status(
    order_number: str,
    req: UpdateOrderStatusRequest,
    current_user: UserOut = Depends(get_current_user),
) -> ApiResponse:
    _require_admin(current_user)
    with db_conn() as conn:
        row = fetch_one(conn, "SELECT id FROM orders WHERE order_number=%s", (order_number,))
        if not row:
            return ApiResponse(success=False, message="주문을 찾을 수 없습니다.")
        execute(
            conn,
            "UPDATE orders SET shipping_status=%s WHERE order_number=%s",
            (req.shipping_status, order_number),
        )
        updated = fetch_one(
            conn,
            """
            SELECT id, order_number, product_name, customer_id, ordered_at, shipping_status, updated_at
            FROM orders
            WHERE order_number=%s
            """,
            (order_number,),
        )
    return ApiResponse(success=True, data={"order": _order_out(updated) if updated else None})

