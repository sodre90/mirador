import mermaid from "mermaid";
import { useEffect, useState } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender, Easing, interpolate, spring, useVideoConfig } from "remotion";
import { CHECKOUT_FLOW, CHECKOUT_LEAD, CHECKOUT_RISKS, CHECKOUT_TITLE, MERMAID_SEQUENCE } from "../../capture/checkout-flow.ts";

const DIAGRAM_ID = "checkout-flow";
const PAGE_WIDTH = 1180;
const PAGE_SCALE = 2.3;
const PAGE_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const RED = "#e5484d";
const clamped = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** When each part is drawn, in seconds from the picture's start. */
const ACTORS_AT = 0.15;
const ACTOR_GAP = 0.07;
const ROWS_AT = 0.6;
const ROW_GAP = 0.14;
const ROW_SECONDS = 0.18;
const WARNINGS_FLARE_AT = 2.35;
const RISKS_AT = 2.4;
const RISK_GAP = 0.1;

type Diagram = { svg: string; actors: number; rows: number };

/**
 * Tags the diagram's parts with the order they're drawn in: the services left to right, then each message or note top
 * to bottom, with the side it comes from and whether it's one of the ⚠ places an order gets stuck.
 */
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

/** How far each part of the diagram is drawn at a second of the picture, as CSS for its tagged parts. */
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
  const flare = interpolate(seconds, [WARNINGS_FLARE_AT, WARNINGS_FLARE_AT + 0.12], [0, 1], clamped);
  const glow = flare * interpolate(seconds, [WARNINGS_FLARE_AT, WARNINGS_FLARE_AT + 0.15, WARNINGS_FLARE_AT + 0.8], [0, 14, 5], clamped);
  if (flare > 0) {
    rules.push(`#${DIAGRAM_ID} rect.note[data-warn] { fill: rgba(229, 72, 77, ${0.28 * flare}); stroke: ${RED}; filter: drop-shadow(0 0 ${glow}px ${RED}); }`);
    rules.push(`#${DIAGRAM_ID} text.messageText[data-warn], #${DIAGRAM_ID} text.noteText[data-warn], #${DIAGRAM_ID} text.noteText[data-warn] tspan { fill: #ff9a9e; filter: drop-shadow(0 0 ${glow / 2}px ${RED}); }`);
  }
  return rules.join("\n");
}

function Risk({ title, detail, slow, at, seconds }: { title: string; detail: string; slow: boolean; at: number; seconds: number }) {
  const shown = interpolate(seconds, [at, at + 0.2], [0, 1], { ...clamped, easing: easeOut });
  return (
    <div style={{ opacity: shown, transform: `translateY(${16 * (1 - shown)}px)`, background: "#1f1e2a", border: "1px solid #34324a", borderLeft: `4px solid ${slow ? "#f5a524" : RED}`, borderRadius: 10, padding: "9px 12px", fontSize: 13 }}>
      <b style={{ display: "block" }}>{title}</b>
      {detail}
    </div>
  );
}

/**
 * Out of the black, the picture of what the wall of text said: the checkout diagram the agent draws later in the
 * trailer, drawn here part by part, with the places an order gets stuck flaring red.
 */
export function CheckoutPicture({ secondsIn }: { secondsIn: number }) {
  const { fps } = useVideoConfig();
  const diagram = useDiagram();
  const appear = interpolate(secondsIn, [0, 0.25], [0, 1], clamped);
  const pushIn = interpolate(secondsIn, [0, 3], [0.94, 1], { ...clamped, easing: easeOut });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", background: "radial-gradient(80% 70% at 50% 45%, #14122a 0%, #060509 75%)", opacity: appear }}>
      <div style={{ width: PAGE_WIDTH, flex: "none", transform: `scale(${PAGE_SCALE * pushIn})`, padding: "22px 26px", borderRadius: 18, background: "#17161f", border: "1px solid #2c2a3e", boxShadow: "0 30px 90px rgba(0, 0, 0, 0.6), 0 0 140px rgba(118, 118, 242, 0.16)", font: `15px/1.5 ${PAGE_FONT}`, color: "#ecebf5" }}>
        <h1 style={{ fontSize: 21, margin: "0 0 4px" }}>{CHECKOUT_TITLE}</h1>
        <p style={{ color: "#a9a6bd", margin: "0 0 14px" }}>{CHECKOUT_LEAD}</p>
        <div style={{ background: "#1f1e2a", border: "1px solid #34324a", borderRadius: 12, padding: 10, minHeight: 600 }} dangerouslySetInnerHTML={{ __html: diagram?.svg ?? "" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 14 }}>
          {CHECKOUT_RISKS.map((risk, index) => (
            <Risk key={risk.title} {...risk} at={RISKS_AT + index * RISK_GAP} seconds={secondsIn} />
          ))}
        </div>
      </div>
      {/* After the diagram, so these rules win over Mermaid's own where they tie. */}
      {diagram && <style>{drawnSoFar(diagram, secondsIn, fps)}</style>}
    </AbsoluteFill>
  );
}
