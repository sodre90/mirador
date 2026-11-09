import type { CameraKey, Caption, ClipScene, Scene } from "./timeline.ts";

/** The score's tempo. Every slammed scene lasts whole beats of it, and each of the score's sections whole bars, so every cut lands on a hit. */
export const TEMPO = 144;
/** Whole beats of the score, in seconds: at 60 fps one beat is 25 frames. */
export const beats = (count: number) => (count * 60) / TEMPO;


/** The review's flow: the steps along the top, and the code of the step under them. */
const FLOW = { x: 256, y: 80, width: 1280, height: 720 };
/** The plugin's install question and its answers, at the top of the canvas. */
const INSTALL_QUESTION = { x: 836, y: 0, width: 700, height: 560 };
/** Media's frame, its timeline and the note under it. */
const MEDIA_EDITOR = { x: 836, y: 80, width: 700, height: 640 };
/** The workspace with the delegated conversation under its caller, and the task working above the composer. */
const DELEGATED_TASK = { x: 0, y: 290, width: 830, height: 467 };

/** A page the agent shows shows its diagram's source for a few frames before Mermaid draws it: the show scene starts once it's drawn. */
const ONCE_DRAWN = -0.05;

const COLD_CUT = beats(2);
const NARRATION_AT = 0.3;
/** The music dips less under the feature lines than under the hook, to keep their drive. */
const FEATURE_DIP = 0.65;

/** The feature a scene shows, named in its corner for the whole scene. */
const featureTag = (kicker: string, title: string): Caption[] => [{ kicker, title, at: 0.25 }];

/** A cut of the cold open: a moment of a clip, framed close, cut in on a hit. */
function coldCut(id: string, clip: string, from: [string, number], look: CameraKey["look"], zoom: number | undefined): ClipScene {
  return { kind: "clip", id, clip, shots: [{ from, to: [from[0], from[1] + COLD_CUT + 0.1] }], camera: [{ at: from, look, zoom }], seconds: COLD_CUT, slam: true };
}

/** The opening seconds, where viewers left the last cut: the best moments, a beat-synced burst of them. */
const COLD_OPEN: Scene[] = [
  coldCut("coldShow", "show", ["canvasShown", 1], "canvas", 1.1),
  coldCut("coldAsk", "ask", ["questionShown", 0.6], "options", 1.1),
  coldCut("coldReview", "review", ["flowStep", 0.6], FLOW, 1.05),
  coldCut("coldMedia", "media", ["boxed", -0.4], MEDIA_EDITOR, 1.15),
  coldCut("coldDelegate", "delegate", ["delegated", 0.8], DELEGATED_TASK, 1.15),
  coldCut("coldJobs", "jobs", ["following", 3], "terminals", undefined),
];

/**
 * The trailer, scene by scene. A clip scene plays stretches of a filmed clip (capture/trailer.spec.ts films them) and
 * moves the camera to boxes the capture measured, at moments it named; a scene lasts at least as long as its lines of
 * narration (narration/lines.ts). To show a new feature: film it as a clip, add its line, add a scene here.
 */
export const STORYBOARD: Scene[] = [
  ...COLD_OPEN,
  { kind: "picture", id: "hook", seconds: 5, narration: [{ line: "hook", at: 0.3 }], fadeInFrames: 0 },
  {
    kind: "clip",
    id: "show",
    clip: "show",
    captions: featureTag("Canvas", "Diagrams beside your chat"),
    shots: [{ from: ["canvasShown", ONCE_DRAWN], to: ["turnEnded", 1.5], speed: 1.15 }],
    camera: [
      { at: ["canvasShown", ONCE_DRAWN], look: "canvas", zoom: 1.3 },
      { at: ["canvasShown", 1.4], look: "app" },
    ],
    slam: true,
    narration: [{ line: "show", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(10),
  },
  {
    kind: "clip",
    id: "ask",
    clip: "ask",
    captions: featureTag("Ask", "Pick from pictures"),
    shots: [
      { from: ["opened", -0.2], to: ["picked", 0.3], speed: 2 },
      { from: ["picked", 0.3], to: ["submitted", 0.6], speed: 1.8 },
    ],
    camera: [
      { at: ["opened", -0.2], look: "question", zoom: 1.12 },
      { at: ["submitted", 0.3], look: "timeline", zoom: 1.35 },
    ],
    slam: true,
    narration: [{ line: "ask", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(10),
  },
  {
    kind: "clip",
    id: "review",
    clip: "review",
    captions: featureTag("Review", "A guided tour of the change"),
    shots: [
      { from: ["reviewShown", -0.2], to: "flow", speed: 1.8 },
      { from: "flow", to: ["flowStep3", -0.2], speed: 2.4 },
      { from: ["findings", -0.1], to: ["askOpened", 0.8], speed: 1.2 },
    ],
    camera: [
      { at: ["reviewShown", -0.2], look: "canvas", zoom: 1.12 },
      { at: ["flowStep", 0.2], look: FLOW, zoom: 1.2 },
      { at: ["findings", 0.2], look: "blocker", zoom: 1.2 },
    ],
    slam: true,
    narration: [{ line: "review", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(16),
  },
  {
    kind: "clip",
    id: "plugins",
    clip: "plugins",
    captions: featureTag("Plugins", "Installed when you say so"),
    shots: [
      { from: "sent", to: ["asked", -0.2], speed: 3 },
      { from: ["asked", -0.2], to: ["picked", 0.3], speed: 1.8 },
      { from: ["picked", 0.3], to: ["submitted", 0.6], speed: 1.8 },
    ],
    camera: [
      { at: "sent", look: "timeline", zoom: 1.4 },
      { at: ["asked", -0.3], look: INSTALL_QUESTION, zoom: 1.3 },
    ],
    slam: true,
    narration: [{ line: "plugins", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(10),
  },
  {
    kind: "clip",
    id: "media",
    clip: "media",
    captions: featureTag("Media", "Mark the frame, it cuts the video"),
    shots: [
      { from: ["seeked", -0.3], to: "boxed", speed: 3 },
      { from: "boxed", to: "markSent", speed: 4 },
      { from: "cut", to: "rendered", speed: 4 },
      { from: "rendered", to: ["playing", 1], speed: 5 },
    ],
    camera: [
      { at: ["seeked", -0.3], look: MEDIA_EDITOR, zoom: 1.4 },
      { at: ["cut", 0], look: "canvas", zoom: 1.3 },
    ],
    slam: true,
    narration: [{ line: "media", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(11),
  },
  {
    kind: "clip",
    id: "delegate",
    clip: "delegate",
    captions: featureTag("Delegate", "Hand work to any other agent"),
    shots: [
      { from: "sent", to: ["delegated", 0.4], speed: 2.5 },
      { from: ["delegated", 0.4], to: ["unfolded", 0.6], speed: 1.4 },
      { from: ["unfolded", 0.6], to: ["replied", -0.3], speed: 3 },
      { from: ["replied", -0.3], to: ["checked", 1.6], speed: 1.3 },
    ],
    camera: [
      { at: "sent", look: "timeline", zoom: 1.4 },
      { at: ["delegated", 0.1], look: DELEGATED_TASK, zoom: 1.3 },
      { at: ["replied", 0.1], look: "timeline", zoom: 1.4 },
    ],
    slam: true,
    narration: [{ line: "delegate", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(19),
  },
  {
    kind: "clip",
    id: "jobs",
    clip: "jobs",
    captions: featureTag("Jobs", "Wakes your agent when it ends"),
    shots: [
      { from: "sent", to: ["waiting", 0.3], speed: 3.5 },
      { from: ["waiting", 0.3], to: ["following", 0.5], speed: 2.2 },
      { from: ["following", 0.5], to: ["passed", 0.6], speed: 10 },
      { from: ["passed", 0.6], to: ["woken", -0.2], speed: 8 },
      { from: ["woken", -0.2], to: ["reported", 1.4], speed: 1.2 },
    ],
    camera: [
      { at: "sent", look: "timeline", zoom: 1.4 },
      { at: ["waiting", 0.1], look: "jobWait", zoom: 1.6 },
      { at: ["following", -0.2], look: "terminals" },
      { at: ["woken", -0.3], look: "timeline", zoom: 1.4 },
    ],
    slam: true,
    narration: [{ line: "jobs", at: NARRATION_AT, musicDipsTo: FEATURE_DIP }],
    seconds: beats(16),
  },
  { kind: "backdrop", id: "backdrop", seconds: beats(2) },
  {
    kind: "end",
    id: "end",
    seconds: 8,
    narration: [
      { line: "mirador", at: 0.1, musicDipsTo: 0.8 },
      { line: "end", at: 1.05 },
      { line: "glance", at: 2.95 },
    ],
    fadeInFrames: 0,
  },
];

/** Where the end card sends people. The repository is private for now, so check this before publishing. */
export const WHERE_TO_GET_IT = "github.com/sodre90/mirador";

/** The official plugins' catalog, which the end card names under it. */
export const PLUGIN_CATALOG = "github.com/sodre90/mirador-plugins";

/** The music bed; bun run music writes this one. To use another track, put it in public/music and name it here. */
export const MUSIC = "music/score.wav";
