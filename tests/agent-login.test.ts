import { expect, test } from "bun:test";
import { RequestError } from "@agentclientprotocol/sdk";
import { isAuthRequiredError, loginCommand } from "../host/acp/harnesses.ts";

test("a prompt the agent refuses until the user signs in again is told apart from other failures", () => {
  expect(isAuthRequiredError(RequestError.authRequired())).toBe(true);
  expect(isAuthRequiredError(RequestError.authRequired(undefined, "Please run /login"))).toBe(true);
  expect(isAuthRequiredError(RequestError.internalError())).toBe(false);
  expect(isAuthRequiredError(new Error("Authentication required"))).toBe(false);
});

test("Claude Code signs in with the program the agent runs, inside a wrapper that keeps a failure on screen", () => {
  const [shell, flag, script, name, ...command] = loginCommand("claude", { CLAUDE_CODE_EXECUTABLE: "/opt/claude/bin/claude" }, { kind: "posix", program: "/bin/sh" });
  expect([shell, flag, name]).toEqual(["/bin/sh", "-c", "mirador-login"]);
  expect(script).toContain("Press Enter to close this tab.");
  expect(command).toEqual(["/opt/claude/bin/claude", "auth", "login"]);
});

test("on Windows without Git Bash, the sign-in runs in PowerShell and keeps a failure on screen the same way", () => {
  const [shell, ...args] = loginCommand("claude", { CLAUDE_CODE_EXECUTABLE: "C:\\Users\\me\\.local\\bin\\claude.exe" }, { kind: "powershell", program: "powershell.exe" });
  expect(shell).toBe("powershell.exe");
  expect(args.at(-1)).toStartWith("& 'C:\\Users\\me\\.local\\bin\\claude.exe' 'auth' 'login'\n");
  expect(args.at(-1)).toContain("Press Enter to close this tab.");
});
