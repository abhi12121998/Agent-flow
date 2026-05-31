"""
LLM Provider Resolver
─────────────────────
Priority:
  1. OpenAI (GPT-4o family) — if OPENAI_API_KEY is set
  2. Groq   (LLaMA 3.3 70B, free tier) — if GROQ_API_KEY is set OR as open fallback

Model mapping when falling back to Groq:
  gpt-4o        → llama-3.3-70b-versatile
  gpt-4o-mini   → llama-3.1-8b-instant
  gpt-4-turbo   → llama-3.3-70b-versatile
  gpt-3.5-turbo → llama-3.1-8b-instant
  (any groq model name is passed through as-is)
"""
from __future__ import annotations
import os
import logging

logger = logging.getLogger(__name__)

# ── Model mapping: OpenAI → Groq equivalent ───────────────────────────────────
OPENAI_TO_GROQ: dict[str, str] = {
    "gpt-4o":           "llama-3.3-70b-versatile",
    "gpt-4o-mini":      "llama-3.1-8b-instant",
    "gpt-4-turbo":      "llama-3.3-70b-versatile",
    "gpt-3.5-turbo":    "llama-3.1-8b-instant",
}

# Groq models available on the free tier
GROQ_MODELS = {
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192",
    "llama3-8b-8192",
    "mixtral-8x7b-32768",
    "gemma2-9b-it",
}


def get_active_provider() -> str:
    """Return 'openai' or 'groq' based on available API keys."""
    if os.getenv("OPENAI_API_KEY"):
        return "openai"
    return "groq"


def resolve_llm(model: str, temperature: float = 0.7, max_tokens: int = 2048):
    """
    Return a LangChain chat model instance.
    Uses OpenAI if OPENAI_API_KEY is available, otherwise falls back to Groq.
    """
    provider = get_active_provider()

    if provider == "openai":
        from langchain_openai import ChatOpenAI
        logger.info(f"LLM provider: OpenAI | model: {model}")
        return ChatOpenAI(
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    # ── Groq fallback ─────────────────────────────────────────────────────────
    from langchain_groq import ChatGroq

    # Map OpenAI model names → Groq equivalents
    groq_model = OPENAI_TO_GROQ.get(model, model)

    # If the model string is not a known Groq model either, use the best free default
    if groq_model not in GROQ_MODELS:
        groq_model = "llama-3.3-70b-versatile"

    groq_api_key = os.getenv("GROQ_API_KEY")
    logger.info(f"LLM provider: Groq (free fallback) | model: {groq_model} | key={'set' if groq_api_key else 'none (using free tier)'}")

    return ChatGroq(
        model=groq_model,
        temperature=min(temperature, 1.0),   # Groq caps at 1.0
        max_tokens=min(max_tokens, 8192),     # Groq free tier limit
        api_key=groq_api_key or None,
        model_kwargs={"tool_choice": "auto"}, # nudge model to use correct tool-call format
    )


def get_provider_info() -> dict:
    """Return current provider info for the UI / API."""
    provider = get_active_provider()
    has_openai = bool(os.getenv("OPENAI_API_KEY"))
    has_groq   = bool(os.getenv("GROQ_API_KEY"))
    return {
        "active_provider": provider,
        "openai_available": has_openai,
        "groq_available": has_groq or True,   # Groq has a free tier
        "note": (
            "Using OpenAI (GPT-4o)" if has_openai
            else "Using Groq free tier (LLaMA 3.3 70B) — set OPENAI_API_KEY to switch to GPT-4o"
        ),
        "model_mapping": OPENAI_TO_GROQ,
    }
