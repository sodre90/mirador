/** The narrator's Kokoro voice (hear options with bun run narrate --samples). */
export const VOICE = process.env.MIRADOR_VIDEO_VOICE ?? "am_fenrir";

/** A line in a voice other than the narrator's. */
type Voiced = { text: string; voice: string };

/**
 * The Mirador trailer script: one cohesive story from wall-of-text problem to visual canvas, guided code reviews,
 * side chats, git worktrees, forked turns, multi-agent delegation, remote jobs, official plugins, and peer-to-peer.
 * Change a line here, run bun run narrate, and only changed lines are spoken again.
 */
export const LINES = {
  hook: "Coding agents write faster than you can read. Mirador gives the agents you already use a canvas, so they can show you.",
  showPoint: "Diagrams appear right beside your chat. Point at any part, and your agent redraws it live.",
  ask: "When it's your call, skip numbered lists — pick from real previews with a click.",
  review: "Reviews and tours walk you through changes in the order they run, and update in place when you push back.",
  sideChat: "Select any text and ask about it in a side chat, while the main agent keeps working.",
  worktree: "Give each conversation its own git worktree, then inspect, commit, and merge straight from Changes.",
  fork: "Fork from any turn to branch off and try another way.",
  delegate: "Mirador runs Claude Code, opencode, pi, Codex, Copilot, and Antigravity — and lets them hand work to each other.",
  jobs: "Long build on another server? Mirador watches the job and wakes your agent when it's green.",
  media: "Official plugins add apps like Media: mark what drags on the frame, and your agent cuts and renders the video.",
  p2p: "Link Mirador on another computer peer to peer — encrypted end to end, with nothing to set up.",
  mirador: "Mirador.",
  end: "See what your coding agent means.",
  openSource: "Free and open source.",
} as const satisfies Record<string, string | Voiced>;

export type LineName = keyof typeof LINES;

/** Capture-only lines that the trailer itself does not speak. */
export const CAPTURE_ONLY_LINES: LineName[] = [];

const voiced = (name: LineName): Voiced => {
  const line: string | Voiced = LINES[name];
  return typeof line === "string" ? { text: line, voice: VOICE } : line;
};
export const textOf = (name: LineName) => voiced(name).text;
export const voiceOf = (name: LineName) => voiced(name).voice;

/** Natural, confident product-launch pace (slightly calmer than 1.05 so short chapters never feel rushed). */
export const SPEED = 1.02;

/** The voices bun run narrate --samples speaks a line in, to pick from. */
export const SAMPLE_VOICES = ["af_heart", "af_bella", "af_nicole", "bf_emma", "am_michael", "am_fenrir", "bm_george", "bm_fable"];
