import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND } from "../brand.ts";

const RAYS = [
  { path: "M32 34V16", opacity: 1, delay: 0 },
  { path: "M38 35.6L45 23.5", opacity: 0.85, delay: 4 },
  { path: "M26 35.6L19 23.5", opacity: 0.85, delay: 4 },
  { path: "M42.4 40L50.2 35.5", opacity: 0.65, delay: 8 },
  { path: "M21.6 40L13.8 35.5", opacity: 0.65, delay: 8 },
];

/**
 * The app icon (desktop/assets/app-icon.svg), built up from `from` (a frame): the tile springs in, the rays grow out
 * of the point they share, and the coral dot drops into place.
 */
export function AppIcon({ size, from = 0 }: { size: number; from?: number }) {
  const frame = useCurrentFrame() - from;
  const { fps } = useVideoConfig();
  const tile = spring({ frame, fps, config: { damping: 14, mass: 0.8 } });
  const ray = (delay: number) => interpolate(frame, [10 + delay, 30 + delay], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const dot = spring({ frame: frame - 26, fps, config: { damping: 9, mass: 0.6 } });
  return (
    <svg viewBox="100 100 824 824" width={size} height={size} style={{ transform: `scale(${tile})`, opacity: Math.min(1, tile * 1.5), overflow: "visible" }}>
      <defs>
        <linearGradient id="icon-background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND.violet} />
          <stop offset="1" stopColor={BRAND.indigo} />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#icon-background)" />
      <g transform="translate(100 100) scale(8.24)">
        <g transform="translate(10 10) scale(1.25)" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round">
          {RAYS.map(({ path, opacity, delay }) => (
            <path key={path} d={path} opacity={opacity * Math.min(1, ray(delay) * 4)} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - ray(delay)} />
          ))}
        </g>
        <circle cx="50" cy="67.5" r="7" fill={BRAND.coral} stroke="#fff" strokeWidth="2.5" style={{ transform: `translateY(${(1 - dot) * -18}px) scale(${dot})`, transformOrigin: "50px 67.5px", transformBox: "view-box" }} />
      </g>
    </svg>
  );
}
