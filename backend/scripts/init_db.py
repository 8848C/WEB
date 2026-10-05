"""建表 + 灌一个演示账号。

用法（在 backend 目录下）：
    .venv\\Scripts\\python.exe scripts\\init_db.py
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import select  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models import User  # noqa: E402
from app.security import avatar_hue_for, hash_password  # noqa: E402

DEMO_USER = {
    "username": "admin",
    "email": "admin@kun.dev",
    "password": "admin12345",
    "display_name": "管理员",
    "is_superuser": True,
}


def main() -> int:
    print(f"-> 连接 {settings.db_host}:{settings.db_port}/{settings.db_name}  (用户 {settings.db_user})")
    Base.metadata.create_all(bind=engine)
    print("-> 表结构已创建 / 已是最新 (users)")

    with SessionLocal() as db:
        existing = db.scalar(select(User).where(User.username == DEMO_USER["username"]))
        if existing:
            print(f"-> 演示账号已存在，跳过：{DEMO_USER['username']}")
        else:
            db.add(
                User(
                    username=DEMO_USER["username"],
                    email=DEMO_USER["email"],
                    password_hash=hash_password(DEMO_USER["password"]),
                    display_name=DEMO_USER["display_name"],
                    avatar_hue=avatar_hue_for(DEMO_USER["username"]),
                    is_superuser=DEMO_USER["is_superuser"],
                    last_login_at=datetime.now(UTC).replace(tzinfo=None),
                )
            )
            db.commit()
            print(f"-> 已创建演示账号：{DEMO_USER['username']} / {DEMO_USER['password']}")

        total = db.scalar(select(User.id).order_by(User.id.desc()).limit(1))
        print(f"-> 当前最大用户 id：{total if total else 0}")

    engine.dispose()
    print("完成。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
