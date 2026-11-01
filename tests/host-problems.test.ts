import { describe, expect, test } from "bun:test";
import { causeOf, englishProblem, HostProblemError, problemOf, type HostProblem } from "../shared/host-problems.ts";
import { en } from "../web/i18n/en/index.ts";
import { hu } from "../web/i18n/hu/index.ts";
import { errorText, problemText } from "../web/problem-text.ts";

const problems: HostProblem[] = [
  { code: "could-not-resume", cause: "Session not found" },
  { code: "could-not-set-option", option: "Model", value: "opus", cause: "Invalid params" },
  { code: "option-change-unanswered", option: "Model", current: "sonnet", value: "opus", seconds: 10 },
  { code: "usage-limit-reached" },
  { code: "conversation-has-no-profile" },
  { code: "workspace-gone" },
  { code: "conversation-deleted-while-opening" },
  { code: "agent-cannot-load-sessions", agent: "pi" },
  { code: "agent-cannot-fork-sessions", agent: "pi" },
  { code: "opencode-not-installed" },
  { code: "pi-not-installed" },
  { code: "claude-program-missing", program: "/opt/claude" },
  { code: "claude-not-installed", installFolders: "~/.local/bin", installCommand: "curl -fsSL https://claude.ai/install.sh | bash" },
  { code: "profile-environment-invalid", profile: "Work", errors: "Line 2 has no =" },
  { code: "agent-not-running", agent: "Claude Code" },
  ...(["not-running", "stopped", "force-stopped", "restarted-for-profile", "restarted-for-claude-program"] as const).map(
    (kind): HostProblem => ({ code: "agent-gone", agent: "Claude Code", gone: { kind } }),
  ),
  { code: "agent-gone", agent: "Claude Code", gone: { kind: "no-answer", seconds: 30 } },
  { code: "agent-gone", agent: "Claude Code", gone: { kind: "exited", how: "1" } },
  { code: "agent-gone", agent: "Claude Code", gone: { kind: "could-not-start", cause: "ENOENT" } },
  { code: "prelaunch-failed", agent: "pi", failure: { kind: "timed-out", seconds: 60 }, output: "" },
  { code: "prelaunch-failed", agent: "pi", failure: { kind: "exited", how: "2" }, output: "no such file" },
  { code: "prelaunch-failed", agent: "pi", failure: { kind: "could-not-run", cause: "spawn sh ENOENT" }, output: "" },
  { code: "image-missing" },
  { code: "not-an-image-of-conversation" },
  { code: "unknown-conversation" },
  { code: "agent-still-working" },
];

describe("problems the host describes", () => {
  test("in English, the page says what the host wrote", () => {
    for (const problem of problems) expect(problemText(problem, en.problems)).toBe(englishProblem(problem));
  });

  test("an error about one carries it, with the English as its message", () => {
    const error = new HostProblemError({ code: "workspace-gone" });
    expect(error.message).toBe("The workspace no longer exists.");
    expect(problemOf(error)).toEqual({ problem: { code: "workspace-gone" } });
    expect(problemOf(new Error("Overloaded"))).toEqual({});
  });

  test("the page says one the host described in its language, and an error from the agent as it came", () => {
    expect(errorText({ message: "The workspace no longer exists.", problem: { code: "workspace-gone" } }, hu.problems)).toBe("A munkaterület már nem létezik.");
    expect(errorText({ message: "Overloaded" }, hu.problems)).toBe("Overloaded");
  });

  test("a cause the host described is said in the page's language too", () => {
    const gone = new HostProblemError({ code: "agent-gone", agent: "Claude Code", gone: { kind: "exited", how: "1" } });
    const problem: HostProblem = { code: "could-not-resume", ...causeOf(gone, gone.message) };
    expect(englishProblem(problem)).toBe("Could not resume the previous agent session (The Claude Code agent process exited with 1.); starting a fresh one.");
    expect(problemText(problem, hu.problems)).toBe("Az ágens előző munkamenetét nem sikerült folytatni (Az ágens folyamata (Claude Code) kilépett (1).), ezért új indul.");
  });
});
