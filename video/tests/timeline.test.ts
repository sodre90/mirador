import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STORYBOARD, TEMPO } from "../src/storyboard.ts";
import { type ClipInfo, type ClipScene, type Scene, clipSeconds, linesOf, placeScenes, sceneSeconds, sceneSecondsOf, shotsOf, shotTrim } from "../src/timeline.ts";

const clip: ClipInfo = { name: "demo", seconds: 20, moments: { sent: 4, shown: 10 }, rects: {} };

const scene: ClipScene = {
  kind: "clip",
  id: "demo",
  clip: "demo",
  shots: [
    { from: 2, to: "sent", speed: 2 },
    { from: ["shown", -1], to: "shown" },
  ],
  camera: [],
};

describe("a point in a clip", () => {
  test("is a moment, shifted by its offset", () => {
    expect(clipSeconds(clip, 3)).toBe(3);
    expect(clipSeconds(clip, "sent")).toBe(4);
    expect(clipSeconds(clip, ["shown", -1.5])).toBe(8.5);
  });

  test("stays inside the clip", () => {
    expect(clipSeconds(clip, ["sent", -9])).toBe(0);
    expect(clipSeconds(clip, ["shown", 30])).toBe(20);
  });

  test("names the moments the clip has when it asks for another", () => {
    expect(() => clipSeconds(clip, "typed")).toThrow('demo has no moment "typed"; it has sent, shown');
  });
});

describe("a scene's shots", () => {
  test("play one after another, a faster shot in less time", () => {
    expect(shotsOf(scene, clip)).toEqual([
      { clipFrom: 2, clipTo: 4, speed: 2, sceneFrom: 0, sceneTo: 1 },
      { clipFrom: 9, clipTo: 10, speed: 1, sceneFrom: 1, sceneTo: 2 },
    ]);
  });

  test("can't end before they start", () => {
    expect(() => shotsOf({ ...scene, shots: [{ from: "shown", to: "sent" }] }, clip)).toThrow("demo: a shot ends (4s) before it starts (10s)");
  });

  test("can't run past the end of their clip, which would show no footage", () => {
    expect(() => shotsOf({ ...scene, shots: [{ from: "shown", to: 21 }] }, clip)).toThrow("demo: a shot ends (21s) after its clip does (20s)");
  });

  test("place a moment of the clip in the scene, and one that was cut where the next shot starts", () => {
    expect(sceneSecondsOf(scene, clip, ["sent", -1])).toBe(0.5);
    expect(sceneSecondsOf(scene, clip, 6)).toBe(1);
  });
});

describe("a scene's length", () => {
  const narration = { intro: { text: "Hello.", file: "intro.wav", seconds: 3 } };

  test("is its footage's, held until its narration ends", () => {
    expect(sceneSeconds(scene, { demo: clip }, {})).toBe(2);
    expect(sceneSeconds({ ...scene, narration: [{ line: "intro", at: 1.5 }] }, { demo: clip }, narration)).toBeCloseTo(5.1);
  });

  test("can be set shorter than the footage, but still waits for its narration", () => {
    expect(sceneSeconds({ ...scene, seconds: 1.5 }, { demo: clip }, {})).toBe(1.5);
    expect(sceneSeconds({ ...scene, seconds: 1.5, narration: [{ line: "intro", at: 1 }] }, { demo: clip }, narration)).toBeCloseTo(4.6);
  });

  test("waits for a line timed from a point of the clip, wherever the shots put that point", () => {
    const fromShown = { ...scene, narration: [{ line: "intro", at: 0.2, from: "shown" }] };
    expect(linesOf(fromShown, { demo: clip })).toEqual([{ line: "intro", at: 2.2, musicDipsTo: undefined }]);
    expect(sceneSeconds(fromShown, { demo: clip }, narration)).toBeCloseTo(5.8);
  });

  test("asks for the narration to be made when a line is missing", () => {
    expect(() => sceneSeconds({ ...scene, narration: [{ line: "outro", at: 0 }] }, { demo: clip }, narration)).toThrow('No narration line "outro"; run bun run narrate');
  });
});

test("scenes overlap by the transition, and the last one ends the trailer", () => {
  const cards: Scene[] = [
    { kind: "logo", id: "a", seconds: 1 },
    { kind: "logo", id: "b", seconds: 2 },
    { kind: "end", id: "c", seconds: 1 },
  ];
  const placed = placeScenes(cards, {}, {}, 10, 3).map(({ scene, from, frames }) => ({ id: scene.id, from, frames }));
  expect(placed).toEqual([
    { id: "a", from: 0, frames: 13 },
    { id: "b", from: 10, frames: 23 },
    { id: "c", from: 30, frames: 10 },
  ]);
});

test("a scene that cuts straight in doesn't overlap the one before it", () => {
  const cards: Scene[] = [
    { kind: "logo", id: "a", seconds: 1 },
    { kind: "logo", id: "b", seconds: 2, fadeInFrames: 0 },
    { kind: "end", id: "c", seconds: 1 },
  ];
  expect(placeScenes(cards, {}, {}, 10, 3).map(({ scene, from, frames, fadeInFrames }) => ({ id: scene.id, from, frames, fadeInFrames }))).toEqual([
    { id: "a", from: 0, frames: 10, fadeInFrames: 0 },
    { id: "b", from: 10, frames: 23, fadeInFrames: 0 },
    { id: "c", from: 30, frames: 10, fadeInFrames: 3 },
  ]);
});

test("a shot's trim covers its last frame however its times round", () => {
  const scene: ClipScene = { kind: "clip", id: "s", clip: "demo", shots: [{ from: 0, to: 1.008 }, { from: 5, to: 9.991 }], camera: [] };
  for (const shot of shotsOf(scene, clip)) {
    const frames = Math.round(shot.sceneTo * 60) - Math.round(shot.sceneFrom * 60);
    const { trimBefore, trimAfter } = shotTrim(shot, clip, 60);
    expect(Math.ceil((frames - 1) * shot.speed)).toBeLessThan(trimAfter - trimBefore);
  }
});

const video = join(import.meta.dirname, "..");
const filmed = existsSync(join(video, "public", "clips"));

describe.skipIf(!filmed)("the storyboard, with the clips filmed", () => {
  const clipNames = [...new Set(STORYBOARD.flatMap((scene) => (scene.kind === "clip" ? [scene.clip] : [])))];
  const clips = filmed ? Object.fromEntries(clipNames.map((name) => [name, JSON.parse(readFileSync(join(video, "public", "clips", `${name}.json`), "utf8")) as ClipInfo])) : {};
  const { lines } = JSON.parse(readFileSync(join(video, "public", "narration", "manifest.json"), "utf8"));
  const wholeBeats = (seconds: number) => (seconds * TEMPO) / 60;
  const isWhole = (count: number) => Math.abs(count - Math.round(count)) < 1e-6;

  test("opens with cuts that last whole bars of the score, so its hits stay on the cuts", () => {
    const coldOpen = STORYBOARD.slice(0, STORYBOARD.findIndex(({ id }) => id === "hook"));
    expect(coldOpen.length).toBeGreaterThan(0);
    expect(isWhole(wholeBeats(coldOpen.reduce((seconds, scene) => seconds + sceneSeconds(scene, clips, lines), 0)) / 4)).toBe(true);
  });

  test("gives every slammed scene whole beats, with room for its narration", () => {
    const slammed = STORYBOARD.filter((scene): scene is ClipScene => scene.kind === "clip" && Boolean(scene.slam));
    for (const scene of slammed) {
      expect({ id: scene.id, seconds: sceneSeconds(scene, clips, lines) }).toEqual({ id: scene.id, seconds: scene.seconds! });
      expect({ id: scene.id, whole: isWhole(wholeBeats(scene.seconds!)) }).toEqual({ id: scene.id, whole: true });
    }
  });

  test("gives each of the score's sections whole bars, so none bends its tempo", () => {
    const sectionStarts = ["show", "review", "edit", "plugins", "voice", "backdrop"];
    const placed = placeScenes(STORYBOARD, clips, lines, 60, 18);
    const startOf = (id: string) => placed.find(({ scene }) => scene.id === id)!.from / 60;
    for (const [from, to] of sectionStarts.slice(0, -1).map((id, index) => [id, sectionStarts[index + 1]!])) {
      expect({ from, bars: isWhole(wholeBeats(startOf(to!) - startOf(from!)) / 4) }).toEqual({ from, bars: true });
    }
  });

  test("cuts straight into a slammed scene", () => {
    const placed = placeScenes(STORYBOARD, clips, lines, 60, 18);
    for (const { scene, fadeInFrames } of placed.filter(({ scene }) => scene.kind === "clip" && scene.slam)) expect({ id: scene.id, fadeInFrames }).toEqual({ id: scene.id, fadeInFrames: 0 });
  });
});
