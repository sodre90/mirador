import type { StoredEvent } from "./model.ts";
import type { TimelineBlock } from "./timeline.ts";
import { speaksReplies, type VoiceSettings } from "./voice.ts";

/** What a reply's summary and sound depend on; null when replies aren't read aloud. */
export const replyReadingOf = (settings: VoiceSettings) => {
  const { voiceModel, replyVoice, replyLanguage } = settings;
  return speaksReplies(settings) ? JSON.stringify({ voiceModel, replyVoice, replyLanguage }) : null;
};

export type SpokenTurn = "going-on" | "ended" | "stopped";

/** How the first turn after the dictated message went, once it holds the message. */
export function spokenTurn(events: StoredEvent[], afterSeq: number): SpokenTurn {
  const since = events.filter(({ seq }) => seq > afterSeq);
  const asked = since.findIndex(({ event }) => event.type === "user-message");
  if (asked === -1) return "going-on";
  const ended = since.slice(asked + 1).find(({ event }) => event.type === "turn-end" || event.type === "error");
  if (!ended) return "going-on";
  return ended.event.type === "turn-end" && ended.event.stopReason === "end_turn" ? "ended" : "stopped";
}

/** The turn's last reply, which its play button reads too; none when the agent wrote nothing after the user's last message. */
export function lastReply(timeline: TimelineBlock[]) {
  const lastAsked = timeline.findLastIndex(({ kind }) => kind === "user");
  const reply = timeline.findLast((block, index) => index > lastAsked && block.kind === "agent");
  return reply?.kind === "agent" ? reply : null;
}
