from __future__ import annotations

import os
from dataclasses import dataclass


def _get_env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


def _get_env_int(name: str, default: int) -> int:
    raw = _get_env(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _get_env_list(name: str, default: list[str]) -> list[str]:
    raw = _get_env(name)
    if raw is None:
        return default
    items = [x.strip() for x in raw.split(",")]
    return [x for x in items if x]


@dataclass(frozen=True)
class Settings:
    app_env: str
    host: str
    port: int

    mysql_host: str
    mysql_port: int
    mysql_user: str
    mysql_password: str
    mysql_db: str

    jwt_secret: str
    jwt_expires_minutes: int

    cors_origins: list[str]


def load_settings() -> Settings:
    return Settings(
        app_env=_get_env("APP_ENV", "local") or "local",
        host=_get_env("HOST", "0.0.0.0") or "0.0.0.0",
        port=_get_env_int("PORT", 8000),
        mysql_host=_get_env("MYSQL_HOST", "127.0.0.1") or "127.0.0.1",
        mysql_port=_get_env_int("MYSQL_PORT", 3306),
        mysql_user=_get_env("MYSQL_USER", "root") or "root",
        mysql_password=_get_env("MYSQL_PASSWORD", "") or "",
        mysql_db=_get_env("MYSQL_DB", "ai3pjt") or "ai3pjt",
        jwt_secret=_get_env("JWT_SECRET", "change-me") or "change-me",
        jwt_expires_minutes=_get_env_int("JWT_EXPIRES_MINUTES", 60 * 24 * 7),
        cors_origins=_get_env_list("CORS_ORIGINS", ["http://localhost:3000"]),
    )

