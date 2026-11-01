import type { CSSProperties, ReactNode } from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

/** Rises a little and fades in from `at` (a frame), as titles do. */
export function Reveal({ at, children, style, distance = 50 }: { at: number; children: ReactNode; style?: CSSProperties; distance?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shown = spring({ frame: frame - at, fps, config: { damping: 200, mass: 0.8 } });
  return <div style={{ opacity: shown, transform: `translateY(${(1 - shown) * distance}px)`, ...style }}>{children}</div>;
}
