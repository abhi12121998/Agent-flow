# Yuno — AI Agent Orchestration Platform

A full-stack platform for creating, configuring, and orchestrating AI agents into collaborative multi-agent workflows — with real LangGraph execution, PostgreSQL persistence, a visual workflow builder, and Telegram integration.

---

## Quick Start (Local)

**Requirements:** Python 3.10+, Node 18+, npm

```bash
git clone https://github.com/abhi12121998/Agent-flow.git
cd Agent-flow
cp backend/.env.example .env      # add GROQ_API_KEY and JWT_SECRET
./setup.sh                        # installs deps, starts both servers
```

Open **http://localhost:5173** in your browser. Register an account and start building agents.

---

## Technology Choices & Justifications

### Language: Python (Backend) + JavaScript/React (Frontend)

**Python** is the natural home of the LangChain/LangGraph ecosystem. Using any other language would require bridging or reimplementing the model integrations, tool-calling protocol, and agent state management. FastAPI was chosen because it provides native async support (essential for non-blocking LLM calls), automatic OpenAPI docs at `/docs`, and WebSocket support out of the box. SQLModel gives type-safe SQLAlchemy models with Pydantic validation — one schema definition serves both DB and API serialization.

**React + Vite** was chosen for the frontend because ReactFlow is the leading open-source library for interactive node-based canvas UIs — exactly what a workflow builder needs. Vite provides near-instant HMR. Plain CSS variables (no component library) keep the bundle small and the styles fully controlled.

### AI Framework: LangGraph

LangGraph was chosen over CrewAI, AutoGen, and custom runtimes for these reasons:

1. **Explicit graph topology** — each agent is a compiled `StateGraph` with an `agent_node ↔ tools_node` ReAct loop. Execution flow is deterministic and fully inspectable, not emergent.
2. **Composable at the platform level** — individual agent graphs remain self-contained and are composed at the workflow level by the `WorkflowRunner`. This maps directly to the visual node-based UI model.
3. **Native tool use** — `ToolNode` + `bind_tools` provides clean ReAct-style tool loops without manual prompt engineering around tool formatting.
4. **First-class async** — LangGraph runs in a thread pool via `run_in_executor`, keeping the FastAPI event loop non-blocking while WebSocket events broadcast in real time.
5. **Condition branches** — LangGraph's conditional edges map naturally to the workflow builder's condition nodes.

**Why not the others:**
- **CrewAI**: Higher-level abstraction with less control over the execution graph; harder to introspect per-step state.
- **AutoGen**: Conversation-centric (agents talk to each other via messages) — good for chat simulations, but awkward to wire into a deterministic DAG with typed outputs.
- **Custom runtime**: No tool ecosystem; would require reimplementing tool calling, state management, and retry logic from scratch.

### LLM Provider: Groq (LLaMA 3.3 70B)

Groq was chosen as the sole LLM provider because it offers a free API tier with no credit card required, making the platform immediately runnable for any evaluator. Groq's inference speed (tokens/sec) is significantly faster than standard OpenAI endpoints, which improves the user experience in the visual workflow builder.

Models available:

| Model | Use case |
|---|---|
| `llama-3.3-70b-versatile` | Default — best quality |
| `llama-3.1-8b-instant` | Fast, low-latency tasks |
| `mixtral-8x7b-32768` | Long context tasks |
| `gemma2-9b-it` | Lightweight instruction following |

### Persistence: PostgreSQL via Neon (SQLite fallback)

Neon provides serverless PostgreSQL with a generous free tier and zero-config connection pooling. The platform auto-detects the `DATABASE_URL` environment variable — if set, it connects to PostgreSQL; if absent, it falls back to SQLite for local development with no additional setup.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     React Frontend (Vite)                       │
│   AgentStudio │ WorkflowBuilder (ReactFlow) │ Monitor │ Channels│
└────────────────────────────┬────────────────────────────────────┘
                             │ REST + WebSocket
┌────────────────────────────▼────────────────────────────────────┐
│                       FastAPI Backend                           │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Agent Manager│  │  Scheduler   │  │  WebSocket Manager   │  │
│  │  (CRUD)      │  │ (APScheduler)│  │  (broadcast events)  │  │
│  └──────┬───────┘  └──────────────┘  └──────────────────────┘  │
│         │                                                       │
│  ┌──────▼─────────────────────────────────────────────┐         │
│  │             LangGraph Agent Runtime                │         │
│  │   ┌─────────┐      ┌───────────┐                  │         │
│  │   │  agent  │◄────►│   tools   │  ReAct loop      │         │
│  │   │  node   │      │   node    │  per agent       │         │
│  │   └─────────┘      └───────────┘                  │         │
│  └────────────────────────────────────────────────────┘         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Workflow    │  │   Memory     │  │  Telegram Channel    │  │
│  │  Runner      │  │   Store      │  │  (python-telegram-   │  │
│  │ (topo-sort)  │  │  (per agent) │  │   bot polling)       │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │        PostgreSQL (Neon) / SQLite (local fallback)      │    │
│  │  Agent │ Workflow │ WorkflowRun │ Message │ Memory │ Log│    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Layer Separation

| Layer | Location | Responsibility |
|---|---|---|
| **UI** | `frontend-react/src/` | React pages, ReactFlow canvas, WebSocket listener |
| **API** | `backend/main.py` | FastAPI routes, auth, request validation |
| **Agent Runtime** | `backend/agents/runtime.py` | LangGraph graph build & execution |
| **Workflow Orchestration** | `backend/workflows/runner.py` | Topological sort, agent sequencing, output passing |
| **Persistence** | `backend/db/` | SQLModel models, PostgreSQL/SQLite engine |
| **Channels** | `backend/channels/telegram.py` | Telegram bot polling, message routing |
| **Auth** | `backend/auth/` | JWT register/login, per-user data isolation |

---

## Project Structure

```
Agent-flow/
├── Dockerfile                   # Root Dockerfile for Render/cloud deployment
├── docker-compose.yml           # Local full-stack with Docker
├── render.yaml                  # Render deployment config (backend + frontend)
├── setup.sh                     # Single-command local startup
├── .env.example                 # Environment variable template
│
├── backend/
│   ├── main.py                  # FastAPI app, all routes, startup
│   ├── requirements.txt
│   ├── Dockerfile               # Backend Dockerfile (for docker-compose)
│   ├── db/
│   │   ├── models.py            # SQLModel table definitions
│   │   └── database.py          # Engine, session factory (Postgres/SQLite)
│   ├── agents/
│   │   ├── runtime.py           # LangGraph ReAct agent builder + runner
│   │   ├── manager.py           # Agent CRUD
│   │   └── tools.py             # Built-in tool registry
│   ├── workflows/
│   │   ├── runner.py            # Multi-agent workflow orchestrator
│   │   └── templates.py         # Pre-built workflow template definitions
│   ├── memory/
│   │   └── store.py             # Per-agent conversation memory (sliding window)
│   ├── channels/
│   │   └── telegram.py          # Telegram bot polling integration
│   ├── auth/
│   │   ├── router.py            # Register / login / me endpoints
│   │   ├── dependencies.py      # JWT decode, get_current_user
│   │   └── models.py            # User table
│   ├── ws_manager.py            # WebSocket broadcast manager
│   └── scheduler.py             # APScheduler cron jobs
│
└── frontend-react/
    └── src/
        ├── App.jsx              # Root layout, sidebar navigation, auth gate
        ├── AgentStudio.jsx      # Agent list + inline chat
        ├── AgentModal.jsx       # Create/edit agent form (5 tabs)
        ├── WorkflowBuilder.jsx  # ReactFlow canvas + run panel
        ├── Monitor.jsx          # Live events, messages, logs
        ├── Channels.jsx         # Telegram channel management
        ├── Auth.jsx             # Login / register screen
        ├── api.js               # All fetch calls + WebSocket factory
        └── toast.jsx            # Toast notification hook
```

---

## Feature Walkthrough

### Agent Studio
- Create agents with name, role, system prompt, model, temperature, max tokens, max iterations
- Assign tools per agent: `web_search`, `calculator`, `http_get`, `json_parse`, `summarize_text`, `get_current_time`
- Configure memory window (sliding window of past messages per session)
- Set guardrails (forbidden topics, max response length)
- Schedule agents with cron expressions (APScheduler)
- Chat with any agent inline — token count displayed per response

### Workflow Builder
- Visual drag-and-drop canvas (ReactFlow)
- **Agent nodes** — assign an agent + a task prompt
- **Condition nodes** — keyword gate; branches on upstream output
- Connect nodes with edges — execution follows topological sort order
- Upstream agent outputs are automatically passed as context to downstream agents
- 3 pre-built templates: Research & Summarize, Content Review Pipeline, Market Intelligence Report
- Save workflows and run with a prompt — output streams in the run panel
- Delete workflows from the sidebar

### Monitor
- **Live Events** — WebSocket stream of every agent start/end, LLM response, workflow step, and condition evaluation (color-coded)
- **Messages** — full persisted message history across agents and channels
- **Logs** — structured execution logs with level, event, agent name, and run ID

### Channels (Telegram)
- Paste a Telegram bot token (from @BotFather) and assign an agent
- Bot starts immediately via polling — no webhook or SSL setup required
- Users chat conversationally; memory is per Telegram chat ID
- Multiple bots run simultaneously, one per channel config
- Bots restart automatically on platform restart

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | **Yes** | Groq API key — get free at [console.groq.com](https://console.groq.com) |
| `JWT_SECRET` | **Yes** | Random secret for signing JWT tokens. Generate: `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `DATABASE_URL` | No | PostgreSQL connection string (e.g. Neon). Falls back to SQLite when unset. |

---

## Authentication

Every user registers and receives a **7-day JWT token** stored in `localStorage`.

- All `/api/*` routes require a `Bearer` token (except `/api/provider` and `/api/tools`)
- Each user's agents, workflows, channels, messages, and logs are fully isolated
- The WebSocket (`/ws`) accepts an optional `?token=` query param
- On `401`, the frontend auto-clears the token and returns to the login screen

---

## API Reference

Full interactive docs at **http://localhost:8000/docs**

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login, get token |
| GET | `/api/auth/me` | Current user info |
| GET / POST | `/api/agents` | List / create agents |
| GET / PATCH / DELETE | `/api/agents/{id}` | Get / update / delete agent |
| POST | `/api/agents/{id}/chat` | Chat with agent |
| GET / DELETE | `/api/agents/{id}/memory` | View / clear memory |
| GET | `/api/tools` | List available tools |
| GET / POST | `/api/workflows` | List / create workflows |
| GET | `/api/workflows/templates` | List pre-built templates |
| PATCH / DELETE | `/api/workflows/{id}` | Update / delete workflow |
| POST | `/api/workflows/{id}/run` | Execute workflow |
| GET | `/api/workflows/{id}/runs` | Execution history |
| GET | `/api/messages` | Message history (filterable) |
| GET | `/api/logs` | Execution logs |
| GET / POST | `/api/channels` | List / create channels |
| DELETE | `/api/channels/{id}` | Stop and delete channel |
| POST | `/api/channels/{id}/restart` | Restart bot |
| GET | `/api/stats` | Platform-wide stats |
| GET / HEAD | `/` | Health check |
| WS | `/ws` | Real-time event stream |

---

## Deployment (Render + Neon)

### 1. Neon PostgreSQL
1. Sign up at [neon.tech](https://neon.tech) — free tier is sufficient
2. Create a project, copy the connection string

### 2. Backend — Render Web Service
1. New Web Service → connect `abhi12121998/Agent-flow`
2. Runtime: **Docker**, Dockerfile: `./Dockerfile`
3. Add environment variables:
   ```
   DATABASE_URL=<neon connection string>
   GROQ_API_KEY=<your key>
   JWT_SECRET=<random hex>
   ```

### 3. Frontend — Render Static Site
1. New Static Site → same repo
2. Root directory: `frontend-react`
3. Build command: `npm install && npm run build`
4. Publish directory: `dist`
5. Add environment variable:
   ```
   VITE_API_URL=<your backend Render URL>
   ```

### Local with Docker Compose
```bash
cp backend/.env.example .env   # fill in GROQ_API_KEY and JWT_SECRET
docker compose up --build
```
Frontend → http://localhost:3000 · Backend → http://localhost:8000/docs

---

## Adding a New Workflow Template

1. Open `backend/workflows/templates.py` and add to `TEMPLATES`:

```python
{
    "name": "My Template",
    "description": "What it does.",
    "template_name": "my_template",   # must be unique
    "graph": {
        "nodes": [
            {
                "id": "node_1",
                "type": "agent",
                "position": {"x": 100, "y": 200},
                "data": {
                    "label": "Step 1",
                    "role": "Analyst",
                    "task": "__user_input__",
                    "agent_id": None,
                },
            },
        ],
        "edges": [],
    },
}
```

2. Restart the backend — templates are seeded on startup automatically.

---

## Adding a New Messaging Channel

1. Create `backend/channels/slack.py` following the interface in `telegram.py`:
   - `start_bot(channel_id, token, agent_id) -> bool`
   - `stop_bot(channel_id) -> bool`
   - `get_active_bots() -> dict`
   - `restart_all_bots()`

2. Route incoming messages to `AgentRunner.run()` and send the response back via the channel SDK.

3. In `backend/main.py`, add the new type to `create_channel`:
```python
if body.channel_type == "slack" and body.config.get("token") and body.agent_id:
    success = await slack.start_bot(channel_id, body.config["token"], body.agent_id)
```

4. In `frontend-react/src/Channels.jsx`, add the new channel type to the form and display its setup guide.

---

## Async Architecture Note

LangGraph's compiled graph `.invoke()` is synchronous. To avoid blocking FastAPI's event loop:

```python
final_state = await asyncio.get_event_loop().run_in_executor(
    None, lambda: self.graph.invoke(state)
)
```

WebSocket events are broadcast from inside the agent callback using `asyncio.run_coroutine_threadsafe`, so live updates stream to the UI during execution without blocking.

---

## Evaluation Checklist

| Criterion | Status |
|---|---|
| Agent CRUD (name, role, system prompt, model, tools) | ✅ |
| Agent config: schedules, memory, guardrails | ✅ |
| Visual workflow builder with condition nodes | ✅ |
| At least 2 pre-built workflow templates | ✅ 3 templates |
| External channel integration (Telegram) | ✅ |
| Live monitoring: logs, messages, token tracking | ✅ |
| Asynchronous agent execution | ✅ LangGraph in thread pool |
| Message history persisted and visible | ✅ |
| Real runtime execution (not UI mockup) | ✅ LangGraph ReAct |
| AI framework justified in README | ✅ LangGraph |
| Language/stack justified in README | ✅ |
| Runs fully local with single command | ✅ `./setup.sh` |
| Web-based UI | ✅ React + Vite |
| Persistence layer | ✅ PostgreSQL (Neon) / SQLite |
| Messaging channel integration | ✅ Telegram |
| README with architecture, setup, justifications | ✅ |
| Instructions for adding templates / channels | ✅ |
