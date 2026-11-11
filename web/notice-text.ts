import { minutesOfFailedChecks } from "../shared/job-waits.ts";
import { harnessLabels, type JobWait } from "../shared/model.ts";
import type { NoticeAbout } from "../shared/notices.ts";
import { t } from "./i18n/index.ts";
import { whatWasLeft } from "./revert-text.ts";

const words = t.chat.notice;

function describeJob({ job, sshHost }: Pick<JobWait, "job" | "sshHost">) {
  const named = job.kind === "process" ? t.chat.jobs.process(job.pid) : t.chat.jobs.container(job.name);
  return sshHost ? t.chat.jobs.onHost(named, sshHost) : named;
}

const stopReasonText = (stopReason: string) => words.stopReasons[stopReason as keyof typeof words.stopReasons] ?? stopReason.replaceAll("_", " ");

/** A notice of the conversation in the page's language. */
export function noticeText(about: NoticeAbout) {
  switch (about.kind) {
    case "files-put-back":
      return [words.filesPutBack(about.message), whatWasLeft(about.revert)].filter(Boolean).join(" ");
    case "turn-ended":
      return words.turnEnded(stopReasonText(about.stopReason));
    case "signed-in":
      return words.signedIn;
    case "sign-in-unfinished":
      return words.signInUnfinished;
    case "usage-limit-wait-stopped":
      return words.usageLimitWaitStopped;
    case "job-wait-ended": {
      const job = describeJob(about.wait);
      if (about.end === "gave-up") return words.gaveUpOnJob(job, minutesOfFailedChecks(about.wait));
      if (about.end === "stopped") return words.stoppedWaitingForJob(job);
      return about.wait.resume ? words.jobEnded(job) : words.jobEndedSaying(job, about.wait.message);
    }
    case "context-cleared":
      return words.contextCleared;
    case "agent-reloaded":
      return words.agentReloaded;
    case "profile-changed":
      if (!about.profileName) return words.agentsOwnSetup;
      return about.agent ? words.agentWithProfile(harnessLabels[about.agent], about.profileName) : words.profile(about.profileName);
    case "mode":
      return words.mode(about.modeName ?? about.modeId);
  }
}
