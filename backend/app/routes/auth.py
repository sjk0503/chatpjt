from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException

from ..db import db_conn, execute, fetch_one
from ..schemas import ApiResponse, LoginRequest, LoginResponseData, UserOut
from ..security import create_access_token, hash_password, verify_password, decode_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _get_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, token = parts
    if scheme.lower() != "bearer":
        return None
    return token.strip()


def get_current_user(authorization: str | None = Header(default=None)) -> UserOut:
    token = _get_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="인증 토큰이 필요합니다.")
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="토큰이 유효하지 않습니다.")
    user_id = str(payload.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="토큰이 유효하지 않습니다.")
    with db_conn() as conn:
        row = fetch_one(
            conn,
            "SELECT id, email, name, role FROM users WHERE id=%s",
            (user_id,),
        )
    if not row:
        raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다.")
    return UserOut(**row)


@router.post("/login", response_model=ApiResponse)
def login(req: LoginRequest) -> ApiResponse:
    email = req.email.strip().lower()
    if not email or not req.password:
        return ApiResponse(success=False, message="이메일/비밀번호가 필요합니다.")

    with db_conn() as conn:
        user = fetch_one(
            conn,
            "SELECT id, email, name, role, password_hash FROM users WHERE email=%s AND role=%s",
            (email, req.role),
        )

        if user is None and req.role == "customer":
            user_id = uuid.uuid4().hex
            name = email.split("@", 1)[0] or "customer"
            password_hash = hash_password(req.password)
            execute(
                conn,
                "INSERT INTO users (id, email, password_hash, name, role) VALUES (%s,%s,%s,%s,%s)",
                (user_id, email, password_hash, name, "customer"),
            )
            user = {
                "id": user_id,
                "email": email,
                "name": name,
                "role": "customer",
                "password_hash": password_hash,
            }

        if user is None:
            return ApiResponse(success=False, message="이메일 또는 비밀번호가 올바르지 않습니다.")

        if not verify_password(req.password, user["password_hash"]):
            return ApiResponse(success=False, message="이메일 또는 비밀번호가 올바르지 않습니다.")

        token = create_access_token(user_id=user["id"], role=user["role"], email=user["email"])
        data = LoginResponseData(user=UserOut(id=user["id"], email=user["email"], name=user["name"], role=user["role"]), token=token)
        return ApiResponse(success=True, data=data.model_dump())


@router.post("/logout", response_model=ApiResponse)
def logout() -> ApiResponse:
    # JWT는 기본적으로 stateless이므로 서버에서는 별도 처리 없이 성공 응답
    return ApiResponse(success=True, message="로그아웃되었습니다.")


@router.get("/me", response_model=ApiResponse)
def me(current_user: UserOut = Depends(get_current_user)) -> ApiResponse:
    return ApiResponse(success=True, data=current_user.model_dump())

