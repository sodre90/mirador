import type { Scene } from "./timeline.ts";

/** The score's beat, at 96 beats a minute: the scene changes after the review fall on it. */
export const BEAT = 60 / 96;

/** The canvas and the chat from the app's top edge, where the canvas's buttons are, down past the edit to allow. */
const CANVAS_AND_CHAT = { x: 256, y: 0, width: 1280, height: 720 };
/** The top of the canvas, from its Changes button down past the list of changed files. */
const TOP_OF_CANVAS = { x: 836, y: 0, width: 700, height: 394 };

/** The review's flow: the steps along the top, and the code of the step under them. */
const FLOW = { x: 256, y: 80, width: 1280, height: 720 };
/** The top of the canvas, where the point-and-ask button and the diagram are. */
const TOP_OF_DIAGRAM = { x: 836, y: 0, width: 700, height: 540 };
/** The bottom of the diagram, its risks, and the box to ask about what was pointed at. */
const RISKS_AND_QUESTION = { x: 836, y: 300, width: 700, height: 564 };
/** The plugin's install question and its answers, at the top of the canvas. */
const INSTALL_QUESTION = { x: 836, y: 0, width: 700, height: 520 };
/** Media's frame, its timeline and the note under it. */
const MEDIA_EDITOR = { x: 836, y: 80, width: 700, height: 640 };
/** The workspace with the delegated conversation under its caller, and the task working above the composer. */
const DELEGATED_TASK = { x: 0, y: 290, width: 830, height: 467 };

/**
 * A page the agent shows shows its diagram's source for a few frames before Mermaid draws it: a shot ends just before a
 * drawing starts, and the next starts once it's drawn, fading in over the frame before so the page doesn't jump.
 */
const BEFORE_DRAWING = -0.2;
const ONCE_DRAWN = -0.05;
const OVER_THE_FRAME_BEFORE = 15;

/** When the narrator starts the statement, in seconds of the wall scene; its parts land as they're said. */
const STATEMENT_AT = 8;

/**
 * The trailer, scene by scene. A clip scene plays stretches of a filmed clip (capture/trailer.spec.ts films them) and
 * moves the camera to boxes the capture measured, at moments it named; a scene lasts at least as long as its lines of
 * narration (narration/lines.ts). To show a new feature: film it as a clip, add its line, add a scene here.
 */
export const STORYBOARD: Scene[] = [
  {
    kind: "text-wall",
    id: "wall",
    seconds: 13.8,
    narration: [
      { line: "wall", at: 0.3 },
      { line: "wallOfText", at: 6.4 },
      { line: "statement", at: STATEMENT_AT, musicDipsTo: 0.75 },
    ],
    goesBlackAt: 7.6,
    statement: {
      at: STATEMENT_AT,
      parts: [
        { words: "But", after: 0.02 },
        { words: "humans", after: 0.16, stressed: true },
        { words: "see faster", after: 0.7 },
        { words: "than they read.", after: 1.18 },
      ],
    },
    pictureAt: 10.2,
  },
  { kind: "logo", id: "logo", seconds: 3.8, narration: [{ line: "canvas", at: 0.8 }], fadeInFrames: 0 },
  {
    kind: "clip",
    id: "show",
    clip: "show",
    shots: [
      { from: ["typing", -0.5], to: "sent", speed: 2 },
      { from: "sent", to: ["canvasShown", BEFORE_DRAWING], speed: 1.25 },
      { from: ["canvasShown", ONCE_DRAWN], to: ["turnEnded", 1.5], speed: 1.25, fadeInFrames: OVER_THE_FRAME_BEFORE },
    ],
    camera: [
      { at: ["typing", -0.5], look: "composer", zoom: 1.6 },
      { at: ["sent", 0.2], look: "timeline", zoom: 1.4 },
      { at: ["canvasShown", -0.3], look: "canvas", zoom: 1.3 },
      { at: ["turnEnded", -0.2], look: "app" },
    ],
    captions: [{ kicker: "Show", title: "Your agent draws what it means.", at: 6.8, seconds: 3.6 }],
    narration: [{ line: "show", at: 1.2 }],
  },
  {
    kind: "clip",
    id: "point",
    clip: "point",
    shots: [
      { from: 1, to: ["picked", 0.3], speed: 1.6 },
      { from: ["picked", 0.3], to: "typed", speed: 1.8 },
      { from: "typed", to: ["asked", 0.3], speed: 1.3 },
      { from: ["asked", 0.3], to: ["redrawn", BEFORE_DRAWING], speed: 1.5 },
      { from: ["redrawn", ONCE_DRAWN], to: ["redrawn", 1.5], fadeInFrames: OVER_THE_FRAME_BEFORE },
    ],
    camera: [
      { at: 1, look: TOP_OF_DIAGRAM, zoom: 1.6 },
      { at: ["picked", -0.6], look: RISKS_AND_QUESTION, zoom: 1.6 },
      { at: ["asked", 0.4], look: "canvas", zoom: 1.3 },
    ],
    captions: [{ kicker: "Point and ask", title: "Ask about what it drew.", at: 0.4, seconds: 3.4 }],
    narration: [{ line: "point", at: 0.4 }],
  },
  {
    kind: "clip",
    id: "overview",
    clip: "overview",
    shots: [
      { from: 3.5, to: ["needsYou", -0.3], speed: 1.3 },
      { from: ["needsYou", -0.3], to: ["runbookDone", 1.6] },
    ],
    camera: [
      { at: 3.5, look: "app" },
      { at: 4.2, look: { x: 0, y: 330, width: 256, height: 420 }, zoom: 1.55 },
    ],
    captions: [{ kicker: "Every project", title: "See who needs you.", at: 3.6, seconds: 3.4, side: "right" }],
    narration: [{ line: "overview", at: 0.3 }],
  },
  {
    kind: "clip",
    id: "ask",
    clip: "ask",
    shots: [
      { from: ["opened", -0.9], to: ["picked", 0.3] },
      { from: ["picked", 0.3], to: ["submitted", 0.3], speed: 1.3 },
      { from: ["submitted", 0.3], to: ["turnEnded", 1.4] },
    ],
    camera: [
      { at: ["opened", -0.9], look: { x: 0, y: 330, width: 256, height: 420 }, zoom: 1.55 },
      { at: ["opened", 0.1], look: "app" },
      { at: ["submitted", 0.4], look: "timeline", zoom: 1.35 },
    ],
    captions: [{ kicker: "Ask", title: "Decisions come with pictures.", at: 1.8, seconds: 3.6 }],
    narration: [{ line: "ask", at: 0.6 }],
  },
  {
    kind: "clip",
    id: "review",
    clip: "review",
    shots: [
      { from: ["typing", -0.4], to: "sent", speed: 1.8 },
      { from: "sent", to: ["reviewShown", -0.2], speed: 1.5 },
      { from: ["reviewShown", -0.2], to: "flow", speed: 1.5 },
      { from: "flow", to: ["flowStep3", -0.2], speed: 2.4 },
      { from: ["findings", -0.1], to: "askOpened", speed: 1.2 },
      { from: "askOpened", to: "questionTyped", speed: 2.4 },
      { from: "questionTyped", to: ["asked", 0.5], speed: 1.6 },
      { from: ["asked", 0.5], to: "chatShown", speed: 1.3 },
      { from: "chatShown", to: ["answered", 1.6] },
      { from: ["answered", 1.6], to: ["dropped", -0.9], speed: 2.4 },
      { from: ["dropped", -0.9], to: ["postClicked", -0.3], speed: 3 },
      { from: ["postClicked", -0.3], to: ["posted", 0.9], speed: 1.2 },
    ],
    camera: [
      { at: ["typing", -0.4], look: "composer", zoom: 1.6 },
      { at: ["reviewShown", -0.3], look: "canvas", zoom: 1.12 },
      { at: ["flowStep", 0.2], look: FLOW, zoom: 1.2 },
      { at: ["findings", 0.2], look: "blocker", zoom: 1.2 },
      { at: ["askOpened", 0.1], look: "askDialog", zoom: 1.22 },
      { at: ["chatShown", 0.1], look: "app" },
      { at: "answered", look: { x: 852, y: 99, width: 668, height: 130 }, zoom: 2.2 },
      { at: ["answered", 1.8], look: { x: 836, y: 393, width: 700, height: 394 }, zoom: 2.19 },
    ],
    captions: [{ kicker: "Review", title: "A guided tour of the change.", at: 4.2, seconds: 3.4 }],
    narration: [
      { line: "review", at: 3.4 },
      { line: "reviewAsk", at: 10.6 },
      { line: "reviewPost", at: 14.8 },
    ],
  },
  {
    kind: "clip",
    id: "edit",
    clip: "edit",
    shots: [
      { from: "approval", to: ["allowed", 0.6] },
      { from: ["allowed", 0.6], to: ["turnListed", 0.3], speed: 1.4 },
      { from: ["turnListed", 0.3], to: "uncommitted", speed: 1.4 },
      { from: "uncommitted", to: ["uncommittedListed", 2.5] },
    ],
    camera: [
      { at: "approval", look: CANVAS_AND_CHAT, zoom: 1.2 },
      { at: ["allowed", 0.5], look: TOP_OF_CANVAS, zoom: 2.19 },
    ],
    captions: [
      { kicker: "Approve", title: "Every edit, with its diff.", at: 0.3, seconds: 3 },
      { kicker: "Changes", title: "Even changes outside the project.", at: 4.1, seconds: 4.5 },
    ],
    narration: [
      { line: "edit", at: 0.5, musicDipsTo: 0.6 },
      { line: "changes", at: 4, musicDipsTo: 0.6 },
    ],
    seconds: 16 * BEAT,
  },
  {
    kind: "clip",
    id: "terminals",
    clip: "terminals",
    shots: [
      { from: ["shown", -0.3], to: ["logged", 0.3], speed: 2.6 },
      { from: ["logged", 0.3], to: ["diffed", 0.1], speed: 2.9 },
      { from: ["diffed", 0.1], to: ["diffed", 1.75] },
    ],
    camera: [
      { at: ["shown", -0.3], look: "app" },
      { at: ["shown", 0.4], look: "terminals" },
    ],
    captions: [{ kicker: "Terminals", title: "A shell beside every conversation.", at: 0.3, seconds: 2.8 }],
    narration: [{ line: "terminals", at: 0.3, musicDipsTo: 0.6 }],
    seconds: 8 * BEAT,
  },
  {
    kind: "clip",
    id: "groups",
    clip: "groups",
    shots: [{ from: 0.5, to: ["movedInView", 0.9], speed: 1.5 }],
    camera: [
      { at: 0.5, look: { x: 0, y: 0, width: 300, height: 520 }, zoom: 1.6 },
      { at: ["grouped", 0.2], look: "app" },
    ],
    captions: [{ kicker: "Groups", title: "Your projects, in your order.", at: 0.4, seconds: 3, side: "right" }],
    seconds: 8 * BEAT,
  },
  {
    kind: "clip",
    id: "plugins",
    clip: "plugins",
    shots: [
      { from: ["typing", -0.3], to: "sent", speed: 2.6 },
      { from: "sent", to: ["asked", -0.2], speed: 2.5 },
      { from: ["asked", -0.2], to: ["picked", 0.3], speed: 1.6 },
      { from: ["picked", 0.3], to: ["submitted", 0.6], speed: 1.6 },
    ],
    camera: [
      { at: ["typing", -0.3], look: "composer", zoom: 1.6 },
      { at: ["sent", 0.2], look: "timeline", zoom: 1.4 },
      { at: ["asked", -0.3], look: INSTALL_QUESTION, zoom: 1.65 },
    ],
    captions: [{ kicker: "Plugins", title: "Official plugins, installed when you say so.", at: 3, seconds: 3.6 }],
    narration: [{ line: "plugins", at: 0.4 }],
  },
  {
    kind: "clip",
    id: "media",
    clip: "media",
    shots: [
      { from: ["opened", -0.8], to: "seeked", speed: 2.2 },
      { from: "seeked", to: "ranged", speed: 2 },
      { from: "ranged", to: "boxed", speed: 2 },
      { from: "boxed", to: "markSent", speed: 3 },
      { from: "markSent", to: "cut", speed: 1.8 },
      { from: "cut", to: "rendered", speed: 4 },
      { from: "rendered", to: ["playing", 2.2], speed: 2.5 },
    ],
    camera: [
      { at: ["opened", -0.8], look: "canvas", zoom: 1.3 },
      { at: ["seeked", -0.3], look: MEDIA_EDITOR, zoom: 1.4 },
      { at: ["markSent", 0.2], look: "app" },
      { at: ["rendered", -0.3], look: "canvas", zoom: 1.3 },
    ],
    captions: [{ kicker: "Media", title: "Mark it on the frame. The agent edits.", at: 3.6, seconds: 3.4 }],
    narration: [{ line: "media", at: 0.5 }],
  },
  {
    kind: "clip",
    id: "delegate",
    clip: "delegate",
    shots: [
      { from: ["typing", -0.3], to: "sent", speed: 2 },
      { from: "sent", to: ["delegated", 0.4], speed: 1.6 },
      { from: ["delegated", 0.4], to: ["unfolded", 0.6], speed: 1.2 },
      { from: ["unfolded", 0.6], to: ["replied", -0.3], speed: 2 },
      { from: ["replied", -0.3], to: ["checked", 1.6], speed: 1.5 },
    ],
    camera: [
      { at: ["typing", -0.3], look: "composer", zoom: 1.6 },
      { at: ["sent", 0.2], look: "timeline", zoom: 1.4 },
      { at: ["delegated", 0.1], look: DELEGATED_TASK, zoom: 1.85 },
      { at: ["replied", 0.1], look: "timeline", zoom: 1.4 },
    ],
    captions: [{ kicker: "Your agents, together", title: "Claude Code hands the reading to opencode.", at: 0.3, seconds: 3.4, side: "right" }],
    narration: [
      { line: "agents", at: 0.4 },
      { line: "delegate", at: 6.2 },
    ],
  },
  {
    kind: "clip",
    id: "jobs",
    clip: "jobs",
    shots: [
      { from: ["typing", -0.3], to: "sent", speed: 2.6 },
      { from: "sent", to: ["waiting", 0.3], speed: 2 },
      { from: ["waiting", 0.3], to: ["following", 0.5], speed: 1.5 },
      { from: ["following", 0.5], to: ["passed", 0.6], speed: 4 },
      { from: ["passed", 0.6], to: ["woken", -0.2], speed: 6 },
      { from: ["woken", -0.2], to: ["reported", 1.4], speed: 1.5 },
    ],
    camera: [
      { at: ["typing", -0.3], look: "composer", zoom: 1.6 },
      { at: ["sent", 0.2], look: "timeline", zoom: 1.4 },
      { at: ["waiting", 0.1], look: "jobWait", zoom: 1.6 },
      { at: ["following", -0.2], look: "terminals" },
      { at: ["woken", -0.3], look: "timeline", zoom: 1.4 },
    ],
    captions: [{ kicker: "Jobs", title: "Mirador waits, so your agent doesn't.", at: 3, seconds: 2.6 }],
    narration: [{ line: "jobs", at: 0.4 }],
  },
  {
    kind: "clip",
    id: "voice",
    clip: "voice",
    shots: [
      { from: ["listening", -0.6], to: ["listening", 3.3] },
      { from: ["listening", 3.3], to: "sent", speed: 3 },
      { from: "sent", to: "reading", speed: 3 },
      { from: "reading", to: ["listeningAgain", 0.6] },
    ],
    camera: [
      { at: ["listening", -0.6], look: "composer", zoom: 1.6 },
      { at: ["sent", -0.2], look: "timeline", zoom: 1.4 },
      { at: ["listeningAgain", -0.3], look: "composer", zoom: 1.6 },
    ],
    captions: [{ kicker: "Voice", title: "It reads you the gist, then listens again.", at: 4.6, seconds: 4 }],
    narration: [
      { line: "voice", at: 0 },
      { line: "voiceAsk", at: 0.15, from: "listening" },
      { line: "voiceReply", at: 0.05, from: "reading" },
    ],
  },
  { kind: "backdrop", id: "backdrop", seconds: BEAT },
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
