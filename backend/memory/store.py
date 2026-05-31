"""
Per-agent memory store using SQLite.
Loads and saves LangChain BaseMessage history per agent+session.
"""
from __future__ import annotations

from typing import List
from sqlmodel import Session, select

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage

from db.models import AgentMemory
from db.database import engine


class MemoryStore:

    async def load(
        self,
        agent_id: str,
        session_id: str,
        window: int = 20,
    ) -> List[BaseMessage]:
        with Session(engine) as session:
            results = session.exec(
                select(AgentMemory)
                .where(AgentMemory.agent_id == agent_id)
                .where(AgentMemory.session_id == session_id)
                .order_by(AgentMemory.created_at.desc())
                .limit(window)
            ).all()

        results = list(reversed(results))
        messages: List[BaseMessage] = []
        for r in results:
            if r.role == "human":
                messages.append(HumanMessage(content=r.content))
            elif r.role == "ai":
                messages.append(AIMessage(content=r.content))
            elif r.role == "system":
                messages.append(SystemMessage(content=r.content))
        return messages

    async def save(
        self,
        agent_id: str,
        session_id: str,
        human_msg: HumanMessage,
        ai_msg: AIMessage,
    ) -> None:
        with Session(engine) as session:
            session.add(AgentMemory(
                agent_id=agent_id,
                session_id=session_id,
                role="human",
                content=human_msg.content,
            ))
            session.add(AgentMemory(
                agent_id=agent_id,
                session_id=session_id,
                role="ai",
                content=ai_msg.content,
            ))
            session.commit()

    async def clear(self, agent_id: str, session_id: str) -> None:
        with Session(engine) as session:
            rows = session.exec(
                select(AgentMemory)
                .where(AgentMemory.agent_id == agent_id)
                .where(AgentMemory.session_id == session_id)
            ).all()
            for r in rows:
                session.delete(r)
            session.commit()

    async def get_all_sessions(self, agent_id: str) -> List[str]:
        with Session(engine) as session:
            rows = session.exec(
                select(AgentMemory.session_id)
                .where(AgentMemory.agent_id == agent_id)
                .distinct()
            ).all()
        return list(rows)
