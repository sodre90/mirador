import type { ContentBlock, ToolCallContent } from "@agentclientprotocol/sdk";
import { contentText, type ToolBlock } from "../shared/timeline.ts";

export interface ShellCommand {
  command: string;
  description: string | null;
  output: string;
  exitCode: number | null;
  directory: string | null;
}

/** claude-agent-acp wraps command output this way when the client has no terminal of its own. */
const fencedOutput = /^```[a-z]*\n([\s\S]*?)\n?```\s*$/;
const ansiEscape = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
/** Claude Code starts a failed command's output with its exit code. */
const leadingExitCode = /^Exit code (\d+)\n?/;

export const isShellCommand = (block: ToolBlock) => block.toolKind === "execute";

export function shellCommandOf(block: ToolBlock): ShellCommand {
  const description = stringField(block.rawInput, "description");
  const printed = [...block.content.flatMap((content) => textOf(content)), ...(block.terminalOutput ? [block.terminalOutput] : [])]
    .filter((text) => text !== description)
    .map((text) => text.match(fencedOutput)?.[1] ?? text)
    .join("\n")
    .replace(ansiEscape, "")
    .trimEnd();
  const printedExitCode = printed.match(leadingExitCode);
  return {
    command: commandLineOf(block.rawInput, block.title),
    description,
    output: printedExitCode ? printed.slice(printedExitCode[0].length) : printed,
    exitCode: exitCodeOf(block.rawOutput) ?? block.terminalExitCode ?? (printedExitCode ? Number(printedExitCode[1]) : null),
    directory: stringField(block.rawInput, "cwd"),
  };
}

export const commandLineOf = (rawInput: unknown, fallback: string) => stringField(rawInput, "command") ?? fallback;

function textOf(content: ToolCallContent): string[] {
  return content.type === "content" ? [contentText(content.content as ContentBlock)] : [];
}

function stringField(value: unknown, key: string) {
  const field = (value as Record<string, unknown> | null | undefined)?.[key];
  return typeof field === "string" ? field : null;
}

/** opencode reports the exit code; Claude Code only marks a failed command as failed. */
function exitCodeOf(rawOutput: unknown) {
  const exit = (rawOutput as { metadata?: { exit?: unknown } } | null | undefined)?.metadata?.exit;
  return typeof exit === "number" ? exit : null;
}
