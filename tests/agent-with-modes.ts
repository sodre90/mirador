/**
 * An agent that offers Claude Code's modes, opens each new session in `startsIn` as its settings' default mode would
 * have it, and logs each option change it is asked for as `label:option=value`.
 */
export function agentWithModes(label: string, log: string[], startsIn = "default") {
  let sessions = 0;
  let mode = startsIn;
  const options = () => [
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: mode,
      options: [
        { value: "default", name: "Default" },
        { value: "acceptEdits", name: "Accept edits" },
        { value: "bypassPermissions", name: "Bypass permissions" },
      ],
    },
  ];
  return {
    spec: { id: "claude", label: "Claude Code", environment: {} },
    start: async () => ({ agentCapabilities: {} }),
    newSession: async () => {
      mode = startsIn;
      return { sessionId: `${label}-session-${++sessions}`, configOptions: options() };
    },
    setConfigOption: async (_sessionId: string, id: string, value: string) => {
      log.push(`${label}:${id}=${value}`);
      if (id === "mode") mode = value;
      return { configOptions: options() };
    },
    prompt: async () => ({ stopReason: "end_turn" }),
    cancel: async () => {},
    closeSession: async () => {},
    stop: async () => {},
  };
}
