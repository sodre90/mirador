import { expect, test } from "bun:test";
import { CAPTURE_ONLY_LINES, LINES, type LineName } from "../narration/lines.ts";
import { STORYBOARD } from "../src/storyboard.ts";

test("the storyboard speaks every line of the narration but the capture's own, once", () => {
  const spoken = STORYBOARD.flatMap((scene) => scene.narration ?? []).map(({ line }) => line);
  const narrated = (Object.keys(LINES) as LineName[]).filter((line) => !CAPTURE_ONLY_LINES.includes(line));
  expect(spoken.toSorted()).toEqual(narrated.toSorted());
});

test("a shot fades in only over a shot before it", () => {
  const firstShots = STORYBOARD.flatMap((scene) => (scene.kind === "clip" ? [scene.shots[0]!] : []));
  expect(firstShots.filter((shot) => shot.fadeInFrames)).toEqual([]);
});
