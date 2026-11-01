import { describe, expect, test } from "bun:test";
import { APP, viewAt } from "../src/camera.ts";
import type { CameraKey, ClipInfo, ClipScene } from "../src/timeline.ts";

const clip: ClipInfo = { name: "demo", seconds: 20, moments: { shown: 10 }, rects: { badge: { x: 1400, y: 0, width: 100, height: 100 }, title: { x: 600, y: 300, width: 200, height: 50 } } };

function sceneLooking(...camera: CameraKey[]): ClipScene {
  return { kind: "clip", id: "demo", clip: "demo", shots: [{ from: 0, to: "shown" }], camera };
}

function expectView(actual: ReturnType<typeof viewAt>, expected: ReturnType<typeof viewAt>) {
  expect(actual.centerX).toBeCloseTo(expected.centerX);
  expect(actual.centerY).toBeCloseTo(expected.centerY);
  expect(actual.width).toBeCloseTo(expected.width);
}

describe("the camera", () => {
  test("frames a box with room around it", () => {
    expectView(viewAt(sceneLooking({ at: 0, look: "title" }), clip, 0), { centerX: 700, centerY: 325, width: 200 * 1.12 });
  });

  test("zooms around a box but keeps the view inside the app", () => {
    expectView(viewAt(sceneLooking({ at: 0, look: "badge", zoom: 2 }), clip, 0), { centerX: APP.width - APP.width / 4, centerY: APP.height / 4, width: APP.width / 2 });
  });

  test("takes a box given in the storyboard", () => {
    expectView(viewAt(sceneLooking({ at: 0, look: { x: 0, y: 432, width: 768, height: 432 }, zoom: 2 }), clip, 0), { centerX: 384, centerY: 648, width: 768 });
  });

  test("moves to the next view from its moment on, and is there once the move ends", () => {
    const scene = sceneLooking({ at: 0, look: "badge", zoom: 2 }, { at: ["shown", -2], look: "app" });
    const zoomed = viewAt(scene, clip, 7.9);
    const moving = viewAt(scene, clip, 8.5);
    expect(zoomed.width).toBeCloseTo(APP.width / 2);
    expect(moving.width).toBeGreaterThan(APP.width / 2);
    expect(moving.width).toBeLessThan(APP.width);
    expectView(viewAt(scene, clip, 9.2), { centerX: APP.width / 2, centerY: APP.height / 2, width: APP.width });
  });

  test("names the boxes a clip has when asked for another", () => {
    expect(() => viewAt(sceneLooking({ at: 0, look: "composer" }), clip, 0)).toThrow('demo has no box "composer"; it has badge, title');
  });
});
