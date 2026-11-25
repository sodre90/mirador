/** The narrator's Kokoro voice (hear options with bun run narrate --samples). */
export const VOICE = process.env.MIRADOR_VIDEO_VOICE ?? "am_fenrir";

/** A line in a voice other than the narrator's. */
type Voiced = { text: string; voice: string };

/**
 * The flagship 0.15.5 trailer script: one cohesive story from wall-of-text problem to visual canvas, guided code
 * reviews, side chats, official plugins, multi-agent delegation, remote jobs, and zero-setup peer-to-peer.
 * Change a line here, run bun run narrate, and only changed lines are spoken again.
 */
export const LINES = {
  hook: "Coding agents explain everything in walls of text. Mirador gives them a canvas, so they can show you.",
  showPoint: "Architecture, flows, and mockups, right beside your chat. Point at anything they drew, and watch it update live.",
  ask: "When it's your call, skip numbered lists — pick from real previews with a click.",
  review: "Code reviews and tours walk you through changes in execution order, with findings pinned to exact lines, updated in place when you push back.",
  sideChat: "Ask a quick side question without interrupting the turn, and inspect or commit every change right from the canvas.",
  media: "Install official plugins on demand — like Media: mark what drags on the frame, and your agent cuts and renders the video.",
  delegate: "Mirador runs the agents you already have — Claude Code, opencode, pi, Codex, Copilot, and Antigravity — and lets them delegate work to each other.",
  jobs: "Long builds on another server? Mirador watches the job and wakes your agent the moment it finishes.",
  p2p: "And now in Mirador zero point fifteen point five, connect your phone or another computer peer to peer — encrypted end to end, with nothing to configure.",
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

/** Slightly brisker pace than 1.0 for confident, modern product-launch energy. */
export const SPEED = 1.05;

/** The voices bun run narrate --samples speaks a line in, to pick from. */
export const SAMPLE_VOICES = ["af_heart", "af_bella", "af_nicole", "bf_emma", "am_michael", "am_fenrir", "bm_george", "bm_fable"];
