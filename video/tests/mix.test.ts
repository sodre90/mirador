import { describe, expect, test } from "bun:test";
import { musicVolume, spokenSpans } from "../src/mix.ts";
import type { PlacedScene } from "../src/timeline.ts";

const fps = 10;
const narration = { hello: { text: "Hello.", file: "hello.wav", seconds: 2 } };
const placedWith = (spoken: { line: string; at: number; musicDipsTo?: number }[]): PlacedScene[] => [
  { scene: { kind: "logo", id: "logo", seconds: 10, narration: spoken }, from: 20, frames: 100, fadeInFrames: 0, lines: spoken },
];

describe("the music", () => {
  test("plays at full volume away from the narration and dips under a line", () => {
    const spoken = spokenSpans(placedWith([{ line: "hello", at: 1 }]), narration, fps);
    expect(musicVolume(0, spoken, fps)).toBe(0.5);
    expect(musicVolume(40, spoken, fps)).toBeCloseTo(0.15);
    expect(musicVolume(80, spoken, fps)).toBe(0.5);
  });

  test("starts dipping just before a line and comes back just after it", () => {
    const [span] = spokenSpans(placedWith([{ line: "hello", at: 1 }]), narration, fps);
    expect(span).toEqual({ from: 28.5, to: 52, musicDipsTo: 0.3 });
  });

  test("dips less under a line that asks for it, and the lowest dip wins where lines overlap", () => {
    const shallow = spokenSpans(placedWith([{ line: "hello", at: 1, musicDipsTo: 0.6 }]), narration, fps);
    expect(musicVolume(40, shallow, fps)).toBeCloseTo(0.3);
    const both = spokenSpans(placedWith([{ line: "hello", at: 1, musicDipsTo: 0.6 }, { line: "hello", at: 1.5 }]), narration, fps);
    expect(musicVolume(40, both, fps)).toBeCloseTo(0.15);
  });
});
