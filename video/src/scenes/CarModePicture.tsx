import { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Easing, interpolate, spring, useVideoConfig } from "remotion";
import { carModeQuestion } from "../../capture/car-mode.ts";
import { BRAND, FONT } from "../brand.ts";
import { AppIcon } from "../components/AppIcon.tsx";
import { Backdrop } from "../components/Backdrop.tsx";

const PAGE_WIDTH = 760;
const PAGE_SCALE = 3.0;
const PAGE_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const clamped = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeOut = Easing.out(Easing.cubic);

const PHONES_AT = 0.3;
const PHONE_GAP = 0.2;
const PICKED_AT = 2.5;

/** Each mockup brings its own `<style>`, which a shadow root keeps to that mockup. */
function Mockup({ html }: { html: string }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = host.current!.shadowRoot ?? host.current!.attachShadow({ mode: "open" });
    root.innerHTML = html;
  }, [html]);
  return <div ref={host} style={{ padding: "8px 6px 12px" }} />;
}

type Option = (typeof carModeQuestion.options)[number];

function OptionCard({ option, at, picked, seconds, fps }: { option: Option; at: number; picked: number; seconds: number; fps: number }) {
  const shown = spring({ frame: (seconds - at) * fps, fps, config: { damping: 15, mass: 0.7 } });
  const ring = `rgba(139, 124, 246, ${0.35 + 0.65 * picked})`;
  return (
    <div
      style={{
        opacity: Math.min(1, shown * 1.4),
        transform: `translateY(${40 * (1 - shown)}px) scale(${0.92 + 0.08 * shown})`,
        background: "#1f1e2a",
        border: `1px solid ${picked > 0 ? ring : "#34324a"}`,
        boxShadow: picked > 0 ? `0 0 0 ${2 * picked}px ${ring}, 0 0 ${36 * picked}px rgba(118, 118, 242, ${0.45 * picked})` : "none",
        borderRadius: 12,
        padding: "12px 12px 4px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 13.5, whiteSpace: "nowrap" }}>
        <span style={{ width: 13, height: 13, flex: "none", boxSizing: "border-box", borderRadius: "50%", border: `${1.5 + 2.5 * picked}px solid ${picked > 0 ? BRAND.violet : "#6b6880"}` }} />
        {option.label}
      </div>
      {option.recommended && <span style={{ alignSelf: "flex-start", margin: "6px 0 0 21px", padding: "1px 7px", borderRadius: 8, background: "rgba(118, 118, 242, 0.22)", color: "#c9c5ff", fontSize: 10.5 }}>Recommended</span>}
      <div style={{ marginTop: "auto" }}>
        <Mockup html={option.html} />
      </div>
    </div>
  );
}

/**
 * The page tilts in under a perspective while it springs in, then rests flat: Chrome rasterises a 3D-transformed
 * layer at its laid-out size and blurs it when scaled, so the page is laid out at full size through `zoom` instead.
 */
function tiltedIn(appear: number, pushIn: number) {
  const tilt = (1 - appear) * 5;
  return tilt > 0.05 ? `perspective(${3600 / PAGE_SCALE}px) rotateX(${tilt}deg) scale(${pushIn})` : `scale(${pushIn})`;
}

/**
 * The flip out of the wall of text: Mirador's header springs in above the agent's question with three car mode looks,
 * each on an iPhone, and the recommended one is picked before the cut into the live app.
 */
export function CarModePicture({ secondsIn }: { secondsIn: number }) {
  const { fps } = useVideoConfig();
  const appear = spring({ frame: secondsIn * fps, fps, config: { damping: 18, mass: 0.7 } });
  const pushIn = interpolate(secondsIn, [0, 5], [0.95, 1.02], { ...clamped, easing: easeOut });
  const picked = interpolate(secondsIn, [PICKED_AT, PICKED_AT + 0.25], [0, 1], { ...clamped, easing: easeOut });
  const pickedOption = carModeQuestion.options.findIndex((option) => option.recommended);
  return (
    <AbsoluteFill>
      <Backdrop accent={BRAND.violet} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: Math.min(1, appear * 1.6) }}>
        <div
          style={{
            position: "absolute",
            top: 76,
            display: "flex",
            alignItems: "center",
            gap: 28,
            fontFamily: FONT,
            opacity: Math.min(1, appear * 1.5),
            transform: `translateY(${(1 - appear) * -28}px)`,
          }}
        >
          <AppIcon size={96} from={0} />
          <span style={{ fontSize: 64, fontWeight: 800, letterSpacing: "-0.03em", color: BRAND.ink }}>Mirador</span>
          <span style={{ width: 3, height: 48, background: "rgba(255,255,255,0.18)" }} />
          <span style={{ fontSize: 52, fontWeight: 600, color: "#cfcde8", letterSpacing: "-0.015em" }}>Give your agent a canvas.</span>
        </div>
        <div
          style={{
            width: PAGE_WIDTH,
            marginTop: 120 / PAGE_SCALE,
            flex: "none",
            zoom: PAGE_SCALE,
            transform: tiltedIn(appear, pushIn),
            padding: "18px 20px 16px",
            borderRadius: 18,
            background: "#17161f",
            border: "1px solid rgba(139, 124, 246, 0.35)",
            boxShadow: "0 36px 100px rgba(0, 0, 0, 0.65), 0 0 150px rgba(118, 118, 242, 0.22)",
            font: `15px/1.5 ${PAGE_FONT}`,
            color: "#ecebf5",
          }}
        >
          <h1 style={{ fontSize: 19, margin: "0 0 12px" }}>{carModeQuestion.question}</h1>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {carModeQuestion.options.map((option, index) => (
              <OptionCard key={option.label} option={option} at={PHONES_AT + index * PHONE_GAP} picked={index === pickedOption ? picked : 0} seconds={secondsIn} fps={fps} />
            ))}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
