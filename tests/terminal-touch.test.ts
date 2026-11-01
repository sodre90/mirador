import { describe, expect, test } from "bun:test";
import { flingSlowedDown, flingStopped, lineCounter } from "../web/terminal-touch.ts";

const LINE_HEIGHT = 17;

describe("a finger's drag over the terminal", () => {
  test("scrolls whole lines, and what is left of a line counts toward the next move", () => {
    const counter = lineCounter();
    expect(counter.lines(10, LINE_HEIGHT)).toBe(0);
    expect(counter.lines(10, LINE_HEIGHT)).toBe(1);
    expect(counter.lines(-40, LINE_HEIGHT)).toBe(-2);
    expect(counter.lines(-14, LINE_HEIGHT)).toBe(-1);
  });

  test("starts from no part of a line on the next touch", () => {
    const counter = lineCounter();
    counter.lines(16, LINE_HEIGHT);
    counter.reset();
    expect(counter.lines(16, LINE_HEIGHT)).toBe(0);
  });
});

describe("a fling", () => {
  test("slows down as much in two half frames as in one frame", () => {
    expect(flingSlowedDown(flingSlowedDown(2, 8), 8)).toBeCloseTo(flingSlowedDown(2, 16));
    expect(flingSlowedDown(2, 16)).toBeLessThan(2);
  });

  test("goes on in its direction for a while, then stops", () => {
    let velocity = -2;
    let scrolled = 0;
    let frames = 0;
    while (!flingStopped(velocity)) {
      velocity = flingSlowedDown(velocity, 16);
      scrolled += velocity * 16;
      frames++;
    }
    expect(frames).toBeGreaterThan(30);
    expect(frames).toBeLessThan(120);
    expect(scrolled).toBeLessThan(-200);
  });
});
