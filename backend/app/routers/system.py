"""健康检查 / 连通性自检。"""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from app.config import settings
from app.deps import DbSession

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health", summary="服务与数据库健康状态")
def health(db: DbSession) -> dict[str, object]:
    database: dict[str, object] = {"ok": False}
    try:
        version = db.scalar(text("SELECT VERSION()"))
        database = {"ok": True, "version": version, "schema": settings.db_name}
    except Exception as exc:  # noqa: BLE001 - 健康检查要把原因原样报出来
        database = {"ok": False, "error": str(exc)}

    return {
        "ok": bool(database["ok"]),
        "app": settings.app_name,
        "env": settings.app_env,
        "database": database,
    }
