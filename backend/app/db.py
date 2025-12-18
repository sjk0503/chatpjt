from __future__ import annotations

import contextlib
import json
from collections.abc import Generator
from datetime import datetime
from typing import Any

import pymysql
from pymysql.cursors import DictCursor

from .config import load_settings


def utc_now() -> datetime:
    # MySQL TIMESTAMP는 일반적으로 naive datetime(서버 TZ 기준)로 다루므로
    # 로컬 개발에서는 UTC 기준 naive datetime을 사용합니다.
    return datetime.utcnow()


def _connect() -> pymysql.Connection:
    settings = load_settings()
    return pymysql.connect(
        host=settings.mysql_host,
        port=settings.mysql_port,
        user=settings.mysql_user,
        password=settings.mysql_password,
        database=settings.mysql_db,
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=False,
    )


@contextlib.contextmanager
def db_conn() -> Generator[pymysql.Connection, None, None]:
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def fetch_one(conn: pymysql.Connection, sql: str, params: tuple[Any, ...]) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        return row


def fetch_all(conn: pymysql.Connection, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
        return list(rows)


def execute(conn: pymysql.Connection, sql: str, params: tuple[Any, ...]) -> int:
    with conn.cursor() as cur:
        return cur.execute(sql, params)


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if isinstance(value, str):
        value = value.strip()
        if value == "":
            return None
        return json.loads(value)
    return value
