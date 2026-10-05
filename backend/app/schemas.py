"""请求 / 响应模型。"""

from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

USERNAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{2,31}$")


class RegisterIn(BaseModel):
    username: str = Field(..., min_length=3, max_length=32, description="字母开头，可含数字与下划线")
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=64)

    @field_validator("username")
    @classmethod
    def _check_username(cls, value: str) -> str:
        value = value.strip()
        if not USERNAME_RE.match(value):
            raise ValueError("用户名需字母开头，3-32 位，只能包含字母、数字和下划线")
        return value

    @field_validator("password")
    @classmethod
    def _check_password(cls, value: str) -> str:
        if value.strip() != value:
            raise ValueError("密码首尾不能有空格")
        if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
            raise ValueError("密码需同时包含字母和数字")
        return value


class LoginIn(BaseModel):
    # 允许用用户名或邮箱登录，所以这里不叫 username
    account: str = Field(..., min_length=1, max_length=190)
    password: str = Field(..., min_length=1, max_length=64)
    remember: bool = False

    @field_validator("account")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: EmailStr
    display_name: str
    avatar_hue: int
    is_superuser: bool
    created_at: datetime
    last_login_at: datetime | None = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    user: UserOut


class MessageOut(BaseModel):
    detail: str
