import { jobWaitEndedNotice } from "./job-waits.ts";
import { harnessLabels, type HarnessId, type JobWait, type JobWaitEnd } from "./model.ts";
import { whatWasLeft, type Revert } from "./reverts.ts";

/** What a notice in the conversation says, for the page to put in its own language. */
export type NoticeAbout =
  | { kind: "files-put-back"; message: string; revert: Pick<Revert, "submodulesLeft" | "committed"> }
  | { kind: "turn-ended"; stopReason: string }
  | { kind: "signed-in" }
  | { kind: "sign-in-unfinished" }
  | { kind: "usage-limit-wait-stopped" }
  | { kind: "job-wait-ended"; wait: JobWait; end: JobWaitEnd }
  | { kind: "context-cleared" }
  | { kind: "agent-reloaded" }
  | { kind: "profile-changed"; profileName: string | null; agent?: HarnessId }
  | { kind: "mode"; modeId: string; modeName?: string };

/** Where the host leaves a mode's display name on the agent's mode update, since the timeline only sees stored events. */
export const MODE_NAME_META_KEY = "mirador/modeName";

function profileChangedNotice(profileName: string | null, agent: HarnessId | undefined) {
  if (!profileName) return "Now using the agent's own setup, without a profile";
  return agent ? `Now using ${harnessLabels[agent]}, with the profile “${profileName}”` : `Now using the profile “${profileName}”`;
}

/** The notice in English, as searches find it. */
export function englishNoticeText(about: NoticeAbout) {
  switch (about.kind) {
    case "files-put-back":
      return [`Files put back to how they were before the turn of “${about.message}”.`, whatWasLeft(about.revert)].filter(Boolean).join(" ");
    case "turn-ended":
      return `Turn ended: ${about.stopReason.replaceAll("_", " ")}`;
    case "signed-in":
      return "Signed in. Send your message again.";
    case "sign-in-unfinished":
      return "Signing in did not finish.";
    case "usage-limit-wait-stopped":
      return "Stopped waiting for the usage limit to reset";
    case "job-wait-ended":
      return jobWaitEndedNotice(about.wait, about.end);
    case "context-cleared":
      return "Context cleared: the agent starts afresh";
    case "agent-reloaded":
      return "Agent reloaded: it picks up its current settings and MCP servers";
    case "profile-changed":
      return profileChangedNotice(about.profileName, about.agent);
    case "mode":
      return `Mode: ${about.modeName ?? about.modeId}`;
  }
}
