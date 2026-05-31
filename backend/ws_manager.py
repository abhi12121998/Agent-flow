"""
WebSocket connection manager for real-time event broadcasting.
All agent events, workflow events, and logs are pushed to connected UI clients.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Set
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.active: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.add(ws)
        logger.info(f"WS connected. Total: {len(self.active)}")

    def disconnect(self, ws: WebSocket):
        self.active.discard(ws)
        logger.info(f"WS disconnected. Total: {len(self.active)}")

    async def broadcast(self, data: dict):
        if not self.active:
            return
        message = json.dumps(data)
        dead = set()
        for ws in list(self.active):
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.active.discard(ws)


# Singleton
ws_manager = ConnectionManager()


async def broadcast_event(event: dict):
    """Broadcast an agent/workflow event to all connected UI clients."""
    await ws_manager.broadcast(event)
