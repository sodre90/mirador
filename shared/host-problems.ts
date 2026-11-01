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
  | { code: "could-not-resume"; cause: string; causeProblem?: HostProblem }
  | { code: "could-not-set-option"; option: string; value: string; cause: string; causeProblem?: HostProblem }
  | { code: "option-change-unanswered"; option: string; current: string; value: string; seconds: number }
  | { code: "usage-limit-reached" }
  | { code: "conversation-has-no-profile" }
  | { code: "workspace-gone" }
  | { code: "conversation-deleted-while-opening" }
  | { code: "agent-cannot-load-sessions"; agent: string }
  | { code: "agent-cannot-fork-sessions"; agent: string }
  | { code: "opencode-not-installed" }
  | { code: "pi-not-installed" }
  | { code: "claude-program-missing"; program: string }
  | { code: "claude-not-installed"; installFolders: string; installCommand: string }
  | { code: "profile-environment-invalid"; profile: string; errors: string }
  | { code: "agent-not-running"; agent: string }
  | { code: "agent-gone"; agent: string; gone: AgentGone }
  | { code: "prelaunch-failed"; agent: string; failure: PrelaunchFailure; output: string }
  | { code: "image-missing" }
  | { code: "not-an-image-of-conversation" }
  | { code: "unknown-conversation" }
  | { code: "agent-still-working" };

export function englishAgentGone(gone: AgentGone) {
  switch (gone.kind) {
    case "not-running":
      return "is not running";
    case "stopped":
      return "was stopped";
    case "force-stopped":
      return "was force stopped";
    case "restarted-for-profile":
      return "was restarted because its profile changed";
    case "restarted-for-claude-program":
      return "was restarted because the Claude Code program changed";
    case "no-answer":
      return `did not answer within ${gone.seconds} s of starting`;
    case "exited":
      return `exited with ${gone.how}`;
    case "could-not-start":
      return `could not start: ${gone.cause}`;
  }
}

function englishPrelaunchFailure(failure: PrelaunchFailure) {
  switch (failure.kind) {
    case "timed-out":
      return `timed out after ${failure.seconds} s`;
    case "exited":
      return `exited with ${failure.how}`;
    case "could-not-run":
      return failure.cause;
  }
}

/** The problem in English, as logs, agents, the CLI and the phone app get it. */
export function englishProblem(problem: HostProblem): string {
  switch (problem.code) {
    case "could-not-resume":
      return `Could not resume the previous agent session (${problem.cause}); starting a fresh one.`;
    case "could-not-set-option":
      return `Could not set ${problem.option} to ${problem.value}: ${problem.cause}`;
    case "option-change-unanswered":
      return `${problem.option} is still ${problem.current}: the agent has not answered the change to ${problem.value} for ${problem.seconds} seconds. It changes once the agent answers.`;
    case "usage-limit-reached":
      return "Claude's usage limit is reached.";
    case "conversation-has-no-profile":
      return "This conversation has no profile, or its profile was deleted. Pick a profile at the top of the conversation.";
    case "workspace-gone":
      return "The workspace no longer exists.";
    case "conversation-deleted-while-opening":
      return "The conversation was deleted while its agent session opened.";
    case "agent-cannot-load-sessions":
      return `${problem.agent} cannot load existing sessions.`;
    case "agent-cannot-fork-sessions":
      return `${problem.agent} cannot fork sessions.`;
    case "opencode-not-installed":
      return "opencode is not installed: no opencode executable on PATH or in its usual install directories.";
    case "pi-not-installed":
      return "pi is not installed: no pi executable on PATH. Install it with npm install -g @earendil-works/pi-coding-agent.";
    case "claude-program-missing":
      return `The Claude Code program set in Settings › Agents, ${problem.program}, does not exist or cannot run.`;
    case "claude-not-installed":
      return `Claude Code is not installed: no claude on PATH or in ${problem.installFolders}. Install it with \`${problem.installCommand}\`, or set its path in Settings › Agents.`;
    case "profile-environment-invalid":
      return `Profile "${problem.profile}" has an invalid environment: ${problem.errors}`;
    case "agent-not-running":
      return `The ${problem.agent} agent is not running`;
    case "agent-gone":
      return `The ${problem.agent} agent process ${englishAgentGone(problem.gone)}.`;
    case "prelaunch-failed":
      return `The pre-launch command of ${problem.agent} ${englishPrelaunchFailure(problem.failure)}${problem.output ? `: ${problem.output}` : ""}`;
    case "image-missing":
      return "An image of this message is missing; paste it again.";
    case "not-an-image-of-conversation":
      return "That is not an image of this conversation.";
    case "unknown-conversation":
      return "Unknown conversation.";
    case "agent-still-working":
      return "The agent is still working on the previous message.";
  }
}

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
