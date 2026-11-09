/**
 * Whether a T3 Connect account owns this device's notifications. "none" lets the direct
 * registrar register with paired hosts; a soft provider release keeps the current mode.
 * Kept apart from remoteRegistration so the connection runtime can read it without an
 * import cycle through the server atoms.
 */
export type AgentAwarenessRelayMode = "unknown" | "relay" | "none";
let relayMode: AgentAwarenessRelayMode = "unknown";
const relayModeListeners = new Set<() => void>();

export function setAgentAwarenessRelayMode(next: AgentAwarenessRelayMode): void {
  if (relayMode === next) return;
  relayMode = next;
  for (const listener of relayModeListeners) listener();
}

export function getAgentAwarenessRelayMode(): AgentAwarenessRelayMode {
  return relayMode;
}

export function subscribeAgentAwarenessRelayMode(listener: () => void): () => void {
  relayModeListeners.add(listener);
  return () => {
    relayModeListeners.delete(listener);
  };
}
