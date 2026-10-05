"""FastAPI 依赖：取当前登录用户。"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.security import decode_access_token

# auto_error=False：自己抛 401，好统一响应体与中文提示
bearer_scheme = HTTPBearer(auto_error=False, description="Bearer <access_token>")

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="登录状态已失效，请重新登录",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if credentials is None or not credentials.credentials:
        raise _UNAUTHORIZED

    payload = decode_access_token(credentials.credentials)
    if payload is None or payload.get("typ") != "access":
        raise _UNAUTHORIZED

    subject = payload.get("sub")
    if subject is None or not str(subject).isdigit():
        raise _UNAUTHORIZED

    user = db.get(User, int(subject))
    if user is None:
        raise _UNAUTHORIZED
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="该账号已被停用")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]
