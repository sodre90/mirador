import { problems as englishWords } from "../web/i18n/en/problems.ts";
import { goneText, problemText, type ProblemWords } from "../web/problem-text.ts";

/** Why an agent process went away, as the host saw it. */
export type AgentGone =
  | { kind: "not-running" }
  | { kind: "stopped" }
  | { kind: "force-stopped" }
  | { kind: "restarted-for-profile" }
  | { kind: "restarted-for-claude-program" }
  | { kind: "no-answer"; seconds: number }
  | { kind: "exited"; how: string }
  | { kind: "could-not-start"; cause: string };

/** How a profile's pre-launch command failed. */
export type PrelaunchFailure = { kind: "timed-out"; seconds: number } | { kind: "exited"; how: string } | { kind: "could-not-run"; cause: string };

/**
 * A problem the host itself describes, for the page to say in its own language; `cause` and the like hold what an agent,
 * git or the system said, which stays as it came.
 */
export type HostProblem =
  | { code: keyof ProblemWords["fixed"] }
  | { code: "could-not-resume"; cause: string; causeProblem?: HostProblem }
  | { code: "could-not-set-option"; option: string; value: string; cause: string; causeProblem?: HostProblem }
  | { code: "option-change-unanswered"; option: string; current: string; value: string; seconds: number }
  | { code: "agent-cannot-load-sessions"; agent: string }
  | { code: "agent-cannot-fork-sessions"; agent: string }
  | { code: "claude-program-missing"; program: string }
  | { code: "claude-not-installed"; installFolders: string; installCommand: string }
  | { code: "profile-environment-invalid"; profile: string; errors: string }
  | { code: "agent-not-running"; agent: string }
  | { code: "no-such-conversation"; id: string }
  | { code: "agent-cannot-search-sessions"; agent: string }
  | { code: "agent-cannot-list-sessions"; agent: string }
  | { code: "conversation-runs-on-other-agent"; agent: string; profile: string; profileAgent: string }
  | { code: "files-no-longer-kept"; turns: number }
  | { code: "agent-cannot-leave-session-behind"; agent: string }
  | { code: "not-a-slash-command"; line: string }
  | { code: "agent-has-no-such-command"; agent: string; line: string }
  | { code: "unknown-agent"; agent: string }
  | { code: "profile-is-for-other-agent"; profile: string; profileAgent: string; agent: string }
  | { code: "unknown-questions-setting"; value: string }
  | { code: "unknown-colour"; value: string }
  | { code: "not-a-directory"; path: string }
  | { code: "unknown-canvas-use"; value: string }
  | { code: "unknown-keep-awake"; value: string }
  | { code: "unknown-workspace-colour"; value: string }
  | { code: "not-a-machine-address"; address: string }
  | { code: "machine-already-added"; origin: string }
  | { code: "unknown-machine-colour"; value: string }
  | { code: "answer-all-questions"; count: number }
  | { code: "tab-terminal-limit"; count: number }
  | { code: "unknown-workspace"; id: string }
  | { code: "plugin-has-no-setting"; plugin: string; setting: string }
  | { code: "not-a-setting-choice"; value: string; setting: string }
  | { code: "app-not-installed"; app: string }
  | { code: "app-storage-keeps-text"; app: string }
  | { code: "app-storage-full"; app: string; characters: number; key: string }
  | { code: "file-leads-outside-workspace"; path: string }
  | { code: "agent-did-not-change-file"; path: string }
  | { code: "not-a-workspace-file"; path: string }
  | { code: "not-a-line-number"; line: string }
  | { code: "file-does-not-exist"; path: string }
  | { code: "file-does-not-exist-in"; path: string; workspace: string }
  | { code: "file-would-run"; path: string }
  | { code: "no-program-for-file"; path: string }
  | { code: "file-cannot-open-as-text"; path: string }
  | { code: "executable-not-opened"; file: string }
  | { code: "script-program-not-found"; program: string }
  | { code: "script-program-through-cmd"; program: string }
  | { code: "git-failed"; command: string; directory: string; output: string }
  | { code: "snapshot-blob-unreadable"; blob: string; directory: string }
  | { code: "not-in-git-repository"; directory: string }
  | { code: "save-path-absolute"; name: string }
  | { code: "save-path-outside"; name: string }
  | { code: "save-path-is-folder"; name: string }
  | { code: "save-already-there"; path: string }
  | { code: "save-path-part-is-file"; name: string }
  | { code: "agent-gone"; agent: string; gone: AgentGone }
  | { code: "prelaunch-failed"; agent: string; failure: PrelaunchFailure; output: string };

/** Why the agent process went away, in English. */
export const englishAgentGone = (gone: AgentGone) => goneText(gone, englishWords);

/** The problem in English, as logs, agents, the CLI and the phone app get it. */
export const englishProblem = (problem: HostProblem) => problemText(problem, englishWords);

/** An error the host throws about a problem of its own: its message is the problem in English. */
export class HostProblemError extends Error {
  constructor(readonly problem: HostProblem) {
    super(englishProblem(problem));
  }
}

/** The cause of a problem: what the error said in English, and the problem it was about when the host described it. */
export const causeOf = (error: unknown, message: string) => ({ cause: message, ...(error instanceof HostProblemError && { causeProblem: error.problem }) });

/** The problem an error is about, when the host described it, to send along with the error's English message. */
export const problemOf = (error: unknown): { problem: HostProblem } | Record<string, never> => (error instanceof HostProblemError ? { problem: error.problem } : {});
