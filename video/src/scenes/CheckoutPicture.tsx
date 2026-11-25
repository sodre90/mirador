import mermaid from "mermaid";
import { useEffect, useState } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender, Easing, interpolate, spring, useVideoConfig } from "remotion";
import { CHECKOUT_FLOW, CHECKOUT_LEAD, CHECKOUT_RISKS, CHECKOUT_TITLE, MERMAID_SEQUENCE } from "../../capture/checkout-flow.ts";
import { BRAND, FONT } from "../brand.ts";
import { AppIcon } from "../components/AppIcon.tsx";
import { Backdrop } from "../components/Backdrop.tsx";

const DIAGRAM_ID = "checkout-flow";
const PAGE_WIDTH = 1180;
const PAGE_SCALE = 2.08;
const PAGE_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const RED = "#e5484d";
const clamped = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Timed so every actor, every step, the red warning flares, and all three risk cards complete cleanly inside the hook. */
const ACTORS_AT = 0.14;
const ACTOR_GAP = 0.065;
const ROWS_AT = 0.55;
const ROW_GAP = 0.14;
const ROW_SECONDS = 0.18;
const WARNINGS_FLARE_AT = 2.05;
const RISKS_AT = 2.2;
const RISK_GAP = 0.12;

type Diagram = { svg: string; actors: number; rows: number };

function stepped(svg: string): Diagram {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const actorParts = [...document.querySelectorAll("line.actor-line, rect.actor-top, text.actor-box")];
  const centreOf = (part: Element) => (part.matches("rect") ? Number(part.getAttribute("x")) + Number(part.getAttribute("width")) / 2 : Number(part.getAttribute(part.matches("line") ? "x1" : "x")));
  const centres = [...new Set(actorParts.map(centreOf))].sort((a, b) => a - b);
  actorParts.forEach((part) => part.setAttribute("data-actor", String(centres.indexOf(centreOf(part)))));

  const rows: { y: number; parts: Element[] }[] = [];
  for (const part of document.querySelectorAll("text.messageText, rect.note, text.noteText, .messageLine0, .messageLine1, line:not(.actor-line), text.sequenceNumber")) {
    if (part.matches("text.messageText, rect.note")) rows.push({ y: Number(part.getAttribute("y")), parts: [] });
    rows.at(-1)?.parts.push(part);
  }
  rows.sort((a, b) => a.y - b.y);
  rows.forEach(({ parts }, step) => {
    const line = parts.find((part) => part.matches("line.messageLine0, line.messageLine1"));
    const fromRight = line ? Number(line.getAttribute("x2")) < Number(line.getAttribute("x1")) : false;
    const warns = parts.some((part) => part.textContent?.includes("⚠"));
    for (const part of parts) {
      part.setAttribute("data-step", String(step));
      part.setAttribute("data-from", fromRight ? "right" : "left");
      if (warns) part.setAttribute("data-warn", "");
    }
  });
  return { svg: new XMLSerializer().serializeToString(document), actors: centres.length, rows: rows.length };
}

let drawing: Promise<Diagram> | undefined;
const drawDiagram = () =>
  (drawing ??= (async () => {
    mermaid.initialize({ startOnLoad: false, theme: "dark", sequence: MERMAID_SEQUENCE });
    const { svg } = await mermaid.render(DIAGRAM_ID, CHECKOUT_FLOW);
    return stepped(svg);
  })());

function useDiagram() {
  const [diagram, setDiagram] = useState<Diagram>();
  const [handle] = useState(() => delayRender("Drawing the checkout diagram"));
  useEffect(() => {
    drawDiagram().then((drawn) => {
      setDiagram(drawn);
      continueRender(handle);
    }, cancelRender);
  }, [handle]);
  return diagram;
}

const easeOut = Easing.out(Easing.cubic);

function drawnSoFar({ actors, rows }: Diagram, seconds: number, fps: number) {
  const rules = Array.from({ length: actors }, (_, actor) => {
    const shown = spring({ frame: (seconds - ACTORS_AT - actor * ACTOR_GAP) * fps, fps, config: { damping: 15, mass: 0.6 } });
    return `#${DIAGRAM_ID} [data-actor="${actor}"] { opacity: ${shown}; transform: translateY(${14 * (1 - shown)}px); }`;
  });
  for (let step = 0; step < rows; step++) {
    const start = ROWS_AT + step * ROW_GAP;
    const shown = interpolate(seconds, [start, start + ROW_SECONDS], [0, 1], { ...clamped, easing: easeOut });
    rules.push(`#${DIAGRAM_ID} [data-step="${step}"] { opacity: ${shown}; }`);
    rules.push(`#${DIAGRAM_ID} [data-step="${step}"][data-from="left"] { transform: translateX(${-22 * (1 - shown)}px); }`);
    rules.push(`#${DIAGRAM_ID} [data-step="${step}"][data-from="right"] { transform: translateX(${22 * (1 - shown)}px); }`);
  }
  const flare = interpolate(seconds, [WARNINGS_FLARE_AT, WARNINGS_FLARE_AT + 0.14], [0, 1], clamped);
  const glow = flare * interpolate(seconds, [WARNINGS_FLARE_AT, WARNINGS_FLARE_AT + 0.18, WARNINGS_FLARE_AT + 0.85], [0, 16, 6], clamped);
  if (flare > 0) {
    rules.push(`#${DIAGRAM_ID} rect.note[data-warn] { fill: rgba(229, 72, 77, ${0.32 * flare}); stroke: ${RED}; filter: drop-shadow(0 0 ${glow}px ${RED}); }`);
    rules.push(`#${DIAGRAM_ID} text.messageText[data-warn], #${DIAGRAM_ID} text.noteText[data-warn], #${DIAGRAM_ID} text.noteText[data-warn] tspan { fill: #ff9a9e; filter: drop-shadow(0 0 ${glow / 2}px ${RED}); }`);
  }
  return rules.join("\n");
}

function Risk({ title, detail, slow, at, seconds, fps }: { title: string; detail: string; slow: boolean; at: number; seconds: number; fps: number }) {
  const shown = spring({ frame: (seconds - at) * fps, fps, config: { damping: 16, mass: 0.65 } });
  return (
    <div style={{ opacity: Math.min(1, shown * 1.4), transform: `translateY(${20 * (1 - shown)}px) scale(${0.96 + 0.04 * shown})`, background: "#1f1e2a", border: "1px solid #34324a", borderLeft: `4px solid ${slow ? "#f5a524" : RED}`, borderRadius: 10, padding: "9px 12px", fontSize: 13 }}>
      <b style={{ display: "block" }}>{title}</b>
      {detail}
    </div>
  );
}

/**
 * The flip out of the wall of text: Mirador's header springs in above the checkout sequence diagram, drawing every
 * actor, step, glowing warning flare, and risk card in full before cutting into the live app.
 */
export function CheckoutPicture({ secondsIn }: { secondsIn: number }) {
  const { fps } = useVideoConfig();
  const diagram = useDiagram();
  const appear = spring({ frame: secondsIn * fps, fps, config: { damping: 18, mass: 0.7 } });
  const pushIn = interpolate(secondsIn, [0, 3.6], [0.95, 1.015], { ...clamped, easing: easeOut });
  const tilt = (1 - appear) * 5;
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
            marginTop: 110,
            flex: "none",
            transform: `perspective(3600px) rotateX(${tilt}deg) scale(${PAGE_SCALE * pushIn})`,
            padding: "22px 26px",
            borderRadius: 18,
            background: "#17161f",
            border: "1px solid rgba(139, 124, 246, 0.35)",
            boxShadow: "0 36px 100px rgba(0, 0, 0, 0.65), 0 0 150px rgba(118, 118, 242, 0.22)",
            font: `15px/1.5 ${PAGE_FONT}`,
            color: "#ecebf5",
          }}
        >
          <h1 style={{ fontSize: 21, margin: "0 0 4px" }}>{CHECKOUT_TITLE}</h1>
          <p style={{ color: "#a9a6bd", margin: "0 0 14px" }}>{CHECKOUT_LEAD}</p>
          <div style={{ background: "#1f1e2a", border: "1px solid #34324a", borderRadius: 12, padding: 10, minHeight: 590 }} dangerouslySetInnerHTML={{ __html: diagram?.svg ?? "" }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 14 }}>
            {CHECKOUT_RISKS.map((risk, index) => (
              <Risk key={risk.title} {...risk} at={RISKS_AT + index * RISK_GAP} seconds={secondsIn} fps={fps} />
            ))}
          </div>
        </div>
      </AbsoluteFill>
      {diagram && <style>{drawnSoFar(diagram, secondsIn, fps)}</style>}
    </AbsoluteFill>
  );
}
