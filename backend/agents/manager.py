"""
Agent CRUD operations against SQLite via SQLModel.
"""
from __future__ import annotations

import json
from typing import List, Optional
from datetime import datetime
from sqlmodel import Session, select

from db.models import Agent
from db.database import engine


class AgentManager:

    @staticmethod
    def create(
        name: str,
        role: str,
        system_prompt: str,
        model: str = "llama-3.3-70b-versatile",
        temperature: float = 0.7,
        max_tokens: int = 2048,
        tools: List[str] = None,
        channels: List[dict] = None,
        memory_enabled: bool = True,
        memory_window: int = 20,
        guardrails: dict = None,
        schedule: Optional[str] = None,
        schedule_prompt: Optional[str] = None,
        max_iterations: int = 10,
        user_id: Optional[str] = None,
    ) -> Agent:
        agent = Agent(
            name=name,
            role=role,
            system_prompt=system_prompt,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            tools=json.dumps(tools or []),
            channels=json.dumps(channels or []),
            memory_enabled=memory_enabled,
            memory_window=memory_window,
            guardrails=json.dumps(guardrails or {}),
            schedule=schedule,
            schedule_prompt=schedule_prompt,
            max_iterations=max_iterations,
            user_id=user_id,
        )
        with Session(engine) as session:
            session.add(agent)
            session.commit()
            session.refresh(agent)
            return agent

    @staticmethod
    def get(agent_id: str) -> Optional[Agent]:
        with Session(engine) as session:
            return session.get(Agent, agent_id)

    @staticmethod
    def list_all() -> List[Agent]:
        with Session(engine) as session:
            return session.exec(select(Agent)).all()

    @staticmethod
    def update(agent_id: str, **kwargs) -> Optional[Agent]:
        with Session(engine) as session:
            agent = session.get(Agent, agent_id)
            if not agent:
                return None
            for k, v in kwargs.items():
                if k in ("tools", "channels") and isinstance(v, list):
                    v = json.dumps(v)
                if k == "guardrails" and isinstance(v, dict):
                    v = json.dumps(v)
                if hasattr(agent, k):
                    setattr(agent, k, v)
            agent.updated_at = datetime.utcnow()
            session.add(agent)
            session.commit()
            session.refresh(agent)
            return agent

    @staticmethod
    def delete(agent_id: str) -> bool:
        with Session(engine) as session:
            agent = session.get(Agent, agent_id)
            if not agent:
                return False
            session.delete(agent)
            session.commit()
            return True
