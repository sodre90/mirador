/** Whose voice a line is in: the narrator's, or one of the people heard in the voice scene. */
export const VOICE = process.env.MIRADOR_VIDEO_VOICE ?? "am_fenrir";
const USER_VOICE = "am_puck";
const AGENT_VOICE = "af_heart";

/** A line in a voice other than the narrator's. */
type Voiced = { text: string; voice: string };

/**
 * What is said; the storyboard puts each line in a scene, at a second. Change a line here, run bun run narrate, and only
 * that line is spoken again. A line given with its voice is said by someone other than the narrator.
 */
export const LINES = {
  hook: "Coding agents explain everything in a wall of text. Mirador gives them a canvas, so they can show you.",
  show: "Flows, mockups and charts, drawn right beside your chat.",
  ask: "When it's your call, it asks with pictures.",
  review: "Reviews become a guided tour of the change, with findings pinned to the lines.",
  plugins: "Your agent installs official plugins when you say so.",
  media: "Mark what's wrong on the frame, and the agent cuts the video.",
  delegate: "It runs the agents you already have. Here, Claude Code hands a long read to a local model on opencode.",
  jobs: "Long jobs? Mirador keeps watch, and wakes your agent when they're done.",
  voiceAsk: { text: "How long will the switch-over take, and what could go wrong?", voice: USER_VOICE },
  voiceReply: { text: "About ten minutes, read-only. It waits for replication to catch up before it switches.", voice: AGENT_VOICE },
  mirador: "Mirador.",
  end: "See what your coding agent means.",
  glance: "Understand it at a glance.",
} as const satisfies Record<string, string | Voiced>;

export type LineName = keyof typeof LINES;

/** Lines the capture plays in the voice clip, which the trailer no longer shows; they go once that filming does (vcs-tk89). */
export const CAPTURE_ONLY_LINES: LineName[] = ["voiceAsk", "voiceReply"];

const voiced = (name: LineName): Voiced => {
  const line: string | Voiced = LINES[name];
  return typeof line === "string" ? { text: line, voice: VOICE } : line;
};
export const textOf = (name: LineName) => voiced(name).text;
export const voiceOf = (name: LineName) => voiced(name).voice;

/** Kokoro's pace. Hear the narrator's other voices with bun run narrate --samples. */
export const SPEED = 1;

/** The voices bun run narrate --samples speaks a line in, to pick from. */
export const SAMPLE_VOICES = ["af_heart", "af_bella", "af_nicole", "bf_emma", "am_michael", "am_fenrir", "bm_george", "bm_fable"];
