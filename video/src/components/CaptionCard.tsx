import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, FONT } from "../brand.ts";

const THUMBNAIL_YELLOW = "#ffd400";

/** The feature on screen, named in a corner on frosted glass: sliding in at `from` and fading out before `to` (frames). */
export function CaptionCard({ kicker, title, from, to, side = "left" }: { kicker: string; title: string; from: number; to: number; side?: "left" | "right" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const slide = spring({ frame: frame - from, fps, config: { damping: 18, mass: 0.6 } });
  const leave = interpolate(frame, [to - 12, to], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (frame < from || frame > to) return null;
  return (
    <div
      style={{
        position: "absolute",
        [side]: 110,
        bottom: 110,
        display: "flex",
        alignItems: "center",
        gap: 34,
        padding: "26px 46px 28px 30px",
        borderRadius: 28,
        background: "rgba(14, 13, 28, 0.8)",
        backdropFilter: "blur(30px) saturate(140%)",
        boxShadow: "0 24px 70px rgba(0, 0, 0, 0.5), inset 0 0 0 2px rgba(255, 255, 255, 0.1)",
        opacity: Math.min(1, slide) * leave,
        transform: `translateX(${(side === "left" ? -1 : 1) * (1 - slide) * 140}px)`,
        fontFamily: FONT,
      }}
    >
      <div style={{ width: 12, alignSelf: "stretch", borderRadius: 6, background: THUMBNAIL_YELLOW }} />
      <div>
        <div style={{ color: THUMBNAIL_YELLOW, fontSize: 34, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>{kicker}</div>
        <div style={{ color: BRAND.ink, fontSize: 60, fontWeight: 720, letterSpacing: "-0.015em", lineHeight: 1.1 }}>{title}</div>
      </div>
    </div>
  );
}
