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
    parser = argparse.ArgumentParser(description="관리자 계정을 생성/갱신합니다.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--name", default="Admin")
    args = parser.parse_args()

    email = args.email.strip().lower()
    if not email:
        raise SystemExit("email이 비어있습니다.")

    password_hash = hash_password(args.password)

    with db_conn() as conn:
        existing = fetch_one(conn, "SELECT id FROM users WHERE email=%s AND role='admin'", (email,))
        if existing:
            execute(
                conn,
                "UPDATE users SET password_hash=%s, name=%s WHERE id=%s",
                (password_hash, args.name, existing["id"]),
            )
            print(f"관리자 비밀번호를 갱신했습니다: {email}")
            return

        user_id = uuid.uuid4().hex
        execute(
            conn,
            "INSERT INTO users (id, email, password_hash, name, role) VALUES (%s,%s,%s,%s,'admin')",
            (user_id, email, password_hash, args.name),
        )
        print(f"관리자 계정을 생성했습니다: {email}")


if __name__ == "__main__":
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"), override=False)
    main()
