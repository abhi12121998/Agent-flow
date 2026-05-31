import os
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

_raw_url = os.getenv("DATABASE_URL", "")

# Neon/Railway quirk: they emit postgres:// but SQLAlchemy requires postgresql://
if _raw_url.startswith("postgres://"):
    _raw_url = _raw_url.replace("postgres://", "postgresql://", 1)

if _raw_url:
    DATABASE_URL = _raw_url
    # asyncpg driver for async operations
    ASYNC_DATABASE_URL = _raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    _connect_args = {}
else:
    DB_PATH = os.getenv("DB_PATH", "./yuno.db")
    DATABASE_URL = f"sqlite:///{DB_PATH}"
    ASYNC_DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"
    _connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, echo=False, connect_args=_connect_args)
async_engine = create_async_engine(ASYNC_DATABASE_URL, echo=False)

AsyncSessionLocal = sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


def create_db_and_tables():
    from db.models import Agent, Workflow, WorkflowRun, Message, AgentMemory, ChannelConfig, LogEntry
    from auth.models import User  # ensures User table is created too
    SQLModel.metadata.create_all(engine)


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
