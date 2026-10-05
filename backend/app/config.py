"""应用配置：全部来自环境变量 / .env，代码里不写死任何凭据。"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- 应用 ----
    app_name: str = "Kun Login"
    app_env: str = "development"
    debug: bool = True

    # ---- 数据库 ----
    db_host: str = "127.0.0.1"
    db_port: int = 3307
    db_user: str = "kun"
    db_password: str = ""
    db_name: str = "kun_login"
    db_echo: bool = False

    # ---- 鉴权 ----
    secret_key: str = Field(default="change-me-in-dotenv")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 120

    # ---- 跨域 ----
    # NoDecode：告诉 pydantic-settings 别把 .env 里的值当 JSON 解析，
    # 交给下面的 _split_origins 按逗号切分。
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    # ---- 登录保护 ----
    login_max_attempts: int = 5
    login_lock_seconds: int = 300

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """允许 .env 里写成逗号分隔的字符串。"""
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def database_url(self) -> str:
        from urllib.parse import quote_plus

        password = quote_plus(self.db_password)
        return (
            f"mysql+pymysql://{self.db_user}:{password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}?charset=utf8mb4"
        )

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
