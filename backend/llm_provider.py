"""
LLM Provider — Groq only (LLaMA 3.3 70B default)
"""
from __future__ import annotations
import os
import logging

logger = logging.getLogger(__name__)

GROQ_MODELS = {
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192",
    "llama3-8b-8192",
    "mixtral-8x7b-32768",
    "gemma2-9b-it",
}

DEFAULT_MODEL = "llama-3.3-70b-versatile"


def resolve_llm(model: str, temperature: float = 0.7, max_tokens: int = 2048):
    from langchain_groq import ChatGroq

    groq_model = model if model in GROQ_MODELS else DEFAULT_MODEL
    groq_api_key = os.getenv("GROQ_API_KEY")
    logger.info(f"LLM: Groq | model: {groq_model}")

    return ChatGroq(
        model=groq_model,
        temperature=min(temperature, 1.0),
        max_tokens=min(max_tokens, 8192),
        api_key=groq_api_key or None,
        model_kwargs={"tool_choice": "auto"},
    )


def get_provider_info() -> dict:
    return {
        "active_provider": "groq",
        "groq_available": True,
        "note": "Using Groq (LLaMA 3.3 70B)",
    }
