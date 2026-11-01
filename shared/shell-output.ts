/** How a shell command the agent ran shows in a conversation until someone opens or closes it. */
export type ShellOutputStyle = "command" | "failures-open" | "one-line" | "open";

export const SHELL_OUTPUT_STYLES: readonly ShellOutputStyle[] = ["command", "failures-open", "one-line", "open"];

export const DEFAULT_SHELL_OUTPUT_STYLE: ShellOutputStyle = "command";

export const shellOutputStyleLabels: Record<ShellOutputStyle, string> = {
  command: "Command, output when opened",
  "failures-open": "Command, output open when it failed",
  "one-line": "One line",
  open: "Command and output",
};

export const outputStartsOpen = (style: ShellOutputStyle, failed: boolean) => style === "open" || (style === "failures-open" && failed);

export const commandShownClosed = (style: ShellOutputStyle) => style !== "one-line";
