import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, FONT } from "../brand.ts";

/** The scene's idea in a few words on frosted glass, rising in at `from` and fading out before `to` (frames). */
export function CaptionCard({ kicker, title, from, to, side = "left" }: { kicker: string; title: string; from: number; to: number; side?: "left" | "right" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame: frame - from, fps, config: { damping: 200, mass: 0.9 } });
  const leave = interpolate(frame, [to - 18, to], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (frame < from || frame > to) return null;
  return (
    <div
      style={{
        position: "absolute",
        [side]: 170,
        bottom: 170,
        maxWidth: 1900,
        padding: "44px 60px 52px",
        borderRadius: 36,
        background: "rgba(14, 13, 28, 0.74)",
        backdropFilter: "blur(30px) saturate(140%)",
        boxShadow: "0 30px 90px rgba(0, 0, 0, 0.45), inset 0 0 0 2px rgba(255, 255, 255, 0.09)",
        opacity: rise * leave,
        transform: `translateY(${(1 - rise) * 60}px)`,
        fontFamily: FONT,
      }}
    >
      <div style={{ color: BRAND.coral, fontSize: 40, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 14 }}>{kicker}</div>
      <div style={{ color: BRAND.ink, fontSize: 104, fontWeight: 760, letterSpacing: "-0.025em", lineHeight: 1.05 }}>{title}</div>
    </div>
  );
}
