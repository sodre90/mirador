import { AbsoluteFill, Easing, interpolate, useVideoConfig } from "remotion";
import { BRAND, FONT, MONO } from "../brand.ts";
import { TRANSCRIPT, type TranscriptBlock } from "./wall-transcript.ts";

const COLUMN_WIDTH = 2300;
const COLUMN_GAP = 300;
const COPIES = 14;
/** How fast the answer scrolls at first, in pixels a second, and how fast that speeds up, in pixels a second squared. */
const START_SPEED = 1000;
const ACCELERATION = 4400;
const FIRST_LINE_AT = 700;
const NEIGHBOURS = [-3, -2, -1, 1, 2, 3];
const clamped = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

function Block({ block }: { block: TranscriptBlock }) {
  if (block.kind === "prose") return <p style={{ margin: "0 0 44px", font: `450 54px/1.5 ${FONT}`, color: "#dcdaf0" }}>{block.text}</p>;
  if (block.kind === "tool")
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 26, margin: "0 0 26px", padding: "18px 30px", borderRadius: 18, background: "rgba(255, 255, 255, 0.05)", font: `500 44px ${MONO}`, color: "#c9c6e4" }}>
        <span style={{ width: 22, height: 22, borderRadius: 11, background: "#3ecf7a", flex: "none" }} />
        <span style={{ color: BRAND.ink, fontWeight: 700 }}>{block.name}</span>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{block.target}</span>
      </div>
    );
  return (
    <div style={{ margin: "0 0 40px", borderRadius: 18, overflow: "hidden", font: `400 42px/1.6 ${MONO}` }}>
      {block.lines.map((line) => (
        <div key={line} style={{ padding: "0 30px", whiteSpace: "pre", overflow: "hidden", color: line.startsWith("+") ? "#9be8b4" : line.startsWith("-") ? "#ffaaa0" : "#bdbad6", background: line.startsWith("+") ? "rgba(62, 207, 122, 0.12)" : line.startsWith("-") ? "rgba(255, 107, 90, 0.12)" : "rgba(255, 255, 255, 0.03)" }}>
          {line}
        </div>
      ))}
    </div>
  );
}

function Column({ x, scrolled }: { x: number; scrolled: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: 0, width: COLUMN_WIDTH, transform: `translateY(${FIRST_LINE_AT - scrolled}px)` }}>
      {Array.from({ length: COPIES }, (_, copy) => TRANSCRIPT.map((block, index) => <Block key={`${copy} ${index}`} block={block} />))}
    </div>
  );
}

/**
 * An agent's answer racing past, faster and faster, while the camera pulls back on more of it than anyone could read,
 * until it cuts away at `seconds` = `until`. The neighbouring columns start further along, so it doesn't repeat side by side.
 */
export function WallOfText({ seconds, until }: { seconds: number; until: number }) {
  const { fps, width } = useVideoConfig();
  const scrolled = START_SPEED * seconds + (ACCELERATION / 2) * seconds ** 2;
  const zoom = interpolate(seconds, [until * 0.35, until], [1, 0.42], { ...clamped, easing: Easing.inOut(Easing.cubic) });
  const neighbours = interpolate(zoom, [0.75, 1], [1, 0], clamped);
  const speedPerFrame = (START_SPEED + ACCELERATION * seconds) / fps;
  const blur = Math.min(4, Math.max(0, (speedPerFrame * zoom - 40) / 25));
  const centreX = (width - COLUMN_WIDTH) / 2;
  return (
    <AbsoluteFill style={{ background: "radial-gradient(120% 90% at 50% 40%, #16142a 0%, #0b0a12 60%, #060509 100%)" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "50% 50%", filter: `blur(${blur}px)` }}>
        <Column x={centreX} scrolled={scrolled} />
        {NEIGHBOURS.map((offset) => (
          <div key={offset} style={{ opacity: neighbours }}>
            <Column x={centreX + offset * (COLUMN_WIDTH + COLUMN_GAP)} scrolled={scrolled + 1900 * (offset + 4)} />
          </div>
        ))}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(#0b0a12 0%, transparent 18%, transparent 80%, #0b0a12 100%)" }} />
    </AbsoluteFill>
  );
}
