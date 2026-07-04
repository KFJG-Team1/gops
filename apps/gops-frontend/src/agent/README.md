# Frontend Agent Notes

This folder contains browser-side agent clients.

## Chart Command Migration

`chartAgent.ts` currently calls the legacy chart-command route:

```text
POST /api/llm/chat
```

That route is a temporary compatibility path while `ChartCommandAgent` is split
out under:

```text
systems/agent-orchestration/shared/gops_agents/chart_command/
```

The central user-facing agent input should converge on the main agent entry
point:

```text
POST /api/agents/analyze
```

During development, a chart-command dev toggle may keep using the legacy route
to test chart action quality. Do not treat that toggle or this route as
permanent architecture.

When `ChartCommandAgent` is integrated into `AgentOrchestrator`, remove the
legacy `/api/llm/chat` client path, remove temporary routing branches, and
delete this migration note if this folder no longer depends on chart-command
compatibility.
