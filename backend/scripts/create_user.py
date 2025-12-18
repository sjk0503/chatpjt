from __future__ import annotations

import argparse
import os
import sys
import uuid

from dotenv import load_dotenv

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from app.db import db_conn, execute, fetch_one
from app.security import hash_password


def main() -> None:
    parser = argparse.ArgumentParser(description="사용자 계정을 생성/갱신합니다.")
    parser.add_argument("--email", required=True, help="사용자 이메일")
    parser.add_argument("--password", required=True, help="비밀번호(평문 입력, DB에는 해시로 저장)")
    parser.add_argument("--role", required=True, choices=["customer", "admin"], help="customer 또는 admin")
    parser.add_argument("--name", default=None, help="표시 이름(기본: 이메일 @ 앞부분)")
    args = parser.parse_args()

    email = args.email.strip().lower()
    if not email:
        raise SystemExit("email이 비어있습니다.")

    name = (args.name or "").strip() or (email.split("@", 1)[0] or args.role)
    password_hash = hash_password(args.password)

    with db_conn() as conn:
        existing = fetch_one(conn, "SELECT id, role FROM users WHERE email=%s", (email,))
        if existing:
            execute(
                conn,
                "UPDATE users SET password_hash=%s, name=%s, role=%s WHERE id=%s",
                (password_hash, name, args.role, existing["id"]),
            )
            print(f"사용자 계정을 갱신했습니다: {email} (role={args.role})")
            return

        user_id = uuid.uuid4().hex
        execute(
            conn,
            "INSERT INTO users (id, email, password_hash, name, role) VALUES (%s,%s,%s,%s,%s)",
            (user_id, email, password_hash, name, args.role),
        )
        print(f"사용자 계정을 생성했습니다: {email} (role={args.role})")


if __name__ == "__main__":
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"), override=False)
    main()

