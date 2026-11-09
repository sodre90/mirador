import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

const clamped = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** A white flash that burns out over a few frames from `from`, the cut's hit. */
export function Flash({ from = 0, frames = 6, strength = 0.85 }: { from?: number; frames?: number; strength?: number }) {
  const frame = useCurrentFrame() - from;
  if (frame < 0 || frame > frames) return null;
  return <AbsoluteFill style={{ background: "#fff", opacity: interpolate(frame, [0, frames], [strength, 0], clamped), pointerEvents: "none" }} />;
}

/** A zoom that kicks in past the frame on the hit and settles back, around a scene's picture. */
export function punchScale(frame: number, from = 0, amount = 0.12) {
  return 1 + amount * Math.exp(-Math.max(0, frame - from) / 6) * (frame >= from ? 1 : 0);
}

/** A short shake on the hit, in pixels. */
export function shake(frame: number, from = 0, pixels = 26) {
  const since = frame - from;
  if (since < 0 || since > 12) return { x: 0, y: 0 };
  const fade = 1 - since / 12;
  return { x: Math.sin(since * 2.7) * pixels * fade, y: Math.cos(since * 3.9) * pixels * 0.6 * fade };
}
