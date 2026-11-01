import { describe, expect, test } from "bun:test";
import { isShellCommand, shellCommandOf } from "../web/shell.ts";
import type { ToolBlock } from "../shared/timeline.ts";

const text = (value: string) => ({ type: "content" as const, content: { type: "text" as const, text: value } });

function toolBlock(fields: Partial<ToolBlock>): ToolBlock {
  return { kind: "tool", key: "1", at: 0, toolCallId: "t1", title: "ls", toolKind: "execute", status: "completed", content: [], locations: [], ...fields };
}

describe("shell commands", () => {
  test("Claude Code: the description is not output, and the console fence is dropped", () => {
    const rawInput = { command: "ls -la", description: "List files" };
    const running = shellCommandOf(toolBlock({ title: "ls -la", rawInput, status: "in_progress", content: [text("List files")] }));
    expect(running).toEqual({ command: "ls -la", description: "List files", output: "", exitCode: null, directory: null });

    const done = shellCommandOf(toolBlock({ title: "ls -la", rawInput, content: [text("```console\ntotal 0\na.txt\n```")] }));
    expect(done.output).toBe("total 0\na.txt");
  });

  test("Claude Code: a failed command's leading exit code becomes the exit code", () => {
    const failed = shellCommandOf(toolBlock({ status: "failed", content: [text("```console\nExit code 2\nls: nope\n```")] }));
    expect(failed.exitCode).toBe(2);
    expect(failed.output).toBe("ls: nope");
  });

  test("opencode: the exit code and working directory come along", () => {
    const command = shellCommandOf(
      toolBlock({
        title: "false",
        rawInput: { command: "false", description: "Fail", cwd: "/work/project" },
        content: [text("boom\n")],
        rawOutput: { output: "boom\n", metadata: { exit: 1 } },
      }),
    );
    expect(command).toEqual({ command: "false", description: "Fail", output: "boom", exitCode: 1, directory: "/work/project" });
  });

  test("pi: the output and exit code come from the terminal meta, not the content", () => {
    const command = shellCommandOf(
      toolBlock({ title: "ls b.txt", content: [{ type: "terminal", terminalId: "t1" }], terminalOutput: "ls: b.txt: No such file\n", terminalExitCode: 1 }),
    );
    expect(command).toEqual({ command: "ls b.txt", description: null, output: "ls: b.txt: No such file", exitCode: 1, directory: null });
  });

  test("colour codes are stripped, and the title stands in for a missing command", () => {
    const command = shellCommandOf(toolBlock({ title: "Terminal", content: [text("\x1b[31mred\x1b[0m plain")] }));
    expect(command.command).toBe("Terminal");
    expect(command.output).toBe("red plain");
  });

  test("only execute tools are shell commands", () => {
    expect(isShellCommand(toolBlock({}))).toBe(true);
    expect(isShellCommand(toolBlock({ toolKind: "read" }))).toBe(false);
  });
});
