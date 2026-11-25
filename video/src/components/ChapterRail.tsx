import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND } from "../brand.ts";
import type { PlacedScene } from "../timeline.ts";

/** Subtle luminous progress rail across the bottom edge of the frame during the feature chapters. */
export function ChapterRail({ placed }: { placed: PlacedScene[] }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const firstClip = placed.find(({ scene }) => scene.kind === "clip");
  const lastClip = placed.findLast(({ scene }) => scene.kind === "clip");
  if (!firstClip || !lastClip) return null;
  const start = firstClip.from;
  const end = lastClip.from + lastClip.frames;
  if (frame < start || frame > end) return null;
  const opacity = Math.min(
    interpolate(frame, [start, start + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(frame, [end - 18, end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  const current = placed.find(({ from, frames }) => frame >= from && frame < from + frames);
  const accent = current?.scene.accent ?? BRAND.violet;
  const progress = Math.min(1, Math.max(0, (frame - start) / Math.max(1, end - start)));
  const ticks = placed.filter(({ scene }) => scene.kind === "clip").map(({ from }) => (from - start) / Math.max(1, end - start));
  if (durationInFrames <= 0) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 8, background: "rgba(255, 255, 255, 0.08)", opacity, pointerEvents: "none" }}>
      <div
        style={{
          height: "100%",
          width: `${progress * 100}%`,
          background: `linear-gradient(90deg, ${BRAND.violet}, ${accent})`,
          boxShadow: `0 0 22px ${accent}`,
        }}
      />
      {ticks.slice(1).map((tick) => (
        <div key={tick} style={{ position: "absolute", left: `${tick * 100}%`, top: 0, bottom: 0, width: 3, background: "rgba(9, 8, 18, 0.75)" }} />
      ))}
    </div>
  );
}
