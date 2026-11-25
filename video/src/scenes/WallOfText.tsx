import { AbsoluteFill, Easing, interpolate, spring, useVideoConfig } from "remotion";
import { BRAND, FONT, MONO } from "../brand.ts";
import { TRANSCRIPT, type TranscriptBlock } from "./wall-transcript.ts";

const COLUMN_WIDTH = 2250;
const COLUMN_GAP = 280;
const COPIES = 14;
const START_SPEED = 1050;
const ACCELERATION = 4600;
const FIRST_LINE_AT = 680;
const NEIGHBOURS = [-3, -2, -1, 1, 2, 3];
const clamped = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const HEADLINE_WORDS = ["Coding", "agents", "write", "faster", "than", "you", "can", "read."];

function Block({ block }: { block: TranscriptBlock }) {
  if (block.kind === "prose") return <p style={{ margin: "0 0 42px", font: `450 52px/1.5 ${FONT}`, color: "#d5d3eb" }}>{block.text}</p>;
  if (block.kind === "tool")
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 26, margin: "0 0 26px", padding: "18px 30px", borderRadius: 18, background: "rgba(255, 255, 255, 0.05)", font: `500 44px ${MONO}`, color: "#c5c2e2" }}>
        <span style={{ width: 20, height: 20, borderRadius: 10, background: "#3ecf7a", flex: "none" }} />
        <span style={{ color: BRAND.ink, fontWeight: 700 }}>{block.name}</span>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{block.target}</span>
      </div>
    );
  return (
    <div style={{ margin: "0 0 40px", borderRadius: 18, overflow: "hidden", font: `400 42px/1.6 ${MONO}` }}>
      {block.lines.map((line) => (
        <div
          key={line}
          style={{
            padding: "0 30px",
            whiteSpace: "pre",
            overflow: "hidden",
            color: line.startsWith("+") ? "#9be8b4" : line.startsWith("-") ? "#ffaaa0" : "#bdbad6",
            background: line.startsWith("+") ? "rgba(62, 207, 122, 0.12)" : line.startsWith("-") ? "rgba(255, 107, 90, 0.12)" : "rgba(255, 255, 255, 0.03)",
          }}
        >
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
 * Opening wall of scrolling agent output and diffs, accelerating while the camera pulls back, overlaid with a crisp
 * kinetic hook line that frames the problem from the very first second.
 */
export function WallOfText({ seconds, until }: { seconds: number; until: number }) {
  const { fps, width } = useVideoConfig();
  const frame = seconds * fps;
  const scrolled = START_SPEED * seconds + (ACCELERATION / 2) * seconds ** 2;
  const zoom = interpolate(seconds, [until * 0.25, until], [1, 0.44], { ...clamped, easing: Easing.inOut(Easing.cubic) });
  const neighbours = interpolate(zoom, [0.78, 1], [1, 0], clamped);
  const speedPerFrame = (START_SPEED + ACCELERATION * seconds) / fps;
  const blur = Math.min(4.5, Math.max(0, (speedPerFrame * zoom - 38) / 22));
  const centreX = (width - COLUMN_WIDTH) / 2;
  const exitOpacity = interpolate(seconds, [until - 0.28, until], [1, 0], clamped);

  return (
    <AbsoluteFill style={{ background: "radial-gradient(120% 90% at 50% 42%, #1a1228 0%, #0b0a12 60%, #050409 100%)" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "50% 50%", filter: `blur(${blur}px)`, opacity: 0.68 }}>
        <Column x={centreX} scrolled={scrolled} />
        {NEIGHBOURS.map((offset) => (
          <div key={offset} style={{ opacity: neighbours }}>
            <Column x={centreX + offset * (COLUMN_WIDTH + COLUMN_GAP)} scrolled={scrolled + 1900 * (offset + 4)} />
          </div>
        ))}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(68% 58% at 50% 50%, rgba(10, 9, 20, 0.84) 0%, rgba(10, 9, 20, 0.38) 65%, rgba(229, 72, 77, 0.16) 100%)",
        }}
      />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: exitOpacity, padding: "0 260px" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "18px 34px",
            maxWidth: 2600,
            fontFamily: FONT,
            fontSize: 152,
            fontWeight: 800,
            letterSpacing: "-0.035em",
            lineHeight: 1.08,
            textAlign: "center",
          }}
        >
          {HEADLINE_WORDS.map((word, index) => {
            const pop = spring({ frame: frame - 8 - index * 5, fps, config: { damping: 16, mass: 0.65, stiffness: 160 } });
            const highlight = index >= 4;
            return (
              <span
                key={`${word}-${index}`}
                style={{
                  display: "inline-block",
                  opacity: Math.min(1, pop * 1.4),
                  transform: `translateY(${(1 - pop) * 54}px) scale(${0.92 + 0.08 * pop})`,
                  color: highlight ? BRAND.coral : BRAND.ink,
                  textShadow: "0 18px 60px rgba(0, 0, 0, 0.72)",
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
