import { describe, expect, test } from "bun:test";
import { carve, grid, limit, Mix, RATE } from "../audio/synth.ts";

const tone = (frequency: number, seconds: number, level: number) => Float32Array.from({ length: seconds * RATE }, (_, index) => level * Math.sin((2 * Math.PI * frequency * index) / RATE));
const loudness = (samples: Float32Array, from: number, to: number) => Math.sqrt(samples.slice(from * RATE, to * RATE).reduce((total, sample) => total + sample * sample, 0) / ((to - from) * RATE));

describe("the score's grid", () => {
  test("stretches the beat a little so both moments fall on one", () => {
    const g = grid(10, 20.2, 96);
    expect(g.beats).toBe(16);
    expect(g.at(0)).toBe(10);
    expect(g.at(g.beats)).toBeCloseTo(20.2);
  });

  test("can keep to whole bars, and finds the beat nearest a moment", () => {
    const g = grid(46.22, 69.23, 144, true);
    expect(g.beats % 4).toBe(0);
    expect(g.bars).toBe(14);
    expect(g.nearestBeat(46.3)).toBeCloseTo(46.22);
  });
});

describe("the limiter", () => {
  test("brings a peak down to its ceiling and leaves the music away from it alone", () => {
    const mix = new Mix(4);
    mix.add(0, tone(220, 4, 0.1), 1);
    mix.add(2, Float32Array.from({ length: 50 }, () => 1), 1);
    const ceiling = limit(mix, 12);
    expect(Math.max(...mix.left.map(Math.abs))).toBeLessThanOrEqual(ceiling * 1.001);
    expect(loudness(mix.left, 0.2, 1)).toBeCloseTo(0.1 * Math.SQRT1_2 * Math.SQRT1_2, 4);
  });
});

describe("the room made for the narrator", () => {
  test("turns the speech band down while a line is spoken and leaves the mix untouched elsewhere", () => {
    const mix = new Mix(3);
    mix.add(0, tone(2000, 3, 0.5), 1);
    const before = mix.left.slice();
    carve(mix, [{ from: 1, to: 2 }], 6);
    const dip = 20 * Math.log10(loudness(mix.left, 1.2, 1.8) / loudness(before, 1.2, 1.8));
    expect(dip).toBeLessThan(-6);
    expect(dip).toBeGreaterThan(-10);
    expect(Math.max(...mix.left.slice(0, 0.6 * RATE).map((sample, index) => Math.abs(sample - before[index]!)))).toBeLessThan(1e-5);
  });
});
