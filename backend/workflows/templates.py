"""
Pre-built workflow templates.
Each template defines nodes + edges and placeholder agent roles.
Templates are stored to DB on first startup.
"""
from typing import Dict, Any, List


TEMPLATES: List[Dict[str, Any]] = [
    {
        "name": "Research & Summarize",
        "description": (
            "A two-agent pipeline: Agent 1 (Researcher) searches the web for "
            "information on a topic, Agent 2 (Summarizer) condenses the findings "
            "into a crisp executive summary."
        ),
        "template_name": "research_summarize",
        "graph": {
            "nodes": [
                {
                    "id": "node_researcher",
                    "type": "agent",
                    "position": {"x": 100, "y": 200},
                    "data": {
                        "label": "Researcher",
                        "role": "Researcher",
                        "task": "__user_input__",
                        "agent_id": None,
                        "placeholder_role": "researcher",
                        "description": "Search the web and gather raw information on the topic.",
                        "suggested_tools": ["web_search"],
                        "suggested_system_prompt": (
                            "You are a research analyst. When given a topic, use web_search "
                            "to gather relevant, current information. Return thorough raw notes "
                            "with sources."
                        ),
                    },
                },
                {
                    "id": "node_summarizer",
                    "type": "agent",
                    "position": {"x": 500, "y": 200},
                    "data": {
                        "label": "Summarizer",
                        "role": "Summarizer",
                        "task": "Summarize the research findings into a concise executive summary with key takeaways.",
                        "agent_id": None,
                        "placeholder_role": "summarizer",
                        "description": "Distill the researcher's output into a polished summary.",
                        "suggested_tools": [],
                        "suggested_system_prompt": (
                            "You are a professional writer. You receive raw research notes and "
                            "produce a clear, structured executive summary with bullet-point "
                            "key takeaways. Be concise and professional."
                        ),
                    },
                },
            ],
            "edges": [
                {"id": "e1", "source": "node_researcher", "target": "node_summarizer"},
            ],
        },
    },
    {
        "name": "Content Review Pipeline",
        "description": (
            "A three-agent pipeline: Agent 1 (Writer) drafts content, "
            "Agent 2 (Critic) reviews and flags issues, "
            "Agent 3 (Editor) produces a final polished version."
        ),
        "template_name": "content_review",
        "graph": {
            "nodes": [
                {
                    "id": "node_writer",
                    "type": "agent",
                    "position": {"x": 80, "y": 200},
                    "data": {
                        "label": "Writer",
                        "role": "Writer",
                        "task": "__user_input__",
                        "agent_id": None,
                        "placeholder_role": "writer",
                        "description": "Draft the initial content based on the brief.",
                        "suggested_tools": [],
                        "suggested_system_prompt": (
                            "You are a skilled content writer. Write a well-structured first "
                            "draft based on the given brief. Aim for clarity and engagement."
                        ),
                    },
                },
                {
                    "id": "node_critic",
                    "type": "agent",
                    "position": {"x": 400, "y": 200},
                    "data": {
                        "label": "Critic",
                        "role": "Critic",
                        "task": "Review the draft content. Identify weak points, factual gaps, tone issues, and suggest specific improvements.",
                        "agent_id": None,
                        "placeholder_role": "critic",
                        "description": "Critically review the draft and provide feedback.",
                        "suggested_tools": [],
                        "suggested_system_prompt": (
                            "You are a sharp editorial critic. Review drafts for clarity, "
                            "accuracy, tone, and structure. Provide numbered, specific feedback "
                            "without rewriting the content."
                        ),
                    },
                },
                {
                    "id": "node_editor",
                    "type": "agent",
                    "position": {"x": 720, "y": 200},
                    "data": {
                        "label": "Editor",
                        "role": "Editor",
                        "task": "Using the original draft and the critic's feedback, produce a final, polished version of the content.",
                        "agent_id": None,
                        "placeholder_role": "editor",
                        "description": "Integrate feedback and produce the final version.",
                        "suggested_tools": [],
                        "suggested_system_prompt": (
                            "You are a senior editor. You receive a draft and critic feedback. "
                            "Produce a final, publication-ready version that addresses all "
                            "feedback while preserving the author's voice."
                        ),
                    },
                },
            ],
            "edges": [
                {"id": "e1", "source": "node_writer", "target": "node_critic"},
                {"id": "e2", "source": "node_critic", "target": "node_editor"},
            ],
        },
    },
    {
        "name": "Market Intelligence Report",
        "description": (
            "Two agents collaborate: Agent 1 (Analyst) researches a company/market, "
            "Agent 2 (Reporter) structures the findings into a formatted intelligence report."
        ),
        "template_name": "market_intelligence",
        "graph": {
            "nodes": [
                {
                    "id": "node_analyst",
                    "type": "agent",
                    "position": {"x": 100, "y": 200},
                    "data": {
                        "label": "Market Analyst",
                        "role": "Analyst",
                        "task": "__user_input__",
                        "agent_id": None,
                        "placeholder_role": "analyst",
                        "description": "Research the company or market using web search.",
                        "suggested_tools": ["web_search", "calculator"],
                        "suggested_system_prompt": (
                            "You are a market research analyst. Given a company or market topic, "
                            "use web_search to find recent news, financials, competitive landscape, "
                            "and key trends. Return comprehensive raw data."
                        ),
                    },
                },
                {
                    "id": "node_reporter",
                    "type": "agent",
                    "position": {"x": 500, "y": 200},
                    "data": {
                        "label": "Intelligence Reporter",
                        "role": "Reporter",
                        "task": "Format the research data into a structured market intelligence report with sections: Executive Summary, Key Players, Recent Developments, Risks & Opportunities.",
                        "agent_id": None,
                        "placeholder_role": "reporter",
                        "description": "Structure findings into a professional report.",
                        "suggested_tools": [],
                        "suggested_system_prompt": (
                            "You are a business intelligence reporter. Transform raw market data "
                            "into a well-structured report. Use clear headings, bullet points, "
                            "and highlight the most actionable insights."
                        ),
                    },
                },
            ],
            "edges": [
                {"id": "e1", "source": "node_analyst", "target": "node_reporter"},
            ],
        },
    },
]


def get_all_templates():
    return TEMPLATES
