"""FastAPI 入口。

启动：  backend\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
文档：  http://127.0.0.1:8000/docs
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.config import settings
from app.database import Base, engine
from app.routers import auth, system

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("kun-login")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 开发期直接建表；正式项目请换成 Alembic 迁移
    Base.metadata.create_all(bind=engine)
    logger.info("数据库已就绪：%s:%s/%s", settings.db_host, settings.db_port, settings.db_name)
    if settings.secret_key == "change-me-in-dotenv":
        logger.warning("SECRET_KEY 仍是默认值，请在 backend/.env 里换成随机串！")
    yield
    engine.dispose()
    logger.info("数据库连接池已释放")


app = FastAPI(
    title=f"{settings.app_name} API",
    version=__version__,
    description="Vue3 + FastAPI + MySQL 登录示例的后端服务",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router)
app.include_router(auth.router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """兜底：生产环境不把堆栈丢给前端。"""
    logger.exception("未处理异常 %s %s", request.method, request.url.path)
    detail = str(exc) if settings.debug else "服务器开小差了，请稍后再试"
    return JSONResponse(status_code=500, content={"detail": detail})


@app.get("/", include_in_schema=False)
def index() -> dict[str, str]:
    return {
        "service": settings.app_name,
        "version": __version__,
        "docs": "/docs",
        "health": "/api/health",
    }
