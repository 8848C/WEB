"""密码哈希与 JWT。

密码哈希刻意只用标准库（hashlib.scrypt / pbkdf2_hmac），
这样后端没有任何需要编译的原生依赖，换台机器 pip 装完就能跑。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.config import settings

_ALGORITHM = "pbkdf2_sha256"
_ITERATIONS = 600_000
_SALT_BYTES = 16


# --------------------------------------------------------------------------- #
# 密码
# --------------------------------------------------------------------------- #
def hash_password(password: str) -> str:
    """返回 `pbkdf2_sha256$迭代次数$salt_b64$hash_b64`。"""
    salt = os.urandom(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return "{}${}${}${}".format(
        _ALGORITHM,
        _ITERATIONS,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, stored: str) -> bool:
    """恒定时间比对，格式非法一律当作验证失败。"""
    try:
        algorithm, iterations, salt_b64, digest_b64 = stored.split("$")
        if algorithm != _ALGORITHM:
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


# --------------------------------------------------------------------------- #
# JWT
# --------------------------------------------------------------------------- #
def create_access_token(subject: str | int, **extra: Any) -> tuple[str, int]:
    """签发 access token，返回 (token, 剩余秒数)。"""
    expires_delta = timedelta(minutes=settings.access_token_expire_minutes)
    now = datetime.now(UTC)
    expire = now + expires_delta

    payload: dict[str, Any] = {
        "sub": str(subject),
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "typ": "access",
        **extra,
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    return token, int(expires_delta.total_seconds())


def decode_access_token(token: str) -> dict[str, Any] | None:
    """解析 token；签名不对或已过期都返回 None。"""
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None


def avatar_hue_for(username: str) -> int:
    """由用户名派生一个稳定的色相（0-359），保证同一个人头像颜色不变。"""
    digest = hashlib.sha256(username.strip().lower().encode("utf-8")).digest()
    return int.from_bytes(digest[:2], "big") % 360
