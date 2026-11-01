import { expect, test } from "bun:test";
import { LINES } from "../narration/lines.ts";
import { STORYBOARD } from "../src/storyboard.ts";

test("the storyboard speaks every line of the narration, once", () => {
  const spoken = STORYBOARD.flatMap((scene) => scene.narration ?? []).map(({ line }) => line);
  expect(spoken.toSorted()).toEqual(Object.keys(LINES).toSorted());
});

test("a shot fades in only over a shot before it", () => {
  const firstShots = STORYBOARD.flatMap((scene) => (scene.kind === "clip" ? [scene.shots[0]!] : []));
  expect(firstShots.filter((shot) => shot.fadeInFrames)).toEqual([]);
});
