"""
Telegram channel integration.

When a ChannelConfig of type 'telegram' is active for an agent,
this module starts a polling bot. Messages from Telegram users
are routed to the agent's runtime. Replies are sent back via Telegram.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Dict, Optional

from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters,
)
from sqlmodel import Session

from db.database import engine
from db.models import Message, ChannelConfig
from agents.manager import AgentManager
from agents.runtime import AgentRunner
from memory.store import MemoryStore

logger = logging.getLogger(__name__)

# Active bot instances: channel_id -> Application
_active_bots: Dict[str, Application] = {}
_memory_store = MemoryStore()


async def _handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle incoming Telegram messages."""
    agent_id: str = context.bot_data.get("agent_id")
    channel_id: str = context.bot_data.get("channel_id")

    if not agent_id or not update.message or not update.message.text:
        return

    user_text = update.message.text
    chat_id = str(update.effective_chat.id)
    username = update.effective_user.username or str(update.effective_user.id)

    logger.info(f"Telegram [{channel_id}] user={username} msg={user_text[:80]}")

    # Persist incoming message
    with Session(engine) as session:
        session.add(Message(
            agent_id=agent_id,
            channel="telegram",
            role="user",
            content=user_text,
            meta=json.dumps({"chat_id": chat_id, "username": username}),
        ))
        session.commit()

    agent_cfg = AgentManager.get(agent_id)
    if not agent_cfg:
        await update.message.reply_text("Agent not found.")
        return

    # Show typing indicator
    await context.bot.send_chat_action(
        chat_id=update.effective_chat.id, action="typing"
    )

    try:
        runner = AgentRunner(agent_cfg, _memory_store)
        result = await runner.run(
            user_input=user_text,
            session_id=f"telegram_{chat_id}",
        )
        reply = result["content"]
    except Exception as e:
        reply = f"Sorry, I encountered an error: {e}"
        logger.exception(f"Agent run error in Telegram handler: {e}")

    # Persist reply
    with Session(engine) as session:
        session.add(Message(
            agent_id=agent_id,
            channel="telegram",
            role="assistant",
            content=reply,
            meta=json.dumps({
                "chat_id": chat_id,
                "tokens": result.get("total_tokens", 0),
                "cost": result.get("total_cost", 0.0),
            }),
        ))
        session.commit()

    # Telegram has 4096 char message limit
    if len(reply) > 4000:
        for i in range(0, len(reply), 4000):
            await update.message.reply_text(reply[i:i+4000])
    else:
        await update.message.reply_text(reply)


async def _handle_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    agent_id: str = context.bot_data.get("agent_id", "")
    agent_cfg = AgentManager.get(agent_id)
    name = agent_cfg.name if agent_cfg else "AI Agent"
    role = agent_cfg.role if agent_cfg else "Assistant"
    await update.message.reply_text(
        f"👋 Hi! I'm *{name}*, your {role}.\n\nSend me a message to get started!",
        parse_mode="Markdown",
    )


async def start_bot(channel_id: str, token: str, agent_id: str) -> bool:
    """Start a Telegram bot for a channel config. Returns True if successful."""
    if channel_id in _active_bots:
        logger.info(f"Bot for channel {channel_id} already running.")
        return True

    try:
        app = Application.builder().token(token).build()
        app.bot_data["agent_id"] = agent_id
        app.bot_data["channel_id"] = channel_id

        app.add_handler(CommandHandler("start", _handle_start))
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, _handle_message))

        await app.initialize()
        await app.start()
        await app.updater.start_polling(drop_pending_updates=True)

        _active_bots[channel_id] = app
        logger.info(f"Telegram bot started for channel {channel_id}, agent {agent_id}")
        return True

    except Exception as e:
        logger.error(f"Failed to start Telegram bot for channel {channel_id}: {e}")
        return False


async def stop_bot(channel_id: str) -> bool:
    """Stop a running Telegram bot."""
    if channel_id not in _active_bots:
        return False
    try:
        app = _active_bots.pop(channel_id)
        await app.updater.stop()
        await app.stop()
        await app.shutdown()
        logger.info(f"Telegram bot stopped for channel {channel_id}")
        return True
    except Exception as e:
        logger.error(f"Error stopping bot {channel_id}: {e}")
        return False


def get_active_bots() -> Dict[str, str]:
    """Return dict of channel_id -> agent_id for active bots."""
    return {cid: app.bot_data.get("agent_id") for cid, app in _active_bots.items()}


async def restart_all_bots():
    """Called on startup — restart all active Telegram channel configs."""
    with Session(engine) as session:
        from sqlmodel import select
        configs = session.exec(
            select(ChannelConfig)
            .where(ChannelConfig.channel_type == "telegram")
            .where(ChannelConfig.is_active == True)
        ).all()

    for cfg in configs:
        config_data = cfg.get_config()
        token = config_data.get("token")
        if token and cfg.agent_id:
            await start_bot(cfg.id, token, cfg.agent_id)
