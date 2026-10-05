"""认证接口：注册 / 登录 / 当前用户 / 登出。"""

from __future__ import annotations

import threading
import time
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, or_, select

from app.config import settings
from app.deps import CurrentUser, DbSession
from app.models import User
from app.schemas import LoginIn, MessageOut, RegisterIn, TokenOut, UserOut
from app.security import avatar_hue_for, create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


# --------------------------------------------------------------------------- #
# 极简登录限流：同一 (IP, 账号) 连续失败 N 次后锁定一段时间。
# 进程内内存实现，够单机开发用；上多实例时换成 Redis。
# --------------------------------------------------------------------------- #
class _LoginGuard:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._failures: dict[str, list[float]] = {}

    def _key(self, ip: str, account: str) -> str:
        return f"{ip}|{account.strip().lower()}"

    def retry_after(self, ip: str, account: str) -> int:
        """若处于锁定期，返回还需等待的秒数（0 表示可以尝试）。"""
        now = time.monotonic()
        window = settings.login_lock_seconds
        with self._lock:
            stamps = [t for t in self._failures.get(self._key(ip, account), []) if now - t < window]
            self._failures[self._key(ip, account)] = stamps
            if len(stamps) >= settings.login_max_attempts:
                return max(1, int(window - (now - stamps[0])) + 1)
        return 0

    def record_failure(self, ip: str, account: str) -> None:
        with self._lock:
            self._failures.setdefault(self._key(ip, account), []).append(time.monotonic())

    def reset(self, ip: str, account: str) -> None:
        with self._lock:
            self._failures.pop(self._key(ip, account), None)


guard = _LoginGuard()

_INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="用户名或密码不正确",
)


def _issue_token(user: User) -> TokenOut:
    token, expires_in = create_access_token(
        user.id, username=user.username, superuser=user.is_superuser
    )
    return TokenOut(
        access_token=token,
        expires_in=expires_in,
        user=UserOut.model_validate(user),
    )


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED,
             summary="注册并直接登录")
def register(payload: RegisterIn, db: DbSession) -> TokenOut:
    username_taken = db.scalar(select(User.id).where(User.username == payload.username))
    if username_taken:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该用户名已被注册")

    email_taken = db.scalar(
        select(User.id).where(func.lower(User.email) == payload.email.lower())
    )
    if email_taken:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该邮箱已被注册")

    user = User(
        username=payload.username,
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        display_name=payload.username,
        avatar_hue=avatar_hue_for(payload.username),
        last_login_at=datetime.now(UTC).replace(tzinfo=None),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _issue_token(user)


@router.post("/login", response_model=TokenOut, summary="用户名或邮箱 + 密码登录")
def login(payload: LoginIn, request: Request, db: DbSession) -> TokenOut:
    client_ip = request.client.host if request.client else "unknown"

    wait = guard.retry_after(client_ip, payload.account)
    if wait > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"失败次数过多，请 {wait} 秒后再试",
            headers={"Retry-After": str(wait)},
        )

    account = payload.account
    user = db.scalar(
        select(User).where(
            or_(User.username == account, func.lower(User.email) == account.lower())
        )
    )

    # 注意：用户不存在与密码错误返回同一条提示，避免账号枚举
    if user is None or not verify_password(payload.password, user.password_hash):
        guard.record_failure(client_ip, account)
        raise _INVALID_CREDENTIALS

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="该账号已被停用")

    guard.reset(client_ip, account)
    user.last_login_at = datetime.now(UTC).replace(tzinfo=None)
    db.commit()
    db.refresh(user)
    return _issue_token(user)


@router.get("/me", response_model=UserOut, summary="用 token 换当前用户")
def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/logout", response_model=MessageOut, summary="登出（JWT 无状态，前端丢弃即可）")
def logout(user: CurrentUser) -> MessageOut:
    return MessageOut(detail="已退出登录")
