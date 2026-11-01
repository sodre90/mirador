import type { AgentGone, HostProblem, PrelaunchFailure } from "../shared/host-problems.ts";
import type { problems } from "./i18n/en/problems.ts";

export type ProblemWords = typeof problems;

function goneText(gone: AgentGone, { gone: words }: ProblemWords) {
  switch (gone.kind) {
    case "no-answer":
      return words.noAnswer(gone.seconds);
    case "exited":
      return words.exited(gone.how);
    case "could-not-start":
      return words.couldNotStart(gone.cause);
    default:
      return words[gone.kind];
  }
}

function prelaunchText(failure: PrelaunchFailure, { prelaunch: words }: ProblemWords) {
  switch (failure.kind) {
    case "timed-out":
      return words.timedOut(failure.seconds);
    case "exited":
      return words.exited(failure.how);
    case "could-not-run":
      return words.couldNotRun(failure.cause);
  }
}

const causeText = ({ cause, causeProblem }: { cause: string; causeProblem?: HostProblem }, words: ProblemWords): string =>
  causeProblem ? problemText(causeProblem, words) : cause;

/** A problem the host described, in the language of these words. */
export function problemText(problem: HostProblem, words: ProblemWords): string {
  switch (problem.code) {
    case "could-not-resume":
      return words.couldNotResume(causeText(problem, words));
    case "could-not-set-option":
      return words.couldNotSetOption(problem.option, problem.value, causeText(problem, words));
    case "option-change-unanswered":
      return words.optionChangeUnanswered(problem.option, problem.current, problem.value, problem.seconds);
    case "usage-limit-reached":
      return words.usageLimitReached;
    case "conversation-has-no-profile":
      return words.conversationHasNoProfile;
    case "workspace-gone":
      return words.workspaceGone;
    case "conversation-deleted-while-opening":
      return words.conversationDeletedWhileOpening;
    case "agent-cannot-load-sessions":
      return words.agentCannotLoadSessions(problem.agent);
    case "agent-cannot-fork-sessions":
      return words.agentCannotForkSessions(problem.agent);
    case "opencode-not-installed":
      return words.opencodeNotInstalled;
    case "pi-not-installed":
      return words.piNotInstalled;
    case "claude-program-missing":
      return words.claudeProgramMissing(problem.program);
    case "claude-not-installed":
      return words.claudeNotInstalled(problem.installFolders, problem.installCommand);
    case "profile-environment-invalid":
      return words.profileEnvironmentInvalid(problem.profile, problem.errors);
    case "agent-not-running":
      return words.agentNotRunning(problem.agent);
    case "agent-gone":
      return words.agentGone(problem.agent, goneText(problem.gone, words));
    case "prelaunch-failed":
      return words.prelaunchFailed(problem.agent, prelaunchText(problem.failure, words), problem.output);
    case "image-missing":
      return words.imageMissing;
    case "not-an-image-of-conversation":
      return words.notAnImageOfConversation;
    case "unknown-conversation":
      return words.unknownConversation;
    case "agent-still-working":
      return words.agentStillWorking;
  }
}

/** An error the host sent: in the page's language when the host described it, else as it came, e.g. from the agent. */
export const errorText = ({ message, problem }: { message: string; problem?: HostProblem }, words: ProblemWords) =>
  problem ? problemText(problem, words) : message;
