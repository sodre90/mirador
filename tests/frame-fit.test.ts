import { describe, expect, test } from "bun:test";
import { filledStyles, fittedStyles, FRAME_BORDERS } from "../web/frame-fit.ts";

describe("fittedStyles", () => {
  test("at its own size, a page that fits is as tall as its content, and a wider one is scaled down to fit", () => {
    expect(fittedStyles({ height: 300, width: null }, 600)).toEqual({ frame: { height: 300 } });
    expect(fittedStyles({ height: 300, width: 400 }, 600)).toEqual({ frame: { height: 300 } });
    const wide = fittedStyles({ height: 300, width: 1198 }, 600);
    expect(wide.frame).toMatchObject({ width: 1198, height: 300, transform: "scale(0.5)" });
    expect(wide.box).toEqual({ height: 151 });
  });

  test("zoomed, a page that fits lays out in the room divided by the zoom and is scaled up to fill it", () => {
    const zoomed = fittedStyles({ height: 300, width: null }, 702, 1.4);
    expect(zoomed.frame).toMatchObject({ position: "absolute", width: 702 / 1.4 - FRAME_BORDERS, height: 300, transform: "scale(1.4)" });
    expect(zoomed.box).toEqual({ height: Math.ceil(302 * 1.4) });
  });

  test("zoomed, a page too wide for the zoom is scaled to the room once, not by the zoom on top", () => {
    const preview = fittedStyles({ height: 200, width: 900 }, 1100, 1.4);
    const scale = 1100 / (900 + FRAME_BORDERS);
    expect(preview.frame).toMatchObject({ width: 900, transform: `scale(${scale})` });
    expect(preview.box).toEqual({ height: Math.ceil(202 * scale) });
  });

  test("a smaller text size shrinks a page that fits", () => {
    expect(fittedStyles({ height: 100, width: null }, 500, 0.5).frame).toMatchObject({ width: 1000 - FRAME_BORDERS, transform: "scale(0.5)" });
  });

  test("nothing is sized before the page reports its size, and only the height before the room is known", () => {
    expect(fittedStyles(undefined, 600, 1.4)).toEqual({});
    expect(fittedStyles({ height: 300, width: null }, 0, 1.4)).toEqual({ frame: { height: 300 } });
  });
});

describe("filledStyles", () => {
  test("a frame that fills its box is left alone at its own size", () => {
    expect(filledStyles(1)).toEqual({});
  });

  test("zoomed, it lays out in the box divided by the zoom and is scaled up to fill the box", () => {
    expect(filledStyles(2)).toEqual({
      box: { position: "relative", overflow: "hidden" },
      frame: { position: "absolute", top: 0, left: 0, width: "50%", height: "50%", transform: "scale(2)", transformOrigin: "0 0" },
    });
  });
});
