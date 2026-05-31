from typing import Optional, List, Dict, Any
from datetime import datetime
from sqlmodel import SQLModel, Field, JSON, Column
import json
import uuid


def generate_id() -> str:
    return str(uuid.uuid4())


class Agent(SQLModel, table=True):
    id: str = Field(default_factory=generate_id, primary_key=True)
    user_id: Optional[str] = Field(default=None, index=True)
    name: str
    role: str
    system_prompt: str
    model: str = "gpt-4o"
    temperature: float = 0.7
    max_tokens: int = 2048
    tools: str = Field(default="[]")
    channels: str = Field(default="[]")
    memory_enabled: bool = True
    memory_window: int = 20
    guardrails: str = Field(default="{}")
    schedule: Optional[str] = None
    schedule_prompt: Optional[str] = None
    max_iterations: int = 10
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    def get_tools(self) -> List[str]:
        return json.loads(self.tools)

    def get_channels(self) -> List[Dict]:
        return json.loads(self.channels)

    def get_guardrails(self) -> Dict:
        return json.loads(self.guardrails)


class Workflow(SQLModel, table=True):
    id: str = Field(default_factory=generate_id, primary_key=True)
    user_id: Optional[str] = Field(default=None, index=True)
    name: str
    description: str = ""
    graph_json: str = Field(default="{}")
    is_template: bool = False
    template_name: Optional[str] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    def get_graph(self) -> Dict:
        return json.loads(self.graph_json)


class WorkflowRun(SQLModel, table=True):
    id: str = Field(default_factory=generate_id, primary_key=True)
    user_id: Optional[str] = Field(default=None, index=True)
    workflow_id: str = Field(foreign_key="workflow.id")
    status: str = "pending"
    input_data: str = Field(default="{}")
    output_data: str = Field(default="{}")
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    total_tokens: int = 0
    total_cost: float = 0.0


class Message(SQLModel, table=True):
    id: str = Field(default_factory=generate_id, primary_key=True)
    user_id: Optional[str] = Field(default=None, index=True)
    run_id: Optional[str] = None
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    channel: str = "internal"
    role: str = "assistant"
    content: str
    meta: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)

    def get_metadata(self) -> Dict:
        return json.loads(self.meta)


class AgentMemory(SQLModel, table=True):
    id: str = Field(default_factory=generate_id, primary_key=True)
    agent_id: str
    session_id: str
    role: str
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ChannelConfig(SQLModel, table=True):
    id: str = Field(default_factory=generate_id, primary_key=True)
    user_id: Optional[str] = Field(default=None, index=True)
    name: str
    channel_type: str
    config: str = Field(default="{}")
    agent_id: Optional[str] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)

    def get_config(self) -> Dict:
        return json.loads(self.config)


class LogEntry(SQLModel, table=True):
    id: str = Field(default_factory=generate_id, primary_key=True)
    user_id: Optional[str] = Field(default=None, index=True)
    run_id: Optional[str] = None
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    level: str = "info"
    event: str
    details: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
