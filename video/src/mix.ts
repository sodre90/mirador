import { interpolate } from "remotion";
import type { NarrationLine, PlacedScene } from "./timeline.ts";

const MUSIC_VOLUME = 0.5;
/** How far the music dips while the narrator speaks, unless a line asks for less. */
const DUCKED = 0.3;
const DUCK_RAMP_SECONDS = 0.25;

/** A line of narration in the trailer's frames, from just before it starts until just after it ends, and how low the music goes under it. */
export type SpokenSpan = { from: number; to: number; musicDipsTo: number };

export function spokenSpans(placed: PlacedScene[], narration: Record<string, NarrationLine>, fps: number): SpokenSpan[] {
  return placed.flatMap(({ from, lines }) =>
    lines.map(({ line, at, musicDipsTo = DUCKED }) => ({ from: from + (at - 0.15) * fps, to: from + (at + narration[line]!.seconds + 0.2) * fps, musicDipsTo })),
  );
}

/** The music's volume at a frame: lower under each line of narration, easing down just before it and back up after. */
export function musicVolume(frame: number, spoken: SpokenSpan[], fps: number) {
  const ramp = DUCK_RAMP_SECONDS * fps;
  const dips = spoken.map(({ from, to, musicDipsTo }) => interpolate(frame, [from - ramp, from, to, to + ramp], [1, musicDipsTo, musicDipsTo, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return MUSIC_VOLUME * Math.min(1, ...dips);
}
