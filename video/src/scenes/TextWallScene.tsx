import type { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, FONT, MONO } from "../brand.ts";
import { statementBeats, type WallScene } from "../timeline.ts";
import { CheckoutPicture } from "./CheckoutPicture.tsx";
import { TRANSCRIPT, type TranscriptBlock } from "./wall-transcript.ts";

const COLUMN_WIDTH = 2300;
const COLUMN_GAP = 300;
const COPIES = 16;
const FIRST_LINE_AT = 1150;
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
 * An agent's answer scrolling past faster and faster, until the camera pulls back on more of it than anyone could read,
 * brighter and shaking as it goes black. The neighbouring columns start further along, so it doesn't repeat side by side.
 */
function Wall({ seconds, goesBlackAt }: { seconds: number; goesBlackAt: number }) {
  const { fps, width } = useVideoConfig();
  const scrolled = 130 * seconds + 330 * seconds ** 2;
  const pullBack = interpolate(seconds, [4.6, 7], [1, 0.36], { ...clamped, easing: Easing.inOut(Easing.cubic) });
  const zoom = pullBack * interpolate(seconds, [7, goesBlackAt], [1, 0.8], clamped);
  const neighbours = interpolate(zoom, [0.8, 1], [1, 0], clamped);
  const speedPerFrame = (130 + 660 * seconds) / fps;
  const blur = Math.min(4, Math.max(0, (speedPerFrame * zoom - 40) / 25));
  const pressure = interpolate(seconds, [goesBlackAt - 1, goesBlackAt], [0, 1], clamped);
  const shake = `translate(${pressure * 26 * Math.sin(seconds * 97)}px, ${pressure * 18 * Math.sin(seconds * 131 + 1)}px)`;
  const centreX = (width - COLUMN_WIDTH) / 2;
  return (
    <AbsoluteFill style={{ background: "radial-gradient(120% 90% at 50% 40%, #16142a 0%, #0b0a12 60%, #060509 100%)", transform: shake }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "50% 50%", filter: `blur(${blur}px) brightness(${1 + 0.45 * pressure})` }}>
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

/** A word that lands: big and faint for a frame, then snapping to its place. */
function Landing({ at, children }: { at: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const since = frame - at * fps;
  const landed = spring({ frame: since, fps, config: { damping: 14, mass: 0.6, stiffness: 180 } });
  return <span style={{ display: "inline-block", whiteSpace: "nowrap", opacity: since < 0 ? 0 : Math.min(1, (since + 1) / 3), transform: `scale(${1.4 - 0.4 * landed})`, transformOrigin: "left center" }}>{children}</span>;
}

const STRESSED = {
  fontSize: "1.3em",
  background: `linear-gradient(90deg, ${BRAND.violet}, ${BRAND.coral})`,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  filter: "drop-shadow(0 0 40px rgba(118, 118, 242, 0.45))",
} as const;

/**
 * The problem the trailer opens on: a wall of text that piles up until it goes black and silent. In the black the
 * statement lands part by part as it's said, and clears for the picture of what the wall said to draw itself.
 */
export function TextWallScene({ scene }: { scene: WallScene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const goesBlackAt = scene.goesBlackAt ?? scene.seconds;
  const fadeIn = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const { statement, pictureAt } = scene;
  const beats = statement ? statementBeats(statement) : [];
  const statementCleared = pictureAt === undefined ? 0 : interpolate(seconds, [pictureAt - 0.3, pictureAt], [0, 1], clamped);
  return (
    <AbsoluteFill style={{ background: "#000", opacity: fadeIn }}>
      {seconds < goesBlackAt && <Wall seconds={seconds} goesBlackAt={goesBlackAt} />}
      {statement && statementCleared < 1 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 1 - statementCleared, filter: statementCleared > 0 ? `blur(${12 * statementCleared}px)` : undefined }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.26em", font: `780 150px ${FONT}`, letterSpacing: "-0.035em", color: BRAND.ink }}>
            {statement.parts.map(({ words, stressed }, index) => (
              <Landing key={words} at={beats[index]!}>
                <span style={stressed ? STRESSED : undefined}>{words}</span>
              </Landing>
            ))}
          </div>
        </AbsoluteFill>
      )}
      {pictureAt !== undefined && seconds >= pictureAt && <CheckoutPicture secondsIn={seconds - pictureAt} />}
    </AbsoluteFill>
  );
}
