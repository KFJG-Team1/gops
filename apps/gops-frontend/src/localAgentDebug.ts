export const agentDebugStorageKey = "gops:agent-debug";

export function isLocalAgentDebugEnabled(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return false;
  }
  const paramValue = new URLSearchParams(window.location.search).get("agentDebug");
  if (paramValue !== null) {
    const normalized = paramValue.trim().toLowerCase();
    const enabled = normalized === "" || ["1", "true", "yes", "on"].includes(normalized);
    try {
      window.localStorage.setItem(agentDebugStorageKey, enabled ? "1" : "0");
    } catch {
      // The URL gate still applies for this request when local storage is unavailable.
    }
    return enabled;
  }
  try {
    return window.localStorage.getItem(agentDebugStorageKey) === "1";
  } catch {
    return false;
  }
}
