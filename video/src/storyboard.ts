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

const NARRATION_AT = 0.25;
/** The music dips gently under feature chapters to preserve rhythmic drive. */
const FEATURE_DIP = 0.58;

/** Top-floating chapter bar naming the chapter number, feature, and one-line takeaway without overlapping the UI. */
const chapter = (kicker: string, title: string, accent: string, position: "top" | "bottom" = "top"): Caption[] => [{ kicker, title, at: 0.18, position, accent }];

/**
 * The Mirador 0.15.5 flagship trailer, chapter by chapter (~87 s, 4K 60fps).
 * Every musical act spans whole 4-beat bars so the score never bends its tempo, and every clip's shots are paced so
 * the payoff lands right before the cut with continuous live motion throughout.
 */
export const STORYBOARD: Scene[] = [
  {
    kind: "picture",
    id: "hook",
    accent: BRAND.violet,
    seconds: beats(16),
    narration: [{ line: "hook", at: 0.25 }],
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
      { from: ["canvasShown", -0.05], to: ["pointing", 0.2], speed: 3.0 },
      { from: ["pointing", 0.2], to: ["asked", 0.1], speed: 2.9 },
      { from: ["asked", 0.1], to: ["turnEnded", 1.8], speed: 2.1 },
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
      { from: ["opened", -0.1], to: ["picked", 0.25], speed: 2.2 },
      { from: ["picked", 0.25], to: ["turnEnded", 1.2], speed: 1.7 },
    ],
    camera: [
      { at: ["opened", -0.1], look: "question", zoom: 1.14 },
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
      { from: ["reviewShown", -0.1], to: "flow", speed: 1.7 },
      { from: "flow", to: ["findings", -0.1], speed: 2.4 },
      { from: ["findings", -0.1], to: ["asked", 0.2], speed: 2.8 },
      { from: ["asked", 0.2], to: ["answered", 1.4], speed: 1.5 },
    ],
    camera: [
      { at: ["reviewShown", -0.1], look: "canvas", zoom: 1.08 },
      { at: ["flowStep", 0.1], look: FLOW, zoom: 1.18 },
      { at: ["findings", 0.1], look: "blocker", zoom: 1.24 },
      { at: ["rewritten", 0.0], look: "rewrittenBlocker", zoom: 1.22 },
    ],
    slam: true,
    narration: [{ line: "review", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(20),
  },
  {
    kind: "clip",
    id: "sideChat",
    clip: "sideChat",
    accent: ACCENTS.emerald,
    tilt: -1,
    captions: chapter("04 · Side Chat & Changes", "Ask /btw without interrupting · diff & commit inline", ACCENTS.emerald),
    shots: [
      { from: "typing", to: ["sideAnswered", 0.75], speed: 1.95 },
      { from: ["changesOpened", 0.5], to: ["diffOpened", 1.8], speed: 1.35, fadeInFrames: 6 },
    ],
    camera: [
      { at: "typing", look: "app" },
      { at: ["sideOpened", 0.2], look: "sideArea", zoom: 1.15 },
      { at: ["changesOpened", 0.5], look: "changes", zoom: 1.18 },
    ],
    slam: true,
    narration: [{ line: "sideChat", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(16),
  },
  {
    kind: "clip",
    id: "media",
    clip: "media",
    accent: ACCENTS.pink,
    tilt: 1,
    captions: chapter("05 · Plugins & Media", "Mark what drags on the frame — your agent cuts it", ACCENTS.pink),
    shots: [
      { from: ["galleryOpened", 0.1], to: ["galleryOpened", 3.1], speed: 1.4 },
      { from: ["seeked", -0.15], to: "boxed", speed: 3.2, fadeInFrames: 8 },
      { from: "boxed", to: "markSent", speed: 3.8 },
      { from: "cut", to: "rendered", speed: 3.8 },
      { from: "rendered", to: ["playing", 2.8], speed: 3.0 },
    ],
    camera: [
      { at: ["galleryOpened", 0.1], look: "gallery", zoom: 1.1 },
      { at: ["seeked", -0.15], look: MEDIA_EDITOR, zoom: 1.34 },
      { at: ["cut", 0.0], look: "canvas", zoom: 1.24 },
    ],
    slam: true,
    narration: [{ line: "media", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(18),
  },
  {
    kind: "clip",
    id: "delegate",
    clip: "delegate",
    accent: ACCENTS.amber,
    tilt: -1,
    captions: chapter("06 · Multi-Agent", "Claude Code delegates a sweep to local opencode", ACCENTS.amber),
    shots: [
      { from: ["typing", -0.1], to: ["delegated", 0.3], speed: 1.8 },
      { from: ["delegated", 0.3], to: ["unfolded", 0.4], speed: 1.2 },
      { from: ["unfolded", 0.4], to: ["replied", -0.1], speed: 1.9 },
      { from: ["replied", -0.1], to: ["checked", 1.6], speed: 1.15 },
    ],
    camera: [
      { at: ["typing", -0.1], look: "timeline", zoom: 1.24 },
      { at: ["delegated", 0.1], look: DELEGATED_TASK, zoom: 1.22 },
      { at: ["replied", 0.1], look: "app" },
    ],
    slam: true,
    narration: [{ line: "delegate", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(22),
  },
  {
    kind: "clip",
    id: "jobs",
    clip: "jobs",
    accent: ACCENTS.cyan,
    tilt: 1,
    captions: chapter("07 · Background Jobs", "Watches remote builds & wakes your agent when green", ACCENTS.cyan),
    shots: [
      { from: "sent", to: ["waiting", 0.3], speed: 3.3 },
      { from: ["waiting", 0.3], to: ["following", 0.4], speed: 2.3 },
      { from: ["following", 0.4], to: ["passed", 0.5], speed: 10 },
      { from: ["passed", 0.5], to: ["woken", -0.1], speed: 7 },
      { from: ["woken", -0.1], to: ["reported", 1.5], speed: 1.4 },
    ],
    camera: [
      { at: "sent", look: "timeline", zoom: 1.26 },
      { at: ["waiting", 0.1], look: "jobWait", zoom: 1.45 },
      { at: ["following", -0.1], look: "terminals", zoom: 1.12 },
      { at: ["woken", -0.2], look: "app" },
    ],
    slam: true,
    narration: [{ line: "jobs", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(14),
  },
  {
    kind: "clip",
    id: "p2p",
    clip: "p2p",
    accent: ACCENTS.violet,
    tilt: -1,
    captions: chapter("08 · New in 0.15.5", "Zero-setup peer-to-peer for phone & other computers", ACCENTS.violet),
    shots: [
      { from: 0.6, to: ["computerShown", 2.2], speed: 1.12 },
    ],
    camera: [
      { at: 0.6, look: "app" },
      { at: ["opened", 0.0], look: "devicesDialog", zoom: 1.1 },
      { at: ["phoneInvite", 0.1], look: { x: 420, y: 210, width: 760, height: 590 }, zoom: 1.25 },
      { at: ["computerShown", 0.0], look: { x: 420, y: 210, width: 760, height: 590 }, zoom: 1.25 },
    ],
    slam: true,
    narration: [{ line: "p2p", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(22),
  },
  { kind: "backdrop", id: "backdrop", accent: BRAND.violet, seconds: beats(2) },
  {
    kind: "end",
    id: "end",
    accent: BRAND.violet,
    seconds: beats(16),
    narration: [
      { line: "mirador", at: 0.15, musicDipsTo: 0.8 },
      { line: "end", at: 1.1 },
      { line: "openSource", at: 3.1 },
    ],
    fadeInFrames: 0,
  },
];

/** Where the end card sends people. */
export const WEBSITE = "mirador.sodre90.com";
export const WHERE_TO_GET_IT = "github.com/sodre90/mirador";

/** The music bed; bun run music writes this one. */
export const MUSIC = "music/score.wav";
