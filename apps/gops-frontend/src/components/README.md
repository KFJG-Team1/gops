# Component Notes

This folder contains reusable UI components and active workspace panels.

## Chart Command Migration

`ChartPanel.tsx` renders a `ChartDocument` from the frontend chart runtime.
Chart commands are targeted by `chartDocumentId`; the chart toolbar robot button
selects the single chart used by `src/agent/chartAgent.ts`, which still calls
the legacy `/api/llm/chat` route.

The chart-command runtime is moving toward:

```text
systems/agent-orchestration/shared/gops_agents/chart_command/
```

Keep component code focused on document rendering, transient pointer state,
external drawing dock controls, and applying validated chart commands. Do not
add model prompts or backend routing policy in components.

When `ChartCommandAgent` is integrated into the main agent flow, remove any
component-level legacy routing branches that bypass `/api/agents/analyze`; keep
the chart robot target only if the orchestrated agent still needs an explicit
chart target. Delete this migration note if it no longer describes live code.
