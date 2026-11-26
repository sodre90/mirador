import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, FONT } from "../brand.ts";
import type { Caption } from "../timeline.ts";

/**
 * Floating glassmorphic chapter bar positioned cleanly above (or below) the app window so it never covers the sidebar,
 * composer, or Send button.
 */
export function CaptionCard({
  kicker,
  title,
  from,
  to,
  position = "top",
  accent = BRAND.violet,
}: {
  kicker: string;
  title: string;
  from: number;
  to: number;
  position?: "top" | "bottom";
  accent?: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - from, fps, config: { damping: 20, mass: 0.65, stiffness: 150 } });
  const leave = interpolate(frame, [to - 12, to], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (frame < from || frame > to) return null;
  const shiftY = (position === "top" ? -34 : 34) * (1 - enter);
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        ...(position === "top" ? { top: 34 } : { bottom: 48 }),
        transform: `translate(-50%, ${shiftY}px)`,
        opacity: Math.min(1, enter * 1.4) * leave,
        display: "flex",
        alignItems: "center",
        gap: 28,
        padding: "20px 44px 20px 24px",
        borderRadius: 999,
        background: "rgba(13, 12, 26, 0.84)",
        backdropFilter: "blur(32px) saturate(160%)",
        boxShadow: `0 24px 64px rgba(0, 0, 0, 0.52), 0 0 42px ${accent}26, inset 0 0 0 2px ${accent}55`,
        fontFamily: FONT,
        whiteSpace: "nowrap",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "12px 26px",
          borderRadius: 999,
          background: `${accent}24`,
          border: `2px solid ${accent}88`,
          color: accent,
          fontSize: 30,
          fontWeight: 800,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ width: 12, height: 12, borderRadius: 6, background: accent, boxShadow: `0 0 14px ${accent}` }} />
        {kicker}
      </div>
      <div style={{ color: BRAND.ink, fontSize: 48, fontWeight: 700, letterSpacing: "-0.015em", lineHeight: 1.1 }}>{title}</div>
    </div>
  );
}

/** A chapter's bars, each from its moment (a fifth of a second in by default) until it times out or the chapter ends. */
export function ChapterCaptions({ captions = [], accent, frames }: { captions?: Caption[]; accent: string; frames: number }) {
  const { fps } = useVideoConfig();
  return captions.map((caption) => (
    <CaptionCard
      key={caption.title}
      kicker={caption.kicker}
      title={caption.title}
      position={caption.position}
      accent={caption.accent ?? accent}
      from={Math.round((caption.at ?? 0.2) * fps)}
      to={caption.seconds ? Math.round(((caption.at ?? 0.2) + caption.seconds) * fps) : frames - 10}
    />
  ));
}
