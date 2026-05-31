"""
Scheduler for cron-based agent runs.
When an agent has a schedule (cron expression) and schedule_prompt,
this module registers a job that fires the agent at the given cadence.
"""
from __future__ import annotations

import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from agents.manager import AgentManager
from agents.runtime import AgentRunner
from memory.store import MemoryStore
from ws_manager import broadcast_event

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()
_memory_store = MemoryStore()


async def _run_scheduled_agent(agent_id: str):
    agent_cfg = AgentManager.get(agent_id)
    if not agent_cfg or not agent_cfg.is_active:
        return
    prompt = agent_cfg.schedule_prompt or "Run your scheduled task."
    logger.info(f"Scheduled run: agent={agent_cfg.name}")
    try:
        runner = AgentRunner(agent_cfg, _memory_store, broadcast_event)
        result = await runner.run(
            user_input=prompt,
            session_id="scheduled",
        )
        logger.info(f"Scheduled run complete: {agent_cfg.name} | tokens={result['total_tokens']}")
    except Exception as e:
        logger.error(f"Scheduled run failed for {agent_id}: {e}")


def register_agent_schedule(agent_id: str, cron: str):
    job_id = f"agent_{agent_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    try:
        trigger = CronTrigger.from_crontab(cron)
        scheduler.add_job(
            _run_scheduled_agent,
            trigger=trigger,
            args=[agent_id],
            id=job_id,
            replace_existing=True,
        )
        logger.info(f"Registered schedule for agent {agent_id}: {cron}")
    except Exception as e:
        logger.error(f"Invalid cron for agent {agent_id}: {e}")


def unregister_agent_schedule(agent_id: str):
    job_id = f"agent_{agent_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)


def reload_all_schedules():
    """Called on startup to restore schedules from DB."""
    agents = AgentManager.list_all()
    for agent in agents:
        if agent.schedule and agent.is_active:
            register_agent_schedule(agent.id, agent.schedule)
