"""
Yuno AI Agent Orchestration Platform — FastAPI Backend
"""
from __future__ import annotations

from dotenv import load_dotenv, find_dotenv
load_dotenv(find_dotenv())

import json
import os
import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks, UploadFile, File, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlmodel import Session, select

from db.database import create_db_and_tables, engine
from db.models import (
    Agent, Workflow, WorkflowRun, Message, ChannelConfig, LogEntry, AgentMemory
)
from agents.manager import AgentManager
from agents.runtime import AgentRunner
from agents.tools import TOOL_DESCRIPTIONS
from llm_provider import get_provider_info, OPENAI_TO_GROQ, GROQ_MODELS
from document_validator import validator as doc_validator
from workflows.runner import WorkflowRunner
from workflows.templates import get_all_templates
from memory.store import MemoryStore
from channels.telegram import start_bot, stop_bot, get_active_bots, restart_all_bots
from ws_manager import ws_manager, broadcast_event
from scheduler import scheduler, register_agent_schedule, unregister_agent_schedule, reload_all_schedules
from auth.router import router as auth_router
from auth.dependencies import get_current_user, JWT_SECRET, JWT_ALGORITHM
from auth.models import User

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Yuno Agent Platform", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)

memory_store = MemoryStore()


@app.api_route("/", methods=["GET", "HEAD"])
def health_check():
    return {"status": "ok", "service": "Yuno Agent Platform"}


@app.on_event("startup")
async def startup():
    create_db_and_tables()
    _seed_templates()
    reload_all_schedules()
    scheduler.start()
    asyncio.create_task(restart_all_bots())
    logger.info("Yuno Platform started.")


@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown()


def _seed_templates():
    templates = get_all_templates()
    with Session(engine) as session:
        for tmpl in templates:
            exists = session.exec(
                select(Workflow).where(Workflow.template_name == tmpl["template_name"])
            ).first()
            if not exists:
                wf = Workflow(
                    name=tmpl["name"],
                    description=tmpl["description"],
                    graph_json=json.dumps(tmpl["graph"]),
                    is_template=True,
                    template_name=tmpl["template_name"],
                )
                session.add(wf)
        session.commit()


# ════════════════════════════════════════════════════════════════════
# WebSocket — live monitoring (auth via ?token= query param)
# ════════════════════════════════════════════════════════════════════
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: Optional[str] = Query(default=None)):
    if token:
        try:
            from jose import jwt, JWTError
            jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        except Exception:
            await ws.close(code=4001)
            return
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)


# ════════════════════════════════════════════════════════════════════
# Agents
# ════════════════════════════════════════════════════════════════════
class AgentCreate(BaseModel):
    name: str
    role: str
    system_prompt: str
    model: str = "gpt-4o"
    temperature: float = 0.7
    max_tokens: int = 2048
    tools: List[str] = []
    channels: List[dict] = []
    memory_enabled: bool = True
    memory_window: int = 20
    guardrails: dict = {}
    schedule: Optional[str] = None
    schedule_prompt: Optional[str] = None
    max_iterations: int = 10


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    tools: Optional[List[str]] = None
    channels: Optional[List[dict]] = None
    memory_enabled: Optional[bool] = None
    memory_window: Optional[int] = None
    guardrails: Optional[dict] = None
    schedule: Optional[str] = None
    schedule_prompt: Optional[str] = None
    max_iterations: Optional[int] = None
    is_active: Optional[bool] = None


def _agent_to_dict(a: Agent) -> dict:
    return {
        "id": a.id,
        "name": a.name,
        "role": a.role,
        "system_prompt": a.system_prompt,
        "model": a.model,
        "temperature": a.temperature,
        "max_tokens": a.max_tokens,
        "tools": a.get_tools(),
        "channels": a.get_channels(),
        "memory_enabled": a.memory_enabled,
        "memory_window": a.memory_window,
        "guardrails": a.get_guardrails(),
        "schedule": a.schedule,
        "schedule_prompt": a.schedule_prompt,
        "max_iterations": a.max_iterations,
        "is_active": a.is_active,
        "created_at": a.created_at.isoformat(),
        "updated_at": a.updated_at.isoformat(),
    }


def _get_user_agent(agent_id: str, user_id: str) -> Agent:
    agent = AgentManager.get(agent_id)
    if not agent or agent.user_id != user_id:
        raise HTTPException(404, "Agent not found")
    return agent


@app.get("/api/agents")
def list_agents(current_user: User = Depends(get_current_user)):
    with Session(engine) as session:
        agents = session.exec(select(Agent).where(Agent.user_id == current_user.id)).all()
    return [_agent_to_dict(a) for a in agents]


@app.post("/api/agents", status_code=201)
def create_agent(body: AgentCreate, current_user: User = Depends(get_current_user)):
    agent = AgentManager.create(**body.dict(), user_id=current_user.id)
    if agent.schedule:
        register_agent_schedule(agent.id, agent.schedule)
    return _agent_to_dict(agent)


@app.get("/api/agents/{agent_id}")
def get_agent(agent_id: str, current_user: User = Depends(get_current_user)):
    return _agent_to_dict(_get_user_agent(agent_id, current_user.id))


@app.patch("/api/agents/{agent_id}")
def update_agent(agent_id: str, body: AgentUpdate, current_user: User = Depends(get_current_user)):
    _get_user_agent(agent_id, current_user.id)  # ownership check
    updates = {k: v for k, v in body.dict().items() if v is not None}
    agent = AgentManager.update(agent_id, **updates)
    if not agent:
        raise HTTPException(404, "Agent not found")
    if agent.schedule:
        register_agent_schedule(agent.id, agent.schedule)
    else:
        unregister_agent_schedule(agent.id)
    return _agent_to_dict(agent)


@app.delete("/api/agents/{agent_id}")
def delete_agent(agent_id: str, current_user: User = Depends(get_current_user)):
    _get_user_agent(agent_id, current_user.id)  # ownership check
    if not AgentManager.delete(agent_id):
        raise HTTPException(404, "Agent not found")
    unregister_agent_schedule(agent_id)
    return {"ok": True}


class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"


@app.post("/api/agents/{agent_id}/chat")
async def chat_with_agent(agent_id: str, body: ChatRequest, current_user: User = Depends(get_current_user)):
    agent_cfg = _get_user_agent(agent_id, current_user.id)

    runner = AgentRunner(agent_cfg, memory_store, broadcast_event)
    result = await runner.run(
        user_input=body.message,
        session_id=body.session_id,
    )

    with Session(engine) as session:
        session.add(Message(
            agent_id=agent_id, agent_name=agent_cfg.name,
            channel="user", role="user", content=body.message,
            user_id=current_user.id,
        ))
        session.add(Message(
            agent_id=agent_id, agent_name=agent_cfg.name,
            channel="user", role="assistant", content=result["content"],
            user_id=current_user.id,
            meta=json.dumps({"tokens": result["total_tokens"], "cost": result["total_cost"]}),
        ))
        session.commit()

    return result


@app.get("/api/agents/{agent_id}/memory")
async def get_agent_memory(agent_id: str, session_id: str = "default", current_user: User = Depends(get_current_user)):
    _get_user_agent(agent_id, current_user.id)
    messages = await memory_store.load(agent_id, session_id, window=100)
    return [{"role": m.type, "content": m.content} for m in messages]


@app.delete("/api/agents/{agent_id}/memory")
async def clear_agent_memory(agent_id: str, session_id: str = "default", current_user: User = Depends(get_current_user)):
    _get_user_agent(agent_id, current_user.id)
    await memory_store.clear(agent_id, session_id)
    return {"ok": True}


# ════════════════════════════════════════════════════════════════════
# Tools  (public — no auth)
# ════════════════════════════════════════════════════════════════════
@app.get("/api/tools")
def list_tools():
    return [{"name": k, "description": v} for k, v in TOOL_DESCRIPTIONS.items()]


# ════════════════════════════════════════════════════════════════════
# Workflows
# ════════════════════════════════════════════════════════════════════
class WorkflowCreate(BaseModel):
    name: str
    description: str = ""
    graph_json: dict


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    graph_json: Optional[dict] = None
    is_active: Optional[bool] = None


def _wf_to_dict(w: Workflow) -> dict:
    return {
        "id": w.id,
        "name": w.name,
        "description": w.description,
        "graph_json": w.get_graph(),
        "is_template": w.is_template,
        "template_name": w.template_name,
        "is_active": w.is_active,
        "created_at": w.created_at.isoformat(),
        "updated_at": w.updated_at.isoformat(),
    }


def _get_user_workflow(wf_id: str, user_id: str) -> Workflow:
    with Session(engine) as session:
        wf = session.get(Workflow, wf_id)
    if not wf or (wf.user_id != user_id and not wf.is_template):
        raise HTTPException(404, "Workflow not found")
    return wf


@app.get("/api/workflows")
def list_workflows(current_user: User = Depends(get_current_user)):
    with Session(engine) as session:
        wfs = session.exec(
            select(Workflow).where(Workflow.user_id == current_user.id)
        ).all()
    return [_wf_to_dict(w) for w in wfs]


@app.get("/api/workflows/templates")
def list_templates(current_user: User = Depends(get_current_user)):
    with Session(engine) as session:
        wfs = session.exec(select(Workflow).where(Workflow.is_template == True)).all()
    return [_wf_to_dict(w) for w in wfs]


@app.post("/api/workflows", status_code=201)
def create_workflow(body: WorkflowCreate, current_user: User = Depends(get_current_user)):
    with Session(engine) as session:
        wf = Workflow(
            name=body.name,
            description=body.description,
            graph_json=json.dumps(body.graph_json),
            user_id=current_user.id,
        )
        session.add(wf)
        session.commit()
        session.refresh(wf)
    return _wf_to_dict(wf)


@app.patch("/api/workflows/{wf_id}")
def update_workflow(wf_id: str, body: WorkflowUpdate, current_user: User = Depends(get_current_user)):
    with Session(engine) as session:
        wf = session.get(Workflow, wf_id)
        if not wf or wf.user_id != current_user.id:
            raise HTTPException(404, "Workflow not found")
        if body.name is not None:
            wf.name = body.name
        if body.description is not None:
            wf.description = body.description
        if body.graph_json is not None:
            wf.graph_json = json.dumps(body.graph_json)
        if body.is_active is not None:
            wf.is_active = body.is_active
        wf.updated_at = datetime.utcnow()
        session.add(wf)
        session.commit()
        session.refresh(wf)
    return _wf_to_dict(wf)


@app.delete("/api/workflows/{wf_id}")
def delete_workflow(wf_id: str, current_user: User = Depends(get_current_user)):
    with Session(engine) as session:
        wf = session.get(Workflow, wf_id)
        if not wf or wf.user_id != current_user.id:
            raise HTTPException(404, "Workflow not found")
        session.delete(wf)
        session.commit()
    return {"ok": True}


class RunWorkflowRequest(BaseModel):
    input: str


@app.post("/api/workflows/{wf_id}/run")
async def run_workflow(wf_id: str, body: RunWorkflowRequest, current_user: User = Depends(get_current_user)):
    _get_user_workflow(wf_id, current_user.id)
    runner = WorkflowRunner(event_callback=broadcast_event)
    run = await runner.run_workflow(wf_id, body.input, user_id=current_user.id)
    return {
        "run_id": run.id,
        "status": run.status,
        "output": json.loads(run.output_data) if run.output_data else {},
        "total_tokens": run.total_tokens,
        "total_cost": run.total_cost,
        "error": run.error,
    }


@app.get("/api/workflows/{wf_id}/runs")
def get_workflow_runs(wf_id: str, current_user: User = Depends(get_current_user)):
    _get_user_workflow(wf_id, current_user.id)
    with Session(engine) as session:
        runs = session.exec(
            select(WorkflowRun)
            .where(WorkflowRun.workflow_id == wf_id)
            .order_by(WorkflowRun.created_at.desc())
            .limit(20)
        ).all()
    return [
        {
            "id": r.id,
            "status": r.status,
            "input_data": json.loads(r.input_data),
            "output_data": json.loads(r.output_data) if r.output_data else {},
            "error": r.error,
            "total_tokens": r.total_tokens,
            "total_cost": r.total_cost,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in runs
    ]


# ════════════════════════════════════════════════════════════════════
# Messages / History
# ════════════════════════════════════════════════════════════════════
@app.get("/api/messages")
def get_messages(
    run_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    channel: Optional[str] = None,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
):
    with Session(engine) as session:
        # Only show messages belonging to the user's agents
        user_agent_ids = [
            a.id for a in session.exec(
                select(Agent).where(Agent.user_id == current_user.id)
            ).all()
        ]
        q = select(Message).order_by(Message.created_at.desc()).limit(limit)
        if user_agent_ids:
            q = q.where(Message.agent_id.in_(user_agent_ids))
        else:
            q = q.where(Message.agent_id == None)  # no agents → no messages
        if run_id:
            q = q.where(Message.run_id == run_id)
        if agent_id:
            q = q.where(Message.agent_id == agent_id)
        if channel:
            q = q.where(Message.channel == channel)
        msgs = session.exec(q).all()

    return [
        {
            "id": m.id,
            "run_id": m.run_id,
            "agent_id": m.agent_id,
            "agent_name": m.agent_name,
            "channel": m.channel,
            "role": m.role,
            "content": m.content,
            "metadata": m.get_metadata(),
            "created_at": m.created_at.isoformat(),
        }
        for m in reversed(msgs)
    ]


# ════════════════════════════════════════════════════════════════════
# Logs
# ════════════════════════════════════════════════════════════════════
@app.get("/api/logs")
def get_logs(
    run_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    limit: int = 200,
    current_user: User = Depends(get_current_user),
):
    with Session(engine) as session:
        user_agent_ids = [
            a.id for a in session.exec(
                select(Agent).where(Agent.user_id == current_user.id)
            ).all()
        ]
        q = select(LogEntry).order_by(LogEntry.created_at.desc()).limit(limit)
        if user_agent_ids:
            q = q.where(LogEntry.agent_id.in_(user_agent_ids))
        else:
            q = q.where(LogEntry.agent_id == None)
        if run_id:
            q = q.where(LogEntry.run_id == run_id)
        if agent_id:
            q = q.where(LogEntry.agent_id == agent_id)
        logs = session.exec(q).all()
    return [
        {
            "id": l.id,
            "run_id": l.run_id,
            "agent_id": l.agent_id,
            "agent_name": l.agent_name,
            "level": l.level,
            "event": l.event,
            "details": json.loads(l.details),
            "created_at": l.created_at.isoformat(),
        }
        for l in reversed(logs)
    ]


# ════════════════════════════════════════════════════════════════════
# Channels
# ════════════════════════════════════════════════════════════════════
class ChannelCreate(BaseModel):
    name: str
    channel_type: str
    config: dict
    agent_id: Optional[str] = None


@app.get("/api/channels")
def list_channels(current_user: User = Depends(get_current_user)):
    with Session(engine) as session:
        cfgs = session.exec(
            select(ChannelConfig).where(ChannelConfig.user_id == current_user.id)
        ).all()
    active_bots = get_active_bots()
    return [
        {
            "id": c.id,
            "name": c.name,
            "channel_type": c.channel_type,
            "agent_id": c.agent_id,
            "is_active": c.is_active,
            "bot_running": c.id in active_bots,
            "created_at": c.created_at.isoformat(),
        }
        for c in cfgs
    ]


@app.post("/api/channels", status_code=201)
async def create_channel(body: ChannelCreate, current_user: User = Depends(get_current_user)):
    with Session(engine) as session:
        cfg = ChannelConfig(
            name=body.name,
            channel_type=body.channel_type,
            config=json.dumps(body.config),
            agent_id=body.agent_id,
            user_id=current_user.id,
        )
        session.add(cfg)
        session.commit()
        session.refresh(cfg)
        channel_id = cfg.id

    if body.channel_type == "telegram" and body.config.get("token") and body.agent_id:
        success = await start_bot(channel_id, body.config["token"], body.agent_id)
        if not success:
            raise HTTPException(400, "Failed to start Telegram bot — check token")

    return {"id": channel_id, "ok": True}


@app.delete("/api/channels/{channel_id}")
async def delete_channel(channel_id: str, current_user: User = Depends(get_current_user)):
    with Session(engine) as session:
        cfg = session.get(ChannelConfig, channel_id)
        if not cfg or cfg.user_id != current_user.id:
            raise HTTPException(404, "Channel not found")
        await stop_bot(channel_id)
        session.delete(cfg)
        session.commit()
    return {"ok": True}


@app.post("/api/channels/{channel_id}/restart")
async def restart_channel(channel_id: str, current_user: User = Depends(get_current_user)):
    with Session(engine) as session:
        cfg = session.get(ChannelConfig, channel_id)
        if not cfg or cfg.user_id != current_user.id:
            raise HTTPException(404, "Channel not found")
        config_data = cfg.get_config()
        token = config_data.get("token")
        agent_id = cfg.agent_id

    await stop_bot(channel_id)
    if token and agent_id:
        success = await start_bot(channel_id, token, agent_id)
        return {"ok": success}
    return {"ok": False, "error": "Missing token or agent_id"}


# ════════════════════════════════════════════════════════════════════
# LLM Provider  (public — no auth)
# ════════════════════════════════════════════════════════════════════
@app.get("/api/provider")
def get_provider():
    return get_provider_info()


# ════════════════════════════════════════════════════════════════════
# Document Validation  (public — no auth)
# ════════════════════════════════════════════════════════════════════
@app.post("/api/validate")
async def validate_document(file: UploadFile = File(...)):
    content = await file.read()
    report = doc_validator.validate_bytes(file.filename or "upload", content)
    return report.to_dict()


@app.post("/api/validate/text")
async def validate_text(body: dict):
    filename = body.get("filename", "document.txt")
    content  = body.get("content", "")
    report = doc_validator.validate_text(filename, content)
    return report.to_dict()


# ════════════════════════════════════════════════════════════════════
# Stats
# ════════════════════════════════════════════════════════════════════
@app.get("/api/stats")
def get_stats(current_user: User = Depends(get_current_user)):
    with Session(engine) as session:
        agents = session.exec(select(Agent).where(Agent.user_id == current_user.id)).all()
        workflows = session.exec(
            select(Workflow).where(
                (Workflow.user_id == current_user.id) & (Workflow.is_template == False)
            )
        ).all()
        wf_ids = [w.id for w in workflows]
        runs = session.exec(
            select(WorkflowRun).where(WorkflowRun.workflow_id.in_(wf_ids))
        ).all() if wf_ids else []
        agent_ids = [a.id for a in agents]
        messages = session.exec(
            select(Message).where(Message.agent_id.in_(agent_ids))
        ).all() if agent_ids else []

    total_tokens = sum(r.total_tokens for r in runs)
    total_cost = sum(r.total_cost for r in runs)

    return {
        "total_agents": len(agents),
        "active_agents": sum(1 for a in agents if a.is_active),
        "total_workflows": len(workflows),
        "total_runs": len(runs),
        "completed_runs": sum(1 for r in runs if r.status == "completed"),
        "failed_runs": sum(1 for r in runs if r.status == "failed"),
        "total_messages": len(messages),
        "total_tokens": total_tokens,
        "total_cost_usd": round(total_cost, 6),
        "active_bots": len(get_active_bots()),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
