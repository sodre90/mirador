import { ACCENTS, BRAND } from "./brand.ts";
import type { Caption, Scene } from "./timeline.ts";

/**
 * The score's tempo: 120 BPM gives exactly 0.5 s (30 frames at 60 fps) per beat and 2.0 s (120 frames) per bar,
 * keeping every cut and musical accent frame-accurate.
 */
export const TEMPO = 120;
/** Whole beats of the score, in seconds. */
export const beats = (count: number) => (count * 60) / TEMPO;

/** The review's flow: the steps along the top, and the code of the step under them. */
const FLOW = { x: 256, y: 80, width: 1280, height: 720 };
/** Media's frame, its timeline and the note under it. */
const MEDIA_EDITOR = { x: 830, y: 74, width: 706, height: 660 };
/** The workspace with the delegated conversation under its caller, and the task working above the composer. */
const DELEGATED_TASK = { x: 0, y: 260, width: 840, height: 500 };
/** The chat turn whose words the side chat scene selects, kept cleanly inside the frame with full left and top margin. */
const SELECTED_WORDS = { x: 256, y: 20, width: 1024, height: 576 };
/** The user's first turn and its "Fork from here" hover action. */
const FORK_TRIGGER = { x: 256, y: 40, width: 580, height: 340 };
/** The sidebar's new forked row alongside the branched conversation. */
const FORK_RESULT = { x: 0, y: 48, width: 880, height: 500 };

const NARRATION_AT = 0.25;
/** The music dips gently under feature chapters to preserve rhythmic drive. */
const FEATURE_DIP = 0.58;

/** Top-floating chapter bar naming the chapter number, feature, and one-line takeaway without overlapping the UI. */
const chapter = (kicker: string, title: string, accent: string): Caption[] => [{ kicker, title, at: 0.18, accent }];

/**
 * The Mirador flagship trailer (~88 s, 4K 60fps):
 * - Hook (8 s / 4 bars): accelerating wall of agent text -> live animated Checkout sequence diagram.
 * - Act 1 (14 s / 7 bars): Canvas & Point-and-ask, Ask visual previews.
 * - Act 2 (14 s / 7 bars): Review & Tours, Side Chat (select any text while the agent works).
 * - Act 3 (22 s / 11 bars): Git Worktrees + Changes, Fork from any turn, Multi-Agent delegation.
 * - Act 4 (22 s / 11 bars): Background Jobs, Plugins & Media, Peer-to-Peer between computers.
 * - End Card (8 s / 4 bars): direct downbeat resolution, no empty backdrop gap.
 */
export const STORYBOARD: Scene[] = [
  {
    kind: "picture",
    id: "hook",
    accent: BRAND.violet,
    seconds: beats(16),
    narration: [{ line: "hook", at: 0.2 }],
    fadeInFrames: 0,
  },
  {
    kind: "clip",
    id: "showPoint",
    clip: "showPoint",
    accent: ACCENTS.violet,
    tilt: 1,
    captions: chapter("01 · Canvas", "Live diagrams — point at anything to change it", ACCENTS.violet),
    shots: [
      { from: ["canvasShown", -0.05], to: ["pointing", 0.2], speed: 2.8 },
      { from: ["pointing", 0.2], to: ["asked", 0.1], speed: 2.8 },
      { from: ["asked", 0.1], to: ["turnEnded", 1.8], speed: 2.0 },
    ],
    camera: [
      { at: ["canvasShown", -0.05], look: "canvas", zoom: 1.16 },
      { at: ["pointing", 0.2], look: "canvas", zoom: 1.32 },
      { at: ["redrawn", 0.0], look: "app" },
    ],
    slam: true,
    narration: [{ line: "showPoint", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(16),
  },
  {
    kind: "clip",
    id: "ask",
    clip: "ask",
    accent: ACCENTS.sky,
    tilt: -1,
    captions: chapter("02 · Ask", "Pick from real previews with a click", ACCENTS.sky),
    shots: [
      { from: ["opened", -0.1], to: ["picked", 0.25], speed: 1.75 },
      { from: ["picked", 0.25], to: ["turnEnded", 1.2], speed: 1.45 },
    ],
    camera: [
      { at: ["opened", -0.1], look: "question", zoom: 1.16 },
      { at: ["submitted", 0.2], look: "app" },
    ],
    slam: true,
    narration: [{ line: "ask", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(12),
  },
  {
    kind: "clip",
    id: "review",
    clip: "review",
    accent: ACCENTS.coral,
    tilt: 1,
    captions: chapter("03 · Review & Tours", "Guided code walkthroughs, updated in place", ACCENTS.coral),
    shots: [
      { from: ["reviewShown", -0.1], to: "flow", speed: 2.1 },
      { from: "flow", to: ["findings", -0.1], speed: 2.9 },
      { from: ["findings", -0.1], to: ["findings", 1.4], speed: 1.5 },
      { from: ["asked", -2.0], to: ["asked", 0.2], speed: 2.2, fadeInFrames: 6 },
      { from: ["rewritten", -0.5], to: ["answered", 1.5], speed: 1.1 },
    ],
    camera: [
      { at: ["reviewShown", -0.1], look: "canvas", zoom: 1.08 },
      { at: ["flowStep", 0.1], look: FLOW, zoom: 1.18 },
      { at: ["findings", 0.1], look: "blocker", zoom: 1.24 },
      { at: ["rewritten", 0.0], look: "rewrittenBlocker", zoom: 1.22 },
    ],
    slam: true,
    narration: [{ line: "review", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(16),
  },
  {
    kind: "clip",
    id: "sideChat",
    clip: "sideChat",
    accent: ACCENTS.emerald,
    tilt: -1,
    captions: chapter("04 · Side Chat", "Select any text and ask — the agent keeps working", ACCENTS.emerald),
    shots: [
      { from: ["selecting", -0.25], to: ["selected", 0.35], speed: 1.6 },
      { from: ["selected", 0.35], to: ["sideOpened", 0.55], speed: 1.9 },
      { from: ["asked", -1.4], to: ["asked", 0.8], speed: 1.85, fadeInFrames: 6 },
      { from: ["sideAnswered", -0.35], to: ["sideAnswered", 2.35], speed: 1.15, fadeInFrames: 6 },
    ],
    camera: [
      { at: ["selecting", -0.25], look: SELECTED_WORDS, zoom: 1.24 },
      { at: ["sideOpened", 0.0], look: "sideArea", zoom: 1.12 },
    ],
    slam: true,
    narration: [{ line: "sideChat", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(12),
  },
  {
    kind: "clip",
    id: "worktree",
    clip: "worktree",
    accent: ACCENTS.cyan,
    tilt: 1,
    captions: chapter("05 · Worktrees", "A worktree per conversation — commit & merge from Changes", ACCENTS.cyan),
    shots: [
      { from: ["dialog", 0.1], to: ["chosen", 0.0], speed: 2.8 },
      { from: ["sent", -0.4], to: ["edited", 0.3], speed: 2.9, fadeInFrames: 6 },
      { from: ["changesOpened", -0.05], to: ["diffOpened", 0.8], speed: 2.0, fadeInFrames: 6 },
      { from: ["commitDialog", 0.0], to: ["commitDialog", 1.1], speed: 1.9, fadeInFrames: 6 },
      { from: ["committed", -0.8], to: ["merged", 1.2], speed: 1.8, fadeInFrames: 6 },
    ],
    camera: [
      { at: ["dialog", 0.1], look: "dialog", zoom: 1.48 },
      { at: ["sent", -0.4], look: "app", cut: true },
      { at: ["changesOpened", -0.05], look: "changes", zoom: 1.18 },
      { at: ["commitDialog", 0.0], look: "commitDialog", zoom: 1.32 },
      { at: ["committed", -0.8], look: "changes", zoom: 1.18 },
    ],
    slam: true,
    narration: [{ line: "worktree", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(16),
  },
  {
    kind: "clip",
    id: "fork",
    clip: "fork",
    accent: ACCENTS.sky,
    tilt: -1,
    captions: chapter("06 · Fork", "Branch off from any turn to try another way", ACCENTS.sky),
    shots: [{ from: ["hovered", -0.4], to: ["canvasCopied", 2.1], speed: 1.0 }],
    camera: [
      { at: ["hovered", -0.4], look: FORK_TRIGGER, zoom: 1.75 },
      { at: ["forked", 0.0], look: FORK_RESULT, zoom: 1.28 },
    ],
    slam: true,
    narration: [{ line: "fork", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(10),
  },
  {
    kind: "clip",
    id: "delegate",
    clip: "delegate",
    accent: ACCENTS.amber,
    tilt: 1,
    captions: chapter("07 · Multi-Agent", "Claude Code delegates a sweep to local opencode", ACCENTS.amber),
    shots: [
      { from: ["sent", -1.2], to: ["sent", 0.8], speed: 1.5 },
      { from: ["delegated", -0.5], to: ["unfolded", 0.6], speed: 1.25, fadeInFrames: 6 },
      { from: ["unfolded", 0.6], to: ["replied", -0.1], speed: 1.8 },
      { from: ["replied", -0.1], to: ["checked", 1.7], speed: 1.3 },
    ],
    camera: [
      { at: ["sent", -1.2], look: "timeline", zoom: 1.22 },
      { at: ["delegated", 0.1], look: DELEGATED_TASK, zoom: 1.22 },
      { at: ["replied", 0.1], look: "app" },
    ],
    slam: true,
    narration: [{ line: "delegate", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(18),
  },
  {
    kind: "clip",
    id: "jobs",
    clip: "jobs",
    accent: ACCENTS.cyan,
    tilt: -1,
    captions: chapter("08 · Background Jobs", "Watches remote builds & wakes your agent when green", ACCENTS.cyan),
    shots: [
      { from: ["waiting", -0.25], to: ["following", 0.5], speed: 2.1 },
      { from: ["following", 0.5], to: ["passed", 0.5], speed: 7.5 },
      { from: ["passed", 0.5], to: ["woken", -0.1], speed: 5.5 },
      { from: ["woken", -0.1], to: ["reported", 1.5], speed: 1.4 },
    ],
    camera: [
      { at: ["waiting", -0.25], look: "jobWait", zoom: 1.42 },
      { at: ["following", -0.1], look: "terminals", zoom: 1.14 },
      { at: ["woken", -0.2], look: "app" },
    ],
    slam: true,
    narration: [{ line: "jobs", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(14),
  },
  {
    kind: "clip",
    id: "media",
    clip: "media",
    accent: ACCENTS.pink,
    tilt: 1,
    captions: chapter("09 · Plugins & Media", "Mark what drags on the frame — your agent cuts it", ACCENTS.pink),
    shots: [
      { from: ["galleryOpened", 0.1], to: ["galleryOpened", 2.5], speed: 1.7 },
      { from: ["seeked", -0.15], to: "boxed", speed: 4.0, fadeInFrames: 8 },
      { from: "boxed", to: "markSent", speed: 4.4 },
      { from: "cut", to: "rendered", speed: 3.2 },
      { from: ["playing", -0.4], to: ["playing", 2.2], speed: 1.4 },
    ],
    camera: [
      { at: ["galleryOpened", 0.1], look: "gallery", zoom: 1.28 },
      { at: ["seeked", -0.15], look: MEDIA_EDITOR, zoom: 1.34 },
      { at: ["cut", 0.0], look: "canvas", zoom: 1.22 },
    ],
    slam: true,
    narration: [{ line: "media", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(16),
  },
  {
    kind: "picture",
    id: "p2p",
    accent: ACCENTS.violet,
    tilt: -1,
    captions: chapter("10 · Peer-to-Peer", "Zero-setup encrypted link between computers", ACCENTS.violet),
    slam: true,
    narration: [{ line: "p2p", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(14),
  },
  {
    kind: "end",
    id: "end",
    accent: BRAND.violet,
    seconds: beats(16),
    narration: [
      { line: "mirador", at: 0.15, musicDipsTo: 0.8 },
      { line: "end", at: 1.05 },
      { line: "openSource", at: 3.0 },
    ],
    fadeInFrames: 0,
  },
];

/** Where the end card sends people. */
export const WEBSITE = "mirador.sodre90.com";
export const WHERE_TO_GET_IT = "github.com/sodre90/mirador";

/** The music bed; bun run music writes this one. */
export const MUSIC = "music/score.wav";
