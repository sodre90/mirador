import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT } from "../brand.ts";

const clamped = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const OUTLINE = 22;
/** Thumbnail yellow, the words' usual colour. */
export const SLAM_YELLOW = "#ffe14a";
const EXTRUDE_STEPS = 9;
const EXTRUDE_STEP = 3.5;
/** A solid black extrusion down and to the right, then a soft shadow on what's behind. */
const EXTRUDED = [...Array.from({ length: EXTRUDE_STEPS }, (_, step) => `${(step + 1) * EXTRUDE_STEP}px ${(step + 1) * EXTRUDE_STEP}px 0 #000`), "0 50px 140px rgba(0, 0, 0, 0.75)"].join(", ");
const FADE_OUT_FRAMES = 10;

/** Giant outlined, extruded words that slam in from oversized, with a little tilt, at frame `from` of their scene, and fade out by `to`. */
export function Slam({ words, from = 0, to = Infinity, accent = SLAM_YELLOW, tilt = -3 }: { words: string; from?: number; to?: number; accent?: string; tilt?: number }) {
  const sceneFrame = useCurrentFrame();
  const frame = sceneFrame - from;
  const { fps } = useVideoConfig();
  if (frame < 0 || sceneFrame >= to) return null;
  const landed = spring({ frame, fps, config: { damping: 11, mass: 0.5, stiffness: 260 } });
  const scale = interpolate(landed, [0, 1], [2.4, 1]);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div
        style={{
          font: `900 250px/0.95 ${FONT}`,
          letterSpacing: "-0.03em",
          textTransform: "uppercase",
          textAlign: "center",
          color: accent,
          WebkitTextStroke: `${OUTLINE}px #000`,
          paintOrder: "stroke fill",
          textShadow: EXTRUDED,
          opacity: interpolate(frame, [0, 3], [0, 1], clamped) * (Number.isFinite(to) ? interpolate(sceneFrame, [to - FADE_OUT_FRAMES, to], [1, 0], clamped) : 1),
          transform: `scale(${scale}) rotate(${tilt}deg)`,
          maxWidth: 3400,
        }}
      >
        {words}
      </div>
    </AbsoluteFill>
  );
}

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
