"""
Tests for critical paths: agent creation, workflow execution, message delivery.
Run: pytest tests/ -v
"""
import pytest
import json
import asyncio
import os
import tempfile

# Must set DB path before importing app modules
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["DB_PATH"] = _tmp.name
os.environ["JWT_SECRET"] = "test-secret"

from db.database import create_db_and_tables, engine
from db.models import Agent, Workflow
from agents.manager import AgentManager
from agents.tools import resolve_tools, TOOL_REGISTRY
from memory.store import MemoryStore
from workflows.runner import topological_sort
from workflows.templates import get_all_templates
from main import app
from fastapi.testclient import TestClient

create_db_and_tables()
client = TestClient(app)

# ── Module-level auth setup ────────────────────────────────────────────────────
_TEST_USER = {"username": "testuser", "email": "test@example.com", "password": "Test1234!"}


def _get_auth_headers() -> dict:
    r = client.post("/api/auth/register", json=_TEST_USER)
    if r.status_code == 400:
        r = client.post("/api/auth/login", json={
            "username": _TEST_USER["username"],
            "password": _TEST_USER["password"],
        })
    assert r.status_code in (200, 201), f"Auth setup failed: {r.text}"
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


AUTH = _get_auth_headers()


# ── Auth ──────────────────────────────────────────────────────────────────────
class TestAuth:

    def test_register(self):
        r = client.post("/api/auth/register", json={
            "username": "newuser42", "email": "new42@test.com", "password": "pass1234"
        })
        assert r.status_code == 201
        data = r.json()
        assert "access_token" in data
        assert data["user"]["username"] == "newuser42"

    def test_login(self):
        client.post("/api/auth/register", json={
            "username": "logintest", "email": "login@test.com", "password": "pass1234"
        })
        r = client.post("/api/auth/login", json={"username": "logintest", "password": "pass1234"})
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_login_wrong_password(self):
        r = client.post("/api/auth/login", json={"username": "testuser", "password": "wrongpass"})
        assert r.status_code == 401

    def test_protected_route_without_token(self):
        r = client.get("/api/agents")
        assert r.status_code == 403  # FastAPI HTTPBearer returns 403 when no credentials

    def test_protected_route_with_token(self):
        r = client.get("/api/agents", headers=AUTH)
        assert r.status_code == 200

    def test_me_endpoint(self):
        r = client.get("/api/auth/me", headers=AUTH)
        assert r.status_code == 200
        assert r.json()["username"] == "testuser"


# ── Agent CRUD ────────────────────────────────────────────────────────────────
class TestAgentCRUD:

    def test_create_agent_minimal(self):
        agent = AgentManager.create(name="T1", role="Tester", system_prompt="Test.")
        assert agent.id is not None
        assert agent.name == "T1"
        assert agent.model == "llama-3.3-70b-versatile"

    def test_create_agent_with_tools(self):
        agent = AgentManager.create(name="T2", role="R", system_prompt="S",
                                    tools=["web_search", "calculator"])
        assert "web_search" in agent.get_tools()
        assert "calculator" in agent.get_tools()

    def test_get_agent(self):
        agent = AgentManager.create(name="T3", role="R", system_prompt="S")
        fetched = AgentManager.get(agent.id)
        assert fetched.id == agent.id

    def test_get_nonexistent_agent(self):
        assert AgentManager.get("nonexistent") is None

    def test_update_agent(self):
        agent = AgentManager.create(name="T4", role="R", system_prompt="S")
        updated = AgentManager.update(agent.id, name="Updated T4", temperature=0.3)
        assert updated.name == "Updated T4"
        assert updated.temperature == 0.3

    def test_delete_agent(self):
        agent = AgentManager.create(name="T5", role="R", system_prompt="S")
        assert AgentManager.delete(agent.id) is True
        assert AgentManager.get(agent.id) is None

    def test_list_agents(self):
        AgentManager.create(name="List1", role="R", system_prompt="S")
        AgentManager.create(name="List2", role="R", system_prompt="S")
        names = [a.name for a in AgentManager.list_all()]
        assert "List1" in names
        assert "List2" in names


# ── API Endpoints ──────────────────────────────────────────────────────────────
class TestAgentAPI:

    def test_list_agents(self):
        resp = client.get("/api/agents", headers=AUTH)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_create_agent(self):
        resp = client.post("/api/agents", headers=AUTH, json={
            "name": "API Agent", "role": "Test", "system_prompt": "You test.",
            "tools": ["calculator"],
        })
        assert resp.status_code == 201
        assert resp.json()["name"] == "API Agent"
        assert "calculator" in resp.json()["tools"]

    def test_get_agent(self):
        r = client.post("/api/agents", headers=AUTH, json={"name": "Get Me", "role": "R", "system_prompt": "S"})
        resp = client.get(f"/api/agents/{r.json()['id']}", headers=AUTH)
        assert resp.status_code == 200
        assert resp.json()["name"] == "Get Me"

    def test_get_nonexistent(self):
        assert client.get("/api/agents/bad-id", headers=AUTH).status_code == 404

    def test_update_agent(self):
        r = client.post("/api/agents", headers=AUTH, json={"name": "Orig", "role": "R", "system_prompt": "S"})
        resp = client.patch(f"/api/agents/{r.json()['id']}", headers=AUTH, json={"name": "Renamed"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Renamed"

    def test_delete_agent(self):
        r = client.post("/api/agents", headers=AUTH, json={"name": "Del", "role": "R", "system_prompt": "S"})
        aid = r.json()['id']
        assert client.delete(f"/api/agents/{aid}", headers=AUTH).status_code == 200
        assert client.get(f"/api/agents/{aid}", headers=AUTH).status_code == 404

    def test_data_isolation(self):
        """Agents created by one user must not be visible to another."""
        r2 = client.post("/api/auth/register", json={
            "username": "user2iso", "email": "u2@iso.com", "password": "pass1234"
        })
        auth2 = {"Authorization": f"Bearer {r2.json()['access_token']}"}

        # user1 creates an agent
        client.post("/api/agents", headers=AUTH, json={"name": "User1Agent", "role": "R", "system_prompt": "S"})

        # user2 should not see it
        agents2 = client.get("/api/agents", headers=auth2).json()
        names2 = [a["name"] for a in agents2]
        assert "User1Agent" not in names2


# ── Tools ─────────────────────────────────────────────────────────────────────
class TestTools:

    def test_all_tools_resolve(self):
        for name in TOOL_REGISTRY:
            assert len(resolve_tools([name])) == 1

    def test_unknown_tool_ignored(self):
        assert resolve_tools(["nonexistent"]) == []

    def test_calculator(self):
        from agents.tools import calculator
        assert calculator.invoke("2 + 2") == "4"

    def test_calculator_invalid(self):
        from agents.tools import calculator
        assert "Error" in calculator.invoke("import os")

    def test_current_time(self):
        from agents.tools import get_current_time
        r = get_current_time.invoke("UTC")
        assert "UTC" in r

    def test_tools_api(self):
        resp = client.get("/api/tools")
        assert resp.status_code == 200
        names = [t["name"] for t in resp.json()]
        assert "web_search" in names
        assert "calculator" in names


# ── Workflow Topology ─────────────────────────────────────────────────────────
class TestWorkflowTopology:

    def test_linear_sort(self):
        nodes = [{"id": "A"}, {"id": "B"}, {"id": "C"}]
        edges = [{"source": "A", "target": "B"}, {"source": "B", "target": "C"}]
        order = topological_sort(nodes, edges)
        assert order == ["A", "B", "C"]

    def test_single_node(self):
        assert topological_sort([{"id": "X"}], []) == ["X"]

    def test_parallel_sources(self):
        nodes = [{"id": "A"}, {"id": "B"}, {"id": "C"}]
        edges = [{"source": "A", "target": "C"}, {"source": "B", "target": "C"}]
        order = topological_sort(nodes, edges)
        assert order.index("C") > order.index("A")
        assert order.index("C") > order.index("B")


# ── Templates ────────────────────────────────────────────────────────────────
class TestTemplates:

    def test_templates_exist(self):
        assert len(get_all_templates()) >= 2

    def test_templates_have_required_fields(self):
        for t in get_all_templates():
            assert "name" in t and "template_name" in t
            assert "nodes" in t["graph"] and "edges" in t["graph"]

    def test_templates_api(self):
        from main import _seed_templates
        _seed_templates()
        resp = client.get("/api/workflows/templates", headers=AUTH)
        assert resp.status_code == 200
        assert len(resp.json()) >= 2

    def test_workflow_create(self):
        resp = client.post("/api/workflows", headers=AUTH, json={
            "name": "My WF", "description": "test",
            "graph_json": {"nodes": [], "edges": []},
        })
        assert resp.status_code == 201
        assert resp.json()["name"] == "My WF"


# ── Memory Store ──────────────────────────────────────────────────────────────
class TestMemoryStore:

    def test_load_empty(self):
        store = MemoryStore()
        msgs = asyncio.new_event_loop().run_until_complete(store.load("ag-x", "s-1"))
        assert msgs == []

    def test_save_and_load(self):
        from langchain_core.messages import HumanMessage, AIMessage
        store = MemoryStore()
        loop = asyncio.new_event_loop()
        loop.run_until_complete(store.save("ag-y", "s-2",
            HumanMessage(content="Hello"), AIMessage(content="Hi")))
        msgs = loop.run_until_complete(store.load("ag-y", "s-2"))
        assert len(msgs) == 2
        assert msgs[0].content == "Hello"

    def test_clear_memory(self):
        from langchain_core.messages import HumanMessage, AIMessage
        store = MemoryStore()
        loop = asyncio.new_event_loop()
        loop.run_until_complete(store.save("ag-z", "s-3",
            HumanMessage(content="test"), AIMessage(content="ok")))
        loop.run_until_complete(store.clear("ag-z", "s-3"))
        msgs = loop.run_until_complete(store.load("ag-z", "s-3"))
        assert msgs == []


# ── Stats ─────────────────────────────────────────────────────────────────────
class TestStats:

    def test_stats_endpoint(self):
        resp = client.get("/api/stats", headers=AUTH)
        assert resp.status_code == 200
        data = resp.json()
        for key in ["total_agents", "total_runs", "total_tokens", "total_cost_usd"]:
            assert key in data


# ── Channels API ──────────────────────────────────────────────────────────────
class TestChannelsAPI:

    def test_list_channels(self):
        resp = client.get("/api/channels", headers=AUTH)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
