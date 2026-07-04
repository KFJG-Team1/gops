# Component Notes

This folder contains reusable UI components and active workspace panels.

## Chart Command Migration

`ChartPanel.tsx` currently reaches chart-command behavior through
`src/agent/chartAgent.ts`, which calls the legacy `/api/llm/chat` route.

The chart-command runtime is moving toward:

```text
systems/agent-orchestration/shared/gops_agents/chart_command/
```

Keep component code focused on chart state, rendering, previews, and applying
validated chart actions. Do not add model prompts or backend routing policy in
components.

When `ChartCommandAgent` is integrated into the main agent flow, remove any
component-level dev toggle branches that bypass `/api/agents/analyze` and delete
this migration note if it no longer describes live code.
