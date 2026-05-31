"""
Workflow execution engine.

A workflow is a DAG of nodes, each node being an agent invocation.
Nodes define: agent_id, input_template, depends_on (list of node ids).
The runner topologically sorts and executes nodes, passing outputs downstream.
"""
from __future__ import annotations

import json
import asyncio
import logging
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from sqlmodel import Session, select

from db.database import engine
from db.models import Workflow, WorkflowRun, Message, LogEntry
from agents.manager import AgentManager
from agents.runtime import AgentRunner
from memory.store import MemoryStore

logger = logging.getLogger(__name__)


def topological_sort(nodes: List[Dict], edges: List[Dict]) -> List[str]:
    """Return node ids in execution order."""
    graph: Dict[str, List[str]] = {n["id"]: [] for n in nodes}
    in_degree: Dict[str, int] = {n["id"]: 0 for n in nodes}

    for edge in edges:
        src, tgt = edge["source"], edge["target"]
        graph[src].append(tgt)
        in_degree[tgt] += 1

    queue = [nid for nid, deg in in_degree.items() if deg == 0]
    order = []
    while queue:
        nid = queue.pop(0)
        order.append(nid)
        for neighbor in graph[nid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    return order


class WorkflowRunner:
    def __init__(self, event_callback: Optional[Callable] = None):
        self.memory_store = MemoryStore()
        self.event_callback = event_callback

    async def _emit(self, event: Dict):
        if self.event_callback:
            try:
                if asyncio.iscoroutinefunction(self.event_callback):
                    await self.event_callback(event)
                else:
                    self.event_callback(event)
            except Exception as e:
                logger.warning(f"Event callback error: {e}")

    def _persist_message(self, run_id: str, agent_id: str, agent_name: str,
                          role: str, content: str, metadata: dict = None):
        with Session(engine) as session:
            msg = Message(
                run_id=run_id,
                agent_id=agent_id,
                agent_name=agent_name,
                channel="internal",
                role=role,
                content=content,
                meta=json.dumps(metadata or {}),
            )
            session.add(msg)
            session.commit()

    def _log(self, run_id: str, agent_id: str, agent_name: str,
              event: str, details: dict = None, level: str = "info"):
        with Session(engine) as session:
            entry = LogEntry(
                run_id=run_id,
                agent_id=agent_id,
                agent_name=agent_name,
                level=level,
                event=event,
                details=json.dumps(details or {}),
            )
            session.add(entry)
            session.commit()

    async def run_workflow(self, workflow_id: str, user_input: str, user_id: Optional[str] = None) -> WorkflowRun:
        # Load workflow
        with Session(engine) as session:
            workflow = session.get(Workflow, workflow_id)
            if not workflow:
                raise ValueError(f"Workflow {workflow_id} not found")
            graph_def = workflow.get_graph()

        nodes: List[Dict] = graph_def.get("nodes", [])
        edges: List[Dict] = graph_def.get("edges", [])

        # Create run record
        with Session(engine) as session:
            run = WorkflowRun(
                workflow_id=workflow_id,
                status="running",
                input_data=json.dumps({"input": user_input}),
                started_at=datetime.utcnow(),
                user_id=user_id,
            )
            session.add(run)
            session.commit()
            session.refresh(run)
            run_id = run.id

        await self._emit({
            "type": "workflow_start",
            "run_id": run_id,
            "workflow_id": workflow_id,
            "input": user_input,
            "timestamp": datetime.utcnow().isoformat(),
        })

        node_outputs: Dict[str, str] = {}
        total_tokens = 0
        total_cost = 0.0

        try:
            order = topological_sort(nodes, edges)

            for node_id in order:
                node = next((n for n in nodes if n["id"] == node_id), None)
                if not node:
                    continue

                node_type = node.get("type", "agent")

                # ── Condition node ────────────────────────────────────────
                if node_type == "condition":
                    cond = node.get("data", {}).get("condition", "")
                    upstream_id = node.get("data", {}).get("upstream_node", "")
                    upstream_out = node_outputs.get(upstream_id, "")
                    # Simple keyword condition evaluation
                    passed = cond.lower() in upstream_out.lower() if cond else True

                    await self._emit({
                        "type": "condition_eval",
                        "node_id": node_id,
                        "run_id": run_id,
                        "condition": cond,
                        "result": passed,
                        "timestamp": datetime.utcnow().isoformat(),
                    })

                    node_outputs[node_id] = "true" if passed else "false"
                    continue

                # ── Agent node ────────────────────────────────────────────
                agent_id = node.get("data", {}).get("agent_id")
                if not agent_id:
                    continue

                agent_cfg = AgentManager.get(agent_id)
                if not agent_cfg:
                    logger.warning(f"Agent {agent_id} not found, skipping node {node_id}")
                    continue

                # Build context from upstream node outputs
                upstream_outputs = []
                for edge in edges:
                    if edge["target"] == node_id and edge["source"] in node_outputs:
                        upstream_outputs.append(node_outputs[edge["source"]])

                extra_context = "\n\n".join(upstream_outputs) if upstream_outputs else None

                # Determine task for this node
                task = node.get("data", {}).get("task", user_input)
                if task == "__user_input__":
                    task = user_input

                await self._emit({
                    "type": "node_start",
                    "node_id": node_id,
                    "run_id": run_id,
                    "agent_id": agent_id,
                    "agent_name": agent_cfg.name,
                    "task": task,
                    "timestamp": datetime.utcnow().isoformat(),
                })

                self._persist_message(run_id, agent_id, agent_cfg.name, "user", task)
                self._log(run_id, agent_id, agent_cfg.name,
                          "node_executing", {"node_id": node_id, "task": task[:200]})

                runner = AgentRunner(agent_cfg, self.memory_store, self.event_callback)
                result = await runner.run(
                    user_input=task,
                    session_id=run_id,
                    run_id=run_id,
                    extra_context=extra_context,
                )

                output = result["content"]
                node_outputs[node_id] = output
                total_tokens += result["total_tokens"]
                total_cost += result["total_cost"]

                self._persist_message(
                    run_id, agent_id, agent_cfg.name, "assistant", output,
                    {"tokens": result["total_tokens"], "cost": result["total_cost"]}
                )
                self._log(run_id, agent_id, agent_cfg.name, "node_completed",
                          {"output_preview": output[:200]})

                await self._emit({
                    "type": "node_complete",
                    "node_id": node_id,
                    "run_id": run_id,
                    "agent_id": agent_id,
                    "agent_name": agent_cfg.name,
                    "output": output,
                    "tokens": result["total_tokens"],
                    "cost": result["total_cost"],
                    "timestamp": datetime.utcnow().isoformat(),
                })

            # Collect final output (last node in order)
            final_output = node_outputs.get(order[-1], "") if order else ""

            with Session(engine) as session:
                run = session.get(WorkflowRun, run_id)
                run.status = "completed"
                run.output_data = json.dumps({"output": final_output, "node_outputs": node_outputs})
                run.completed_at = datetime.utcnow()
                run.total_tokens = total_tokens
                run.total_cost = total_cost
                session.add(run)
                session.commit()
                session.refresh(run)

            await self._emit({
                "type": "workflow_complete",
                "run_id": run_id,
                "output": final_output,
                "total_tokens": total_tokens,
                "total_cost": total_cost,
                "timestamp": datetime.utcnow().isoformat(),
            })

            return run

        except Exception as e:
            logger.exception(f"Workflow run {run_id} failed: {e}")
            with Session(engine) as session:
                run = session.get(WorkflowRun, run_id)
                run.status = "failed"
                run.error = str(e)
                run.completed_at = datetime.utcnow()
                session.add(run)
                session.commit()
                session.refresh(run)

            await self._emit({
                "type": "workflow_error",
                "run_id": run_id,
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat(),
            })
            return run
