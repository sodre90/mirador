import { problems as englishWords } from "../web/i18n/en/problems.ts";
import { goneText, problemText, type ProblemWords } from "../web/problem-text.ts";

/** Why an agent process went away, as the host saw it. */
export type AgentGone =
  | { kind: "not-running" }
  | { kind: "stopped" }
  | { kind: "force-stopped" }
  | { kind: "restarted-for-profile" }
  | { kind: "restarted-for-claude-program" }
  | { kind: "restarted-for-reload" }
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
  | { code: "unknown-keep-deleted-canvas"; value: string }
  | { code: "unknown-keep-awake"; value: string }
  | { code: "unknown-conversation-order"; value: string }
  | { code: "unknown-plugin-update-mode"; value: string }
  | { code: "unknown-workspace-colour"; value: string }
  | { code: "not-a-machine-address"; address: string }
  | { code: "machine-already-added"; origin: string }
  | { code: "unknown-machine-colour"; value: string }
  | { code: "answer-all-questions"; count: number }
  | { code: "tab-terminal-limit"; count: number }
  | { code: "unknown-workspace"; id: string }
  | { code: "plugin-has-no-setting"; plugin: string; setting: string }
  | { code: "plugin-not-turnable"; plugin: string }
  | { code: "not-a-setting-choice"; value: string; setting: string }
  | { code: "plugin-setting-not-per-conversation"; setting: string }
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
  | { code: "editor-launcher-missing"; editor: string; launcher: string }
  | { code: "editor-command-not-found"; program: string }
  | { code: "file-name-unsafe-through-cmd"; path: string; program: string }
  | { code: "script-program-through-cmd"; program: string }
  | { code: "git-failed"; command: string; directory: string; output: string }
  | { code: "snapshot-blob-unreadable"; blob: string; directory: string }
  | { code: "not-in-git-repository"; directory: string }
  | { code: "commit-needs-message" }
  | { code: "commit-needs-files" }
  | { code: "not-an-uncommitted-change"; path: string }
  | { code: "worktree-needs-repository"; directory: string }
  | { code: "landing-needs-worktree" }
  | { code: "landing-needs-branch"; directory: string }
  | { code: "nothing-to-land"; branch: string }
  | { code: "landing-overlaps-uncommitted"; branch: string; paths: string[] }
  | { code: "landing-rebase-while-working"; branch: string }
  | { code: "landing-worktree-edits-clash"; branch: string; paths: string[] }
  | { code: "landing-conflicts"; branch: string; paths: string[] }
  | { code: "landing-mid-operation"; directory: string }
  | { code: "save-path-absolute"; name: string }
  | { code: "save-path-outside"; name: string }
  | { code: "save-path-is-folder"; name: string }
  | { code: "save-already-there"; path: string }
  | { code: "save-path-part-is-file"; name: string }
  | { code: "config-file-must-be-object"; path: string }
  | { code: "tailscale-serve-exited"; exitCode: number }
  | { code: "machine-certificate-not-its-own"; machine: string; hostname: string }
  | { code: "machine-did-not-answer"; machine: string }
  | { code: "machine-certificate-untrusted"; machine: string }
  | { code: "machine-gave-no-token"; machine: string }
  | { code: "machine-authority-not-in-link"; machine: string }
  | { code: "machine-authority-changed"; machine: string }
  | { code: "join-request-denied"; machine: string }
  | { code: "join-request-timed-out"; machine: string }
  | { code: "git-ls-remote-failed"; output: string }
  | { code: "plugin-renamed"; name: string; installedName: string; folder: string }
  | { code: "git-fetch-failed"; output: string }
  | { code: "git-clone-failed"; output: string }
  | { code: "repo-is-not-a-plugin"; cause: string; causeProblem?: HostProblem }
  | { code: "plugin-tag-version-mismatch"; tag: string; release: string; version: string }
  | { code: "plugin-build-failed"; command: string; output: string }
  | { code: "plugin-invalid-after-build"; cause: string; causeProblem?: HostProblem }
  | { code: "plugin-invalid-after-cloning"; cause: string; causeProblem?: HostProblem }
  | { code: "plugin-folder-taken"; name: string }
  | { code: "plugin-name-taken"; folder: string; name: string }
  | { code: "plugin-not-installed"; folder: string }
  | { code: "plugin-not-from-git"; folder: string }
  | { code: "plugin-has-nothing-to-update-from"; folder: string }
  | { code: "plugin-name-already-used"; name: string }
  | { code: "plugin-tool-name-reserved"; tool: string }
  | { code: "plugin-tool-name-taken"; tool: string; plugin: string }
  | { code: "plugin-api-too-new"; api: number; newest: number }
  | { code: "plugin-canvas-needs-newer-api"; brought: number; named: number }
  | { code: "plugin-profile-settings-needs-newer-api"; brought: number; named: number }
  | { code: "plugin-file-outside-folder"; path: string }
  | { code: "plugin-file-missing"; path: string }
  | { code: "plugin-host-module-missing-exports"; names: string }
  | { code: "plugin-tasks-unusable"; tasks: string }
  | { code: "item-plugin-not-installed"; plugin: string }
  | { code: "plugin-takes-no-actions"; plugin: string }
  | { code: "newer-version-git-failed"; command: string; exitCode: number }
  | { code: "newer-version-fetch-failed"; upstream: string }
  | { code: "newer-version-github-answered"; status: number }
  | { code: "diff-too-many-lines"; lines: number }
  | { code: "statusline-timed-out"; seconds: number }
  | { code: "statusline-exited"; exitCode: number; firstError: string }
  | { code: "image-at-most"; megabytes: number }
  | { code: "image-type-unsupported"; type: string }
  | { code: "dropped-file-at-most"; megabytes: number }
  | { code: "dropped-file-name-unusable"; name: string }
  | { code: "voice-engine-model-being-removed"; model: string }
  | { code: "voice-engine-model-downloading"; model: string }
  | { code: "voice-engine-model-not-on-mac"; model: string }
  | { code: "voice-profile-has-no-key"; profile: string }
  | { code: "speech-server-timed-out"; minutes: number }
  | { code: "voice-model-timed-out"; minutes: number; askNotToThink: boolean }
  | { code: "reply-voice-server-timed-out"; minutes: number }
  | { code: "speech-server-answered"; status: number; detail: string }
  | { code: "voice-model-answered"; status: number; detail: string }
  | { code: "reply-voice-server-answered"; status: number; detail: string }
  | { code: "voice-model-ran-out-of-room"; askNotToThink: boolean }
  | { code: "reply-voice-wav-unreadable"; format: number; bits: number }
  | { code: "engine-speech-server-stopped-starting"; log: string }
  | { code: "engine-voice-model-server-stopped-starting"; log: string }
  | { code: "engine-speaking-server-stopped-starting"; log: string }
  | { code: "engine-speech-server-start-timed-out"; seconds: number }
  | { code: "engine-voice-model-server-start-timed-out"; seconds: number }
  | { code: "engine-speaking-server-start-timed-out"; seconds: number }
  | { code: "engine-has-no-such-model"; model: string }
  | { code: "engine-files-list-failed"; host: string; status: number; repo: string }
  | { code: "engine-file-outside-model-folder"; repo: string; path: string }
  | { code: "engine-needs-space"; needed: string; free: string }
  | { code: "engine-download-answered"; host: string; status: number; url: string }
  | { code: "engine-command-failed"; command: string; lastError: string; exitCode: number }
  | { code: "engine-download-differs"; url: string }
  | { code: "engine-adding-failed"; models: string[]; cause: string; causeProblem?: HostProblem }
  | { code: "not-a-language-code"; language: string }
  | { code: "unloading-minutes"; most: number }
  | { code: "engine-could-not-reach"; host: string; cause: string }
  | { code: "engine-download-host-busy"; host: string; status: number }
  | { code: "engine-download-broke-off"; url: string }
  | { code: "engine-download-wrong-size"; url: string; bytes: number }
  | { code: "plugin-window-needs-newer-api"; brought: number; named: number }
  | { code: "workspace-tab-needs-newer-api"; brought: number; named: number }
  | { code: "plugin-background-needs-newer-api"; brought: number; named: number }
  | { code: "plugin-typed-settings-need-newer-api"; brought: number; named: number }
  | { code: "plugin-switch-needs-newer-api"; brought: number; named: number }
  | { code: "plugin-required-setting-needs-newer-api"; brought: number; named: number }
  | { code: "plugin-statusline-needs-newer-api"; brought: number; named: number }
  | { code: "canvas-host-module-needs"; needs: HostProblem[] }
  | { code: "canvas-need-item-shape"; item: string; placements: string[] }
  | { code: "canvas-need-item-opens-with-room"; item: string; rooms: string[] }
  | { code: "canvas-need-tool-name"; tool: string }
  | { code: "canvas-need-tool-shape"; tool: string }
  | { code: "canvas-need-command-shape"; tool: string }
  | { code: "plugin-command-needs-newer-api"; brought: number; named: number }
  | { code: "plugin-command-unknown"; command: string }
  | { code: "plugin-off-for-profile"; plugin: string; profile: string }
  | { code: "command-arguments-syntax"; near: string }
  | { code: "command-argument-unknown"; argument: string; known: string[] }
  | { code: "command-arguments-missing"; missing: string[] }
  | { code: "agent-gone"; agent: string; gone: AgentGone }
  | { code: "prelaunch-failed"; agent: string; failure: PrelaunchFailure; output: string }
  | { code: "profile-test-unanswered"; seconds: number };

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

/** The HTTP header a reply names the problem in, beside its English body, for the page to say it in its own language. */
export const PROBLEM_HEADER = "X-Mirador-Problem";

/** The problem a reply's header names; none when it names none or can't be read. */
export function problemInHeader(header: string | null): HostProblem | undefined {
  if (!header) return undefined;
  try {
    const problem = JSON.parse(decodeURIComponent(header));
    return typeof problem?.code === "string" ? problem : undefined;
  } catch {
    return undefined;
  }
}

/** A reply's problem as the page shows it: in English, and as the problem it was about when the host described it. */
export interface DescribedProblem {
  problem: string;
  problemAbout?: HostProblem;
}

/** Why a diff is hidden, in English and as the problem it was about. */
export const hiddenBecause = (problem: HostProblem) => ({ hiddenBecause: englishProblem(problem), hiddenBecauseAbout: problem });

/** A problem the host describes, as a reply's problem. */
export const described = (problem: HostProblem): DescribedProblem => ({ problem: englishProblem(problem), problemAbout: problem });

/** What an error says as a reply's problem: `problem` is its English, the way the reply showed it before. */
export const problemFieldsOf = (error: unknown, problem: string): DescribedProblem => ({ problem, ...(error instanceof HostProblemError && { problemAbout: error.problem }) });

/** The problem an error is about, when the host described it, to send along with the error's English message. */
export const problemOf = (error: unknown): { problem: HostProblem } | Record<string, never> => (error instanceof HostProblemError ? { problem: error.problem } : {});
