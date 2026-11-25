import { AbsoluteFill, interpolate, spring, useCurrentFrame } from "remotion";
import { BRAND } from "../brand.ts";

const clamped = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** A refined accent-tinted light flash that burns out softly over a few frames from `from`. */
export function Flash({ from = 0, frames = 10, strength = 0.24, color = BRAND.violet }: { from?: number; frames?: number; strength?: number; color?: string }) {
  const frame = useCurrentFrame() - from;
  if (frame < 0 || frame > frames) return null;
  const opacity = interpolate(frame, [0, frames], [strength, 0], clamped);
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(100% 90% at 50% 45%, #ffffff 0%, ${color} 60%, transparent 100%)`,
        opacity,
        pointerEvents: "none",
      }}
    />
  );
}

/** A subtle 3D perspective entrance that settles smoothly to flat, giving each chapter tactile depth. */
export function entrance3d(frame: number, fps: number, tilt: -1 | 1 = 1) {
  const settled = spring({ frame, fps, config: { damping: 20, mass: 0.75, stiffness: 120 } });
  const rest = 1 - settled;
  const scale = 1 - 0.042 * rest;
  const rotateX = 3.2 * rest;
  const rotateY = 2.6 * tilt * rest;
  const translateY = 26 * rest;
  return `perspective(3800px) translateY(${translateY}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`;
}

/** A zoom that kicks in past the frame on the hit and settles back, around a scene's picture. */
export function punchScale(frame: number, from = 0, amount = 0.08) {
  return 1 + amount * Math.exp(-Math.max(0, frame - from) / 7) * (frame >= from ? 1 : 0);
}

/** A short shake on the hook's cut, in pixels. */
export function shake(frame: number, from = 0, pixels = 20) {
  const since = frame - from;
  if (since < 0 || since > 12) return { x: 0, y: 0 };
  const fade = 1 - since / 12;
  return { x: Math.sin(since * 2.7) * pixels * fade, y: Math.cos(since * 3.9) * pixels * 0.6 * fade };
}
