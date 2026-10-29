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
  wall: "Coding agents are fast. In minutes, they read your code, change ten files, and explain it all...",
  wallOfText: "in a wall of text.",
  statement: "But humans see faster than they read.",
  canvas: "Mirador gives your agent a canvas.",
  show: "So instead of describing, it shows you. Flows, architecture, mockups and charts, drawn right beside the conversation.",
  ask: "When a decision is yours, it asks with pictures. Click an option, and it carries on.",
  review: "Reviews become a guided tour of the change, in the order the code runs, with findings pinned to the lines they're about.",
  reviewAsk: "Question a finding, and the agent answers and rewrites it in place.",
  reviewPost: "Keep the ones you agree with, and post them to the pull request.",
  overview: "Run your agents across all your projects. See who's working, who's done, and who needs you.",
  edit: "Approve every edit with its diff.",
  changes: "Every change since your last commit, even outside the project.",
  terminals: "Your terminals sit right beside the conversation.",
  point: "Point at anything it drew, and ask about it, or have it changed.",
  plugins: "Mirador grows with plugins. Your agent knows the official ones, and installs one when you say so.",
  media: "Like Media. Mark what's wrong on the frame, and the agent cuts the video and renders it.",
  agents: "Mirador isn't another agent. It runs the ones you already have, and lets them work together.",
  delegate: "Here, Claude Code hands a long read to a local model on opencode, then checks what comes back.",
  jobs: "Leave the long jobs running, like the tests on your build server. Mirador keeps watch, and wakes your agent when they're done.",
  voice: "Or just talk to it.",
  voiceAsk: { text: "How long will the switch-over take, and what could go wrong?", voice: USER_VOICE },
  voiceReply: { text: "About ten minutes, read-only. It waits for replication to catch up before it switches.", voice: AGENT_VOICE },
  mirador: "Mirador.",
  end: "See what your coding agent means.",
  glance: "Understand it at a glance.",
} as const satisfies Record<string, string | Voiced>;

export type LineName = keyof typeof LINES;

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
