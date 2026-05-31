# Yuno Platform — Technical Documentation

Complete reference for the codebase: how each module works, how they connect, and how data flows through the system.

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Backend](#backend)
   - [Entry Point — main.py](#entry-point--mainpy)
   - [Database Layer](#database-layer)
   - [Authentication](#authentication)
   - [Agent System](#agent-system)
   - [LLM Provider](#llm-provider)
   - [Workflow System](#workflow-system)
   - [Memory Store](#memory-store)
   - [Channels — Telegram](#channels--telegram)
   - [Scheduler](#scheduler)
   - [WebSocket Manager](#websocket-manager)
3. [Frontend](#frontend)
   - [App.jsx — Root](#appjsx--root)
   - [AgentStudio.jsx](#agentstudiojsx)
   - [AgentModal.jsx](#agentmodaljsx)
   - [WorkflowBuilder.jsx](#workflowbuilderjsx)
   - [Monitor.jsx](#monitorjsx)
   - [Channels.jsx](#channelsjsx)
   - [api.js](#apijs)
4. [Data Models](#data-models)
5. [API Reference](#api-reference)
6. [WebSocket Events](#websocket-events)
7. [Data Flow — Agent Chat](#data-flow--agent-chat)
8. [Data Flow — Workflow Run](#data-flow--workflow-run)

---

## Project Structure

```
Agent-flow/
├── Dockerfile                  # Production Docker image (root context, for Render)
├── docker-compose.yml          # Local full-stack with Docker
├── render.yaml                 # Render deployment config
├── setup.sh                    # Single-command local startup script
├── .env.example                # Environment variable template
│
├── backend/
│   ├── main.py                 # FastAPI app + all REST routes
│   ├── requirements.txt
│   ├── Dockerfile              # Backend-only image (for docker-compose)
│   │
│   ├── db/
│   │   ├── database.py         # Engine creation, session factory
│   │   └── models.py           # All SQLModel table definitions
│   │
│   ├── auth/
│   │   ├── models.py           # User table
│   │   ├── router.py           # /api/auth/* endpoints
│   │   └── dependencies.py     # JWT encode/decode, get_current_user
│   │
│   ├── agents/
│   │   ├── manager.py          # Agent CRUD (create/get/update/delete)
│   │   ├── runtime.py          # LangGraph ReAct graph builder + runner
│   │   └── tools.py            # Built-in tool definitions + registry
│   │
│   ├── workflows/
│   │   ├── runner.py           # Multi-agent DAG execution engine
│   │   └── templates.py        # Pre-built template definitions
│   │
│   ├── memory/
│   │   └── store.py            # Per-agent conversation memory (DB-backed)
│   │
│   ├── channels/
│   │   └── telegram.py         # Telegram bot polling integration
│   │
│   ├── llm_provider.py         # Groq LLM resolver
│   ├── ws_manager.py           # WebSocket connection manager + broadcast
│   ├── scheduler.py            # APScheduler cron job management
│   └── tests/
│       └── test_platform.py
│
└── frontend-react/
    ├── vite.config.js
    ├── nginx.conf              # Nginx config for production static serving
    └── src/
        ├── main.jsx
        ├── App.jsx             # Root layout, auth gate, sidebar nav
        ├── AgentStudio.jsx     # Agent list + inline chat
        ├── AgentModal.jsx      # Create/edit agent form
        ├── WorkflowBuilder.jsx # ReactFlow canvas + run panel
        ├── Monitor.jsx         # Live events, messages, logs
        ├── Channels.jsx        # Telegram channel management
        ├── Auth.jsx            # Login / register screen
        ├── api.js              # All API calls + WebSocket factory
        └── toast.jsx           # Toast notification system
```

---

## Backend

### Entry Point — main.py

`backend/main.py` is the FastAPI application. It:

- Creates the FastAPI app and configures CORS middleware
- Mounts the auth router (`/api/auth/*`)
- Defines all REST API routes
- Handles the WebSocket endpoint (`/ws`)
- Runs startup/shutdown lifecycle events

**Startup sequence (`@app.on_event("startup")`):**
1. `create_db_and_tables()` — creates all tables in PostgreSQL/SQLite if they don't exist
2. `_seed_templates()` — inserts the 3 built-in workflow templates if not already present
3. `reload_all_schedules()` — restores cron jobs for all agents that have a schedule
4. `scheduler.start()` — starts the APScheduler background scheduler
5. `asyncio.create_task(restart_all_bots())` — restarts any active Telegram bots

**CORS:**
```python
allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"]
```
`allow_credentials=False` is required when using `allow_origins=["*"]` (browser enforces this).

---

### Database Layer

**`db/database.py`**

Detects the database to use based on environment:

```python
if DATABASE_URL is set:
    → PostgreSQL (Neon or any Postgres)
else:
    → SQLite at ./yuno.db (local fallback)
```

Both a sync `engine` (used by most routes) and an async `async_engine` (available for future use) are created. The `create_db_and_tables()` function calls `SQLModel.metadata.create_all(engine)` which creates all tables on first startup.

**`db/models.py`**

All database tables defined as SQLModel classes:

| Model | Table | Key fields |
|---|---|---|
| `User` | `users` | id, username, email, hashed_password, is_active |
| `Agent` | `agent` | id, user_id, name, role, system_prompt, model, tools (JSON), memory_enabled, schedule |
| `Workflow` | `workflow` | id, user_id, name, graph_json, is_template, template_name |
| `WorkflowRun` | `workflowrun` | id, workflow_id, status, input_data, output_data, total_tokens, total_cost |
| `Message` | `message` | id, agent_id, run_id, channel, role, content, meta (JSON) |
| `AgentMemory` | `agentmemory` | id, agent_id, session_id, role, content |
| `ChannelConfig` | `channelconfig` | id, user_id, name, channel_type, config (JSON), agent_id |
| `LogEntry` | `logentry` | id, run_id, agent_id, level, event, details (JSON) |

JSON fields (`tools`, `channels`, `guardrails`, `config`, `meta`, `details`) are stored as serialized strings and deserialized via helper methods (`get_tools()`, `get_channels()`, etc.).

---

### Authentication

**`auth/models.py`** — `User` table with `id`, `username`, `email`, `hashed_password`, `is_active`.

**`auth/dependencies.py`** — Core auth utilities:

- `hash_password(password)` — bcrypt hash via passlib
- `verify_password(plain, hashed)` — bcrypt verify
- `create_access_token(data)` — creates a JWT with 7-day expiry signed with `JWT_SECRET`
- `get_current_user(credentials)` — FastAPI dependency; decodes the Bearer token and fetches the user from DB. Used as `Depends(get_current_user)` on all protected routes.

**`auth/router.py`** — Three endpoints:

- `POST /api/auth/register` — validates username/email uniqueness, hashes password, creates user, returns token
- `POST /api/auth/login` — verifies credentials, returns token
- `GET /api/auth/me` — returns current user info (requires token)

**Data isolation:** Every protected route receives `current_user` from the dependency and filters all DB queries by `user_id`. Users cannot access each other's agents, workflows, channels, messages, or logs.

---

### Agent System

#### `agents/manager.py` — AgentManager

Static class that wraps all agent database operations. Handles JSON serialization/deserialization for `tools`, `channels`, and `guardrails` fields automatically on create and update.

Methods: `create()`, `get(agent_id)`, `list_all()`, `update(agent_id, **kwargs)`, `delete(agent_id)`

#### `agents/tools.py` — Built-in Tools

Six tools registered in `TOOL_REGISTRY`:

| Tool | Description |
|---|---|
| `web_search` | DuckDuckGo search via `langchain_community` |
| `calculator` | Safe `eval()` with `math` module — no builtins exposed |
| `http_get` | HTTP GET via `httpx`, response truncated to 2000 chars |
| `json_parse` | Parse and pretty-print JSON |
| `summarize_text` | Returns first 1000 chars of long text |
| `get_current_time` | Current UTC datetime |

`resolve_tools(tool_names)` takes a list of tool name strings and returns instantiated LangChain tool objects ready for `bind_tools()`.

#### `agents/runtime.py` — LangGraph Agent Runner

This is the core execution engine. Each agent runs as a compiled LangGraph `StateGraph`.

**`AgentState` (TypedDict):**
```python
messages: List[BaseMessage]   # full conversation including history
agent_id: str
agent_name: str
run_id: Optional[str]
iteration: int                # tracks ReAct loop depth
total_tokens: int
total_cost: float
```

**Graph structure:**
```
__start__ → agent_node → (has tool calls?) → tools_node → agent_node → ...
                       → (no tool calls)  → __end__
```

**`build_agent_graph(agent_cfg, event_callback, loop_holder)`:**
1. Resolves tools from the agent's config via `resolve_tools()`
2. Creates the Groq LLM via `resolve_llm()` and binds tools with `llm.bind_tools(tools)`
3. Defines `agent_node` — injects system prompt, calls the LLM, tracks token usage, fires `llm_response` WebSocket event
4. Defines `should_continue` — checks if the last message has `tool_calls`; if yes, routes to `tools_node`, otherwise ends
5. Compiles and returns the graph

**Groq/LLaMA tool call fallback:** If the model generates a malformed tool call (`tool_use_failed`), the runtime catches the exception and retries without tools so the agent can still respond.

**`AgentRunner.run(user_input, session_id, run_id, extra_context)`:**
1. Loads conversation history from `MemoryStore` (if memory enabled)
2. Prepends upstream context if running inside a workflow (`extra_context`)
3. Runs `graph.invoke(state)` in a thread pool via `run_in_executor` (keeps FastAPI async)
4. Saves the human + AI messages to `MemoryStore`
5. Returns `{content, total_tokens, total_cost, iterations}`

**Why thread pool?** LangGraph's `.invoke()` is synchronous. Running it directly in an async FastAPI handler would block the event loop. `run_in_executor` moves it to a thread while keeping the handler awaitable. WebSocket callbacks use `asyncio.run_coroutine_threadsafe` to broadcast events from the thread back to the async event loop.

---

### LLM Provider

**`llm_provider.py`**

Single function `resolve_llm(model, temperature, max_tokens)` returns a `ChatGroq` instance.

- If the requested model name is not in `GROQ_MODELS`, falls back to `llama-3.3-70b-versatile`
- Temperature is capped at 1.0 (Groq limit)
- Max tokens capped at 8192 (Groq free tier limit)
- `model_kwargs={"tool_choice": "auto"}` nudges LLaMA to use the correct tool-call format

---

### Workflow System

#### `workflows/templates.py`

Defines `TEMPLATES` — a list of 3 pre-built workflow graphs:

| Template | Agents | Description |
|---|---|---|
| Research & Summarize | 2 | Researcher (web_search) → Summarizer |
| Content Review Pipeline | 3 | Writer → Critic → Editor |
| Market Intelligence Report | 2 | Analyst (web_search) → Reporter |

Each template node has `agent_id: None` — users assign real agents after loading. Templates are seeded to the DB on startup via `_seed_templates()` using the `template_name` field to avoid duplicates.

#### `workflows/runner.py` — WorkflowRunner

Executes a workflow DAG by:

1. **Loading** the workflow's `graph_json` from DB (contains `nodes` and `edges`)
2. **Creating** a `WorkflowRun` record with status `"running"`
3. **Topological sort** — `topological_sort(nodes, edges)` uses Kahn's algorithm (BFS with in-degree tracking) to produce a linear execution order respecting all dependencies
4. **Executing each node** in order:
   - **Agent node**: looks up the agent, collects outputs from all upstream nodes as `extra_context`, runs `AgentRunner.run()`, stores output in `node_outputs[node_id]`
   - **Condition node**: checks if a keyword exists in the upstream node's output; stores `"true"` or `"false"` in `node_outputs`
5. **Final output** is the output of the last node in topological order
6. **Updates** the `WorkflowRun` record with status, output, token totals, and timestamps
7. Broadcasts WebSocket events at each step: `workflow_start`, `node_start`, `node_complete`, `condition_eval`, `workflow_complete` / `workflow_error`

---

### Memory Store

**`memory/store.py` — MemoryStore**

Stores per-agent conversation history in the `AgentMemory` table.

- **`load(agent_id, session_id, window)`** — fetches the last `window` messages ordered by `created_at DESC`, reverses them (chronological order), and maps roles (`human` → `HumanMessage`, `ai` → `AIMessage`, `system` → `SystemMessage`)
- **`save(agent_id, session_id, human_msg, ai_msg)`** — writes one human and one AI message entry
- **`clear(agent_id, session_id)`** — deletes all memory for that agent+session
- **`get_all_sessions(agent_id)`** — returns all distinct session IDs for an agent

Memory is keyed by `(agent_id, session_id)`. For direct chat the session is `"default"` or a user-provided ID. For Telegram it's `telegram_{chat_id}`. For workflow runs it's the `run_id`.

---

### Channels — Telegram

**`channels/telegram.py`**

Manages multiple Telegram bots simultaneously using `python-telegram-bot`.

**`start_bot(channel_id, token, agent_id)`:**
1. Builds a `telegram.ext.Application` with the bot token
2. Registers handlers: `/start` command and all text messages
3. Starts polling with `drop_pending_updates=True` (ignores messages received while offline)
4. Stores the running app in `_active_bots[channel_id]`

**`_handle_message(update, context)`:**
1. Persists the incoming Telegram message to the `Message` table
2. Shows a typing indicator via `send_chat_action`
3. Runs `AgentRunner.run()` with `session_id=f"telegram_{chat_id}"` (so each Telegram chat has isolated memory)
4. Splits replies longer than 4000 chars (Telegram's limit) into multiple messages

**`restart_all_bots()`** — called on startup; queries all active `ChannelConfig` records of type `telegram` and calls `start_bot()` for each.

---

### Scheduler

**`scheduler.py`**

Uses APScheduler's `AsyncIOScheduler` to run agents on a cron schedule.

- **`register_agent_schedule(agent_id, cron)`** — parses the cron string with `CronTrigger.from_crontab()` and registers a job that calls `_run_scheduled_agent(agent_id)`
- **`_run_scheduled_agent(agent_id)`** — fetches the agent, runs it with `schedule_prompt` as input, session `"scheduled"`
- **`unregister_agent_schedule(agent_id)`** — removes the job if it exists
- **`reload_all_schedules()`** — called on startup; re-registers all active agents that have a cron expression

---

### WebSocket Manager

**`ws_manager.py` — ConnectionManager**

Maintains a set of active WebSocket connections and broadcasts events to all of them.

- **`connect(ws)`** — accepts the WebSocket and adds it to `active`
- **`disconnect(ws)`** — removes from `active`
- **`broadcast(data)`** — serializes `data` to JSON and sends to all active connections; removes dead connections silently

**`broadcast_event(event)`** — async wrapper passed to `AgentRunner` and `WorkflowRunner` as a callback. Called on every agent/workflow event so the Monitor page updates in real time.

**WebSocket auth:** The `/ws` endpoint accepts an optional `?token=` query param. If provided, the JWT is verified before the connection is accepted. If verification fails, the connection is closed with code `4001`.

---

## Frontend

### App.jsx — Root

Manages the top-level application state:

- **Auth gate**: On mount, reads `yuno_token` from `localStorage`, calls `GET /api/auth/me` to validate it. Shows `Auth.jsx` if no valid token, otherwise shows the main layout.
- **Logout**: Listens for the `yuno:logout` custom event (fired by `api.js` on any `401` response) and clears the user state.
- **Sidebar**: Renders navigation buttons for Agent Studio, Workflows, Monitor, Channels.
- **Page rendering**: Conditionally renders the active page component.

---

### AgentStudio.jsx

Two-panel layout:

- **Left panel**: List of all agents. Each card shows name, role, model, active tools, and status. Buttons: Edit, Delete, Chat.
- **Right panel (chat)**: When an agent is selected for chat, shows the conversation history and a message input. Calls `POST /api/agents/{id}/chat`. Displays token count per response.

---

### AgentModal.jsx

Five-tab form for creating or editing an agent:

| Tab | Fields |
|---|---|
| Basic | Name, Role, System Prompt, Model (Groq), Temperature, Max Tokens, Max Iterations |
| Tools | Checkbox list of available tools |
| Memory | Enable/disable, memory window size |
| Guardrails | Forbidden topics (comma-separated), max response length |
| Schedule | Cron expression, scheduled prompt |

Model options (Groq only): `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `mixtral-8x7b-32768`, `gemma2-9b-it`.

Default model: `llama-3.3-70b-versatile`.

---

### WorkflowBuilder.jsx

Three-panel layout:

**Left sidebar:**
- My Workflows list — click to load, trash icon to delete
- Templates list — click to load a copy

**Center canvas (ReactFlow):**
- Two custom node types: `AgentNode` (blue) and `ConditionNode` (yellow)
- Drag to reposition, draw edges between handles to connect
- Toolbar: Add Agent, Add Condition, Delete selected node, Save, Run

**Right panel (context-sensitive):**
- **Node Editor**: shown when a node is selected — edit label, assign agent, set task for agent nodes; set condition keyword for condition nodes
- **Run Panel**: shown when Run is clicked — input prompt textarea, Execute button, result display with status, token count, and output text

**State management:**
- `nodes` and `edges` managed by ReactFlow's `useNodesState`/`useEdgesState`
- `dirty` flag tracks unsaved changes
- `activeWf` holds the currently loaded workflow object

---

### Monitor.jsx

Three tabs connected to the backend:

**Live Events tab:**
- Opens a WebSocket connection via `createWS()` from `api.js`
- Receives and displays real-time events: `agent_start`, `agent_end`, `llm_response`, `node_start`, `node_complete`, `condition_eval`, `workflow_start`, `workflow_complete`, `workflow_error`
- Each event type has a distinct color; shows agent name, run ID, timestamp, and content preview

**Messages tab:**
- Fetches `GET /api/messages` (last 100)
- Shows full message history across all agents and channels

**Logs tab:**
- Fetches `GET /api/logs` (last 200)
- Shows structured log entries with level, event, agent name, and run ID

---

### Channels.jsx

Displays all Telegram channel configs with their running status.

- **Add Channel modal**: Name, Bot Token, Assign Agent → calls `POST /api/channels`
- Each channel card shows name, type, running/stopped status, assigned agent
- **Restart** button calls `POST /api/channels/{id}/restart`
- **Delete** calls `DELETE /api/channels/{id}` which stops the bot and removes the config

---

### api.js

Central API client. All fetch calls go through `req(path, opts)` which:
1. Attaches the `Authorization: Bearer <token>` header from `localStorage`
2. On `401` with a valid token → fires `yuno:logout` event and throws "Session expired"
3. On `401` without a token → falls through to the error handler to show the actual message
4. On other non-OK responses → parses `detail` from the JSON error body

`createWS(onMessage)` creates a WebSocket to `/ws?token=<token>` and calls `onMessage` on each parsed JSON event.

`BASE` is set from `import.meta.env.VITE_API_URL` (baked in at build time for production) or `''` (uses Vite dev proxy in local dev).

---

## Data Models

### Agent

```
id              UUID (PK)
user_id         FK → users.id
name            string
role            string
system_prompt   text
model           string  (default: llama-3.3-70b-versatile)
temperature     float   (0.0–2.0, capped at 1.0 for Groq)
max_tokens      int     (default: 2048, capped at 8192 for Groq)
tools           JSON string  → list of tool names
channels        JSON string  → list of channel config dicts
memory_enabled  bool
memory_window   int     (number of past messages to include)
guardrails      JSON string  → {forbidden_topics: [], max_response_length: null}
schedule        string  (cron expression, nullable)
schedule_prompt string  (nullable)
max_iterations  int     (ReAct loop cap, default: 10)
is_active       bool
created_at      datetime
updated_at      datetime
```

### Workflow

```
id            UUID (PK)
user_id       FK → users.id (null for templates)
name          string
description   string
graph_json    JSON string → {nodes: [...], edges: [...]}
is_template   bool
template_name string (unique identifier for seeded templates)
is_active     bool
created_at    datetime
updated_at    datetime
```

### WorkflowRun

```
id           UUID (PK)
workflow_id  FK → workflow.id
user_id      FK → users.id
status       string  (pending | running | completed | failed)
input_data   JSON string → {input: "..."}
output_data  JSON string → {output: "...", node_outputs: {...}}
error        string (nullable)
total_tokens int
total_cost   float
started_at   datetime
completed_at datetime
created_at   datetime
```

---

## API Reference

All endpoints except `/`, `/api/auth/*`, `/api/provider`, and `/api/tools` require `Authorization: Bearer <token>`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET/HEAD | `/` | No | Health check |
| POST | `/api/auth/register` | No | Create account |
| POST | `/api/auth/login` | No | Login, get token |
| GET | `/api/auth/me` | Yes | Current user |
| GET | `/api/agents` | Yes | List user's agents |
| POST | `/api/agents` | Yes | Create agent |
| GET | `/api/agents/{id}` | Yes | Get agent |
| PATCH | `/api/agents/{id}` | Yes | Update agent |
| DELETE | `/api/agents/{id}` | Yes | Delete agent |
| POST | `/api/agents/{id}/chat` | Yes | Chat with agent |
| GET | `/api/agents/{id}/memory` | Yes | View memory |
| DELETE | `/api/agents/{id}/memory` | Yes | Clear memory |
| GET | `/api/tools` | No | List available tools |
| GET | `/api/workflows` | Yes | List user's workflows |
| GET | `/api/workflows/templates` | Yes | List templates |
| POST | `/api/workflows` | Yes | Create workflow |
| PATCH | `/api/workflows/{id}` | Yes | Update workflow |
| DELETE | `/api/workflows/{id}` | Yes | Delete workflow |
| POST | `/api/workflows/{id}/run` | Yes | Execute workflow |
| GET | `/api/workflows/{id}/runs` | Yes | Execution history |
| GET | `/api/messages` | Yes | Message history |
| GET | `/api/logs` | Yes | Execution logs |
| GET | `/api/channels` | Yes | List channels |
| POST | `/api/channels` | Yes | Create channel + start bot |
| DELETE | `/api/channels/{id}` | Yes | Stop bot + delete |
| POST | `/api/channels/{id}/restart` | Yes | Restart bot |
| GET | `/api/provider` | No | LLM provider info |
| GET | `/api/stats` | Yes | Platform stats |
| WS | `/ws?token=` | Optional | Real-time event stream |

---

## WebSocket Events

All events are JSON objects. The Monitor page receives and displays these in real time.

| Event type | When fired | Key fields |
|---|---|---|
| `agent_start` | Agent begins execution | `agent_id`, `agent_name`, `run_id`, `input` |
| `llm_response` | After each LLM call in the ReAct loop | `agent_id`, `content`, `tokens`, `cost` |
| `agent_end` | Agent finishes | `agent_id`, `output`, `total_tokens`, `total_cost` |
| `workflow_start` | Workflow execution begins | `run_id`, `workflow_id`, `input` |
| `node_start` | A workflow node begins | `node_id`, `run_id`, `agent_id`, `task` |
| `node_complete` | A workflow node finishes | `node_id`, `output`, `tokens`, `cost` |
| `condition_eval` | A condition node is evaluated | `node_id`, `condition`, `result` (bool) |
| `workflow_complete` | Workflow finishes successfully | `run_id`, `output`, `total_tokens`, `total_cost` |
| `workflow_error` | Workflow fails | `run_id`, `error` |

---

## Data Flow — Agent Chat

```
User types message in AgentStudio
        ↓
POST /api/agents/{id}/chat  {message, session_id}
        ↓
get_current_user() validates JWT → fetches User
        ↓
_get_user_agent() checks agent.user_id == current_user.id
        ↓
AgentRunner(agent_cfg, memory_store, broadcast_event)
        ↓
memory_store.load(agent_id, session_id, window)
  → SELECT last N rows FROM agentmemory WHERE agent_id=? AND session_id=?
        ↓
graph.invoke(state)  [in thread pool]
  ├─ agent_node: [system_prompt] + history + [user_msg] → Groq API
  │     → broadcast llm_response event via WebSocket
  ├─ (tool calls?) → tools_node executes tools → back to agent_node
  └─ final AIMessage
        ↓
memory_store.save(human_msg, ai_msg)
  → INSERT INTO agentmemory
        ↓
INSERT INTO message (role=user) + INSERT INTO message (role=assistant)
        ↓
Return {content, total_tokens, total_cost, iterations}
        ↓
Frontend displays response + token count
```

---

## Data Flow — Workflow Run

```
User clicks Execute in WorkflowBuilder
        ↓
POST /api/workflows/{id}/run  {input}
        ↓
WorkflowRunner.run_workflow(workflow_id, input, user_id)
        ↓
Load workflow.graph_json → parse nodes + edges
        ↓
INSERT WorkflowRun (status=running)
        ↓
broadcast workflow_start event
        ↓
topological_sort(nodes, edges)
  → Kahn's algorithm → ordered list of node IDs
        ↓
For each node_id in order:
  ├─ Condition node:
  │    check if condition keyword in upstream output
  │    broadcast condition_eval event
  │    store "true"/"false" in node_outputs
  │
  └─ Agent node:
       collect outputs of all upstream nodes → extra_context
       broadcast node_start event
       INSERT Message (role=user)
       AgentRunner.run(task, session_id=run_id, extra_context)
         → full LangGraph execution (see Agent Chat flow)
       INSERT Message (role=assistant)
       INSERT LogEntry
       broadcast node_complete event
       store output in node_outputs[node_id]
        ↓
UPDATE WorkflowRun (status=completed, output_data, total_tokens, total_cost)
        ↓
broadcast workflow_complete event
        ↓
Return WorkflowRun object → API returns {run_id, status, output, tokens, cost}
        ↓
Frontend displays result in Run Panel
```
