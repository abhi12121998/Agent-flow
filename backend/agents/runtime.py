"""
LangGraph-based agent runtime.

Each agent runs as a ReAct-style LangGraph graph:
  __start__ → agent_node ⟷ tools_node → __end__

Multi-agent workflows are orchestrated by wiring agent outputs as
inputs to downstream agents via the WorkflowRunner.
"""
from __future__ import annotations

import json
import re
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, TypedDict, Annotated

from langchain_core.messages import (
    BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage
)
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from agents.tools import resolve_tools
from llm_provider import resolve_llm
from db.models import Agent, AgentMemory, LogEntry, Message
from memory.store import MemoryStore

logger = logging.getLogger(__name__)


# ── LLaMA malformed tool-call parsers ────────────────────────────────────────
# Pattern 1: <|python_tag|>func_name("arg")  or  <|python_tag|>func_name(key="val")
_PYTHON_TAG_RE = re.compile(r"<\|python_tag\|>(\w+)\((.*)\)\s*$", re.DOTALL)
# Pattern 2: <function=func_name>{"key": "val"}</function>  (sometimes missing closing tag)
_FUNC_TAG_RE = re.compile(r"<function=(\w+)>?(\{.*?\})(?:</function>)?\s*$", re.DOTALL)

def _try_parse_malformed_tool_call(content: str) -> Optional[dict]:
    """
    Parse LLaMA 3 malformed tool-call formats into a tool_calls-compatible dict.
    Handles both <|python_tag|> and <function=name> variants.
    """
    s = content.strip()

    # Pattern 1: <|python_tag|>func("arg")
    m = _PYTHON_TAG_RE.match(s)
    if m:
        func_name, args_str = m.group(1), m.group(2).strip()
        try:
            args = json.loads(args_str) if args_str.startswith("{") else {"query": args_str.strip("\"'")}
        except Exception:
            args = {"query": args_str}
        return {"name": func_name, "args": args, "id": f"call_{func_name}_0", "type": "tool_call"}

    # Pattern 2: <function=func_name>{"key": "val"}
    m = _FUNC_TAG_RE.search(s)
    if m:
        func_name, args_str = m.group(1), m.group(2).strip()
        try:
            args = json.loads(args_str)
        except Exception:
            args = {"query": args_str}
        return {"name": func_name, "args": args, "id": f"call_{func_name}_0", "type": "tool_call"}

    return None


# ── Agent State ───────────────────────────────────────────────────────────────
class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], add_messages]
    agent_id: str
    agent_name: str
    run_id: Optional[str]
    iteration: int
    total_tokens: int
    total_cost: float


# ── Token cost helper ─────────────────────────────────────────────────────────
GPT4O_INPUT_COST  = 0.0000025   # per token
GPT4O_OUTPUT_COST = 0.0000100

def calc_cost(usage) -> tuple[int, float]:
    if not usage:
        return 0, 0.0
    tokens = usage.get("total_tokens", 0)
    cost = (
        usage.get("prompt_tokens", 0) * GPT4O_INPUT_COST +
        usage.get("completion_tokens", 0) * GPT4O_OUTPUT_COST
    )
    return tokens, cost


# ── Build LangGraph for one agent ────────────────────────────────────────────
def build_agent_graph(agent_cfg: Agent, event_callback=None, loop_holder: Optional[list] = None):
    """
    Build a compiled LangGraph ReAct graph for a single agent.
    event_callback(event: dict) is called on each node execution.
    loop_holder is a 1-element list whose value is set to the running event loop
    before graph.invoke() so callbacks can use run_coroutine_threadsafe from threads.
    """
    tools = resolve_tools(agent_cfg.get_tools())
    llm = resolve_llm(
        model=agent_cfg.model,
        temperature=agent_cfg.temperature,
        max_tokens=agent_cfg.max_tokens,
    )
    if tools:
        llm_with_tools = llm.bind_tools(tools)
    else:
        llm_with_tools = llm

    guardrails = agent_cfg.get_guardrails()
    max_iter = agent_cfg.max_iterations

    def agent_node(state: AgentState) -> AgentState:
        if state["iteration"] >= max_iter:
            return {
                **state,
                "messages": state["messages"] + [
                    AIMessage(content="[Max iterations reached. Stopping.]")
                ]
            }

        # Inject system prompt at the start
        msgs = state["messages"]
        if not any(isinstance(m, SystemMessage) for m in msgs):
            sys_msg = SystemMessage(content=agent_cfg.system_prompt)
            msgs = [sys_msg] + list(msgs)

        try:
            response = llm_with_tools.invoke(msgs)
        except Exception as e:
            # Groq/LLaMA sometimes generates malformed tool calls (tool_use_failed).
            # Try to parse the failed_generation before giving up.
            err_str = str(e)
            if "tool_use_failed" in err_str or "Failed to call a function" in err_str:
                failed_gen = ""
                try:
                    import ast
                    err_detail = ast.literal_eval(err_str.split(" - ", 1)[1]) if " - " in err_str else {}
                    failed_gen = err_detail.get("error", {}).get("failed_generation", "")
                except Exception:
                    pass
                if failed_gen:
                    parsed = _try_parse_malformed_tool_call(failed_gen)
                    if parsed:
                        logger.info(f"Recovered tool call from failed_generation: {parsed['name']}")
                        response = AIMessage(content="", tool_calls=[parsed])
                    else:
                        logger.warning(f"Tool call malformed, retrying without tools: {e}")
                        response = llm.invoke(msgs)
                else:
                    logger.warning(f"Tool call malformed, retrying without tools: {e}")
                    response = llm.invoke(msgs)
            else:
                raise

        # LLaMA 3 on Groq sometimes uses <|python_tag|> or <function=...> in content
        if not getattr(response, "tool_calls", None) and isinstance(getattr(response, "content", None), str):
            parsed = _try_parse_malformed_tool_call(response.content)
            if parsed:
                logger.info(f"Converting malformed content to tool_call: {parsed['name']}")
                response = AIMessage(content="", tool_calls=[parsed])

        usage = getattr(response, "usage_metadata", None) or {}
        tokens, cost = calc_cost(dict(usage) if usage else {})

        if event_callback and loop_holder and loop_holder[0]:
            asyncio.run_coroutine_threadsafe(
                _safe_callback(event_callback, {
                    "type": "llm_response",
                    "agent_id": state["agent_id"],
                    "agent_name": state["agent_name"],
                    "run_id": state["run_id"],
                    "content": response.content,
                    "tokens": tokens,
                    "cost": cost,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }),
                loop_holder[0],
            )

        return {
            **state,
            "messages": list(msgs) + [response],
            "iteration": state["iteration"] + 1,
            "total_tokens": state["total_tokens"] + tokens,
            "total_cost": state["total_cost"] + cost,
        }

    def should_continue(state: AgentState) -> str:
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return END

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent_node)

    if tools:
        tool_node = ToolNode(tools)
        graph.add_node("tools", tool_node)
        graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
        graph.add_edge("tools", "agent")
    else:
        graph.add_edge("agent", END)

    graph.set_entry_point("agent")
    return graph.compile()


async def _safe_callback(cb, event):
    try:
        if asyncio.iscoroutinefunction(cb):
            await cb(event)
        else:
            cb(event)
    except Exception as e:
        logger.warning(f"Event callback error: {e}")


# ── Single agent run ──────────────────────────────────────────────────────────
class AgentRunner:
    def __init__(self, agent_cfg: Agent, memory_store: MemoryStore, event_callback=None):
        self.agent_cfg = agent_cfg
        self.memory_store = memory_store
        self.event_callback = event_callback
        self._loop_holder: list = [None]
        self.graph = build_agent_graph(agent_cfg, event_callback, self._loop_holder)

    async def run(
        self,
        user_input: str,
        session_id: str = "default",
        run_id: Optional[str] = None,
        extra_context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Run the agent with user_input. Returns final content + stats.
        """
        # Load memory
        history: List[BaseMessage] = []
        if self.agent_cfg.memory_enabled:
            history = await self.memory_store.load(
                self.agent_cfg.id, session_id, self.agent_cfg.memory_window
            )

        # Build initial messages
        content = user_input
        if extra_context:
            content = f"[Context from upstream agent]\n{extra_context}\n\n[Task]\n{user_input}"

        initial_messages = history + [HumanMessage(content=content)]

        state: AgentState = {
            "messages": initial_messages,
            "agent_id": self.agent_cfg.id,
            "agent_name": self.agent_cfg.name,
            "run_id": run_id,
            "iteration": 0,
            "total_tokens": 0,
            "total_cost": 0.0,
        }

        if self.event_callback:
            await _safe_callback(self.event_callback, {
                "type": "agent_start",
                "agent_id": self.agent_cfg.id,
                "agent_name": self.agent_cfg.name,
                "run_id": run_id,
                "input": user_input,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

        self._loop_holder[0] = asyncio.get_running_loop()
        final_state = await asyncio.get_event_loop().run_in_executor(
            None, lambda: self.graph.invoke(state)
        )

        # Extract final text response
        final_msg = final_state["messages"][-1]
        final_content = final_msg.content if hasattr(final_msg, "content") else str(final_msg)

        # Persist memory
        if self.agent_cfg.memory_enabled:
            await self.memory_store.save(
                self.agent_cfg.id, session_id,
                HumanMessage(content=user_input),
                AIMessage(content=final_content),
            )

        if self.event_callback:
            await _safe_callback(self.event_callback, {
                "type": "agent_end",
                "agent_id": self.agent_cfg.id,
                "agent_name": self.agent_cfg.name,
                "run_id": run_id,
                "output": final_content,
                "total_tokens": final_state["total_tokens"],
                "total_cost": final_state["total_cost"],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

        return {
            "content": final_content,
            "total_tokens": final_state["total_tokens"],
            "total_cost": final_state["total_cost"],
            "iterations": final_state["iteration"],
        }
