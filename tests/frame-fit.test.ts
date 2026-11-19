import { describe, expect, test } from "bun:test";
import { fittedStyles } from "../web/frame-fit.ts";

describe("fittedStyles", () => {
  test("a page that fits is as tall as its content, and a wider one is scaled down to fit", () => {
    expect(fittedStyles({ height: 300, width: null }, 600)).toEqual({ frame: { height: 300 } });
    expect(fittedStyles({ height: 300, width: 400 }, 600)).toEqual({ frame: { height: 300 } });
    const wide = fittedStyles({ height: 300, width: 1198 }, 600);
    expect(wide.frame).toMatchObject({ width: 1198, height: 300, transform: "scale(0.5)" });
    expect(wide.box).toEqual({ height: 151 });
  });

  test("nothing is sized before the page reports its size, and only the height before the room is known", () => {
    expect(fittedStyles(undefined, 600)).toEqual({});
    expect(fittedStyles({ height: 300, width: 900 }, 0)).toEqual({ frame: { height: 300 } });
  });

  test("a page is never scaled up: the text size zooms it inside its frame, where text stays sharp", () => {
    for (const styles of [fittedStyles({ height: 300, width: null }, 1200), fittedStyles({ height: 300, width: 400 }, 1200)]) expect(styles.frame?.transform).toBeUndefined();
  });
});
