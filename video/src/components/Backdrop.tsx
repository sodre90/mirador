import { AbsoluteFill, useCurrentFrame } from "remotion";
import { BRAND } from "../brand.ts";

/** A deep night sky in the icon's violets, with two slow glows drifting across it. */
export function Backdrop() {
  const frame = useCurrentFrame();
  const drift = frame / 60;
  const glow = (x: number, y: number, size: number, colour: string, opacity: number) =>
    `radial-gradient(${size}px ${size * 0.8}px at ${x}% ${y}%, ${colour}${Math.round(opacity * 255).toString(16).padStart(2, "0")}, transparent 70%)`;
  return (
    <AbsoluteFill
      style={{
        background: [
          glow(18 + Math.sin(drift * 0.11) * 6, 22 + Math.cos(drift * 0.09) * 5, 2600, BRAND.indigo, 0.55),
          glow(86 + Math.cos(drift * 0.08) * 5, 80 + Math.sin(drift * 0.1) * 6, 2400, BRAND.violet, 0.32),
          glow(70 + Math.sin(drift * 0.07) * 8, 10, 1400, BRAND.coral, 0.1),
          `linear-gradient(160deg, #13112a 0%, ${BRAND.night} 55%, #08070f 100%)`,
        ].join(", "),
      }}
    />
  );
}
