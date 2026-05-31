"""
Built-in tools available to agents.
Each tool is a LangChain-compatible tool that can be selected per agent.
"""
from langchain.tools import tool
from langchain_community.utilities import GoogleSerperAPIWrapper
from langchain.tools import Tool
from typing import Optional
import httpx
import json
import math


# ── Web Search ──────────────────────────────────────────────────────────────
def get_search_tool():
    search = GoogleSerperAPIWrapper()
    return Tool(name="web_search", func=search.run, description="Search the web using Google Serper")


# ── Calculator ───────────────────────────────────────────────────────────────
@tool
def calculator(expression: str) -> str:
    """Evaluate a mathematical expression. Input must be a valid Python math expression."""
    try:
        allowed = {k: getattr(math, k) for k in dir(math) if not k.startswith("_")}
        allowed.update({"abs": abs, "round": round, "min": min, "max": max})
        result = eval(expression, {"__builtins__": {}}, allowed)
        return str(result)
    except Exception as e:
        return f"Error: {e}"


# ── HTTP Request ──────────────────────────────────────────────────────────────
@tool
def http_get(url: str) -> str:
    """Make an HTTP GET request and return the response text (max 2000 chars)."""
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.get(url, follow_redirects=True)
            return resp.text[:2000]
    except Exception as e:
        return f"Error: {e}"


# ── JSON Parser ───────────────────────────────────────────────────────────────
@tool
def json_parse(text: str) -> str:
    """Parse a JSON string and return a pretty-printed version."""
    try:
        parsed = json.loads(text)
        return json.dumps(parsed, indent=2)
    except Exception as e:
        return f"Error parsing JSON: {e}"


# ── Text Summarizer (pass-through — the LLM summarizes) ──────────────────────
@tool
def summarize_text(text: str) -> str:
    """Return the first 1000 characters of a long text for summarization."""
    if len(text) > 1000:
        return text[:1000] + f"\n\n[...truncated, original length: {len(text)} chars]"
    return text


# ── Current Time ──────────────────────────────────────────────────────────────
@tool
def get_current_time(timezone: Optional[str] = "UTC") -> str:
    """Get the current date and time."""
    from datetime import datetime, timezone as tz
    now = datetime.now(tz.utc)
    return now.strftime("%Y-%m-%d %H:%M:%S UTC")


# ── Registry ─────────────────────────────────────────────────────────────────
TOOL_REGISTRY = {
    "web_search": get_search_tool,
    "calculator": lambda: calculator,
    "http_get": lambda: http_get,
    "json_parse": lambda: json_parse,
    "summarize_text": lambda: summarize_text,
    "get_current_time": lambda: get_current_time,
}

TOOL_DESCRIPTIONS = {
    "web_search": "Search the web using Google (Serper)",
    "calculator": "Evaluate mathematical expressions",
    "http_get": "Make HTTP GET requests to external APIs",
    "json_parse": "Parse and format JSON data",
    "summarize_text": "Truncate and prepare long texts",
    "get_current_time": "Get the current UTC date and time",
}


def resolve_tools(tool_names: list[str]) -> list:
    """Resolve a list of tool names to LangChain tool instances."""
    resolved = []
    for name in tool_names:
        if name in TOOL_REGISTRY:
            resolved.append(TOOL_REGISTRY[name]())
    return resolved
