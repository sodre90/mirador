import { AbsoluteFill, useCurrentFrame } from "remotion";
import { BRAND } from "../brand.ts";

/** Deep obsidian backdrop with drifting accent glows and a subtle architectural dot grid. */
export function Backdrop({ accent = BRAND.violet }: { accent?: string }) {
  const frame = useCurrentFrame();
  const drift = frame / 60;
  const glow = (x: number, y: number, size: number, colour: string, opacity: number) =>
    `radial-gradient(${size}px ${size * 0.78}px at ${x}% ${y}%, ${colour}${Math.round(opacity * 255).toString(16).padStart(2, "0")}, transparent 70%)`;
  return (
    <AbsoluteFill
      style={{
        background: [
          glow(22 + Math.sin(drift * 0.14) * 6, 18 + Math.cos(drift * 0.11) * 5, 2500, accent, 0.34),
          glow(82 + Math.cos(drift * 0.1) * 5, 82 + Math.sin(drift * 0.12) * 5, 2300, BRAND.indigo, 0.48),
          glow(50 + Math.sin(drift * 0.08) * 7, 4, 1500, accent, 0.18),
          `linear-gradient(165deg, #121024 0%, ${BRAND.night} 52%, #06050b 100%)`,
        ].join(", "),
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage: "radial-gradient(rgba(255, 255, 255, 0.06) 2px, transparent 2px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(85% 80% at 50% 45%, rgba(0,0,0,0.85) 0%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(85% 80% at 50% 45%, rgba(0,0,0,0.85) 0%, transparent 100%)",
        }}
      />
    </AbsoluteFill>
  );
}
