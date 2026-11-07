import type { Language } from "./i18n/languages.ts";

export const DIAGRAM_STEPS_PATH = "/diagram-steps.js";

export interface DiagramStepsWords {
  back: string;
  play: string;
  pause: string;
  next: string;
}

/** How long the dot takes along one arrow. */
const TRAVEL_MS = 850;
const SHORTEST_STEP_MS = 3000;
const READING_MS_PER_CHARACTER = 55;

const STYLE = `
.diagram-steps-bar{display:flex;gap:6px;align-items:flex-start;margin-top:8px}
.diagram-steps-bar button{font:inherit;font-size:13px;padding:3px 10px;border:1px solid light-dark(#c9c9d1,#44464d);border-radius:6px;background:light-dark(#fff,#24262b);color:inherit;cursor:pointer}
.diagram-steps-count{font-size:13px;margin:3px 0 0 6px;white-space:nowrap;opacity:.65}
.diagram-steps-say{flex:1;margin-left:6px;min-height:3em;font-size:14px}
.diagram-steps-dot{fill:light-dark(#2563eb,#6ea3ff)}
.diagram-stepping .node,.diagram-stepping path.flowchart-link{transition:opacity .25s}
.diagram-stepping .node:not(.diagram-step-on){opacity:.35}
.diagram-stepping path.flowchart-link:not(.diagram-step-on){opacity:.18}
.node.diagram-step-on :is(rect,polygon,circle,ellipse,path){stroke:light-dark(#2563eb,#6ea3ff)!important;stroke-width:2.5px!important}
path.flowchart-link.diagram-step-on{stroke:light-dark(#2563eb,#6ea3ff)!important;stroke-width:2.5px!important}
`;

/**
 * The step player of a Mermaid flowchart, for canvas pages and the files saved from them: it works by Mermaid's element
 * ids and classes, which e2e/canvas-steps.spec.ts guards at each Mermaid upgrade. A step
 * that names what the diagram doesn't have throws, so the agent hears of it through the page's script errors.
 */
export const diagramStepsScript = (words: Record<Language, DiagramStepsWords>) => `(() => {
  const WORDS = ${JSON.stringify(words)};
  const tag = document.documentElement.dataset.miradorLanguage || navigator.language || "en";
  const word = WORDS[tag.toLowerCase().split("-")[0]] || WORDS.en;
  const style = document.createElement("style");
  style.textContent = ${JSON.stringify(STYLE)};

  const named = (diagram) => {
    const boxes = new Map();
    for (const box of diagram.querySelectorAll(".node")) {
      const id = /flowchart-(.+)-\\d+$/.exec(box.id);
      if (id) boxes.set(id[1], box);
    }
    const arrows = [...diagram.querySelectorAll("path.flowchart-link")];
    const drawnBetween = (from, to) => arrows.find((arrow) => {
      const dataId = arrow.getAttribute("data-id") || "";
      const prefix = "L_" + from + "_" + to + "_";
      return dataId.startsWith(prefix) && /^\\d+$/.test(dataId.slice(prefix.length));
    });
    const arrowNamed = (name) => {
      const ends = /^(.+?)-->(.+)$/.exec(name);
      if (!ends) {
        const path = arrows.find((arrow) => arrow.getAttribute("data-id") === name);
        return path && { path, backwards: false };
      }
      const forwards = drawnBetween(ends[1], ends[2]);
      if (forwards) return { path: forwards, backwards: false };
      const backwards = drawnBetween(ends[2], ends[1]);
      return backwards && { path: backwards, backwards: true };
    };
    return { boxes, arrowNamed };
  };

  const resolved = (steps, { boxes, arrowNamed }) => steps.map((step, index) => ({
    say: step.say || "",
    boxes: (step.boxes || []).map((name) => {
      const box = boxes.get(name);
      if (!box) throw new Error("Diagram steps: step " + (index + 1) + " names a box the diagram doesn't have: " + name + ". It has: " + [...boxes.keys()].join(", "));
      return box;
    }),
    arrows: (step.arrows || []).map((name) => {
      const arrow = arrowNamed(name);
      if (!arrow) throw new Error("Diagram steps: step " + (index + 1) + " names an arrow the diagram doesn't have: " + name);
      return arrow;
    }),
  }));

  const player = (diagram, source) => {
    const svg = diagram.querySelector(":scope > svg");
    const steps = resolved(JSON.parse(source.textContent), named(svg));
    if (steps.length === 0) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const bar = document.createElement("div");
    bar.className = "diagram-steps-bar";
    const button = (text, onClick) => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = text;
      element.addEventListener("click", onClick);
      bar.append(element);
      return element;
    };
    let current = 0;
    // Several diagrams moving at once compete for the reader, so only a page's one diagram starts by itself.
    let playing = !still && steps.length > 1 && document.querySelectorAll(".mermaid").length === 1;
    let timer;
    let trip = 0;
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("r", "6");
    dot.setAttribute("class", "diagram-steps-dot");
    dot.setAttribute("visibility", "hidden");

    const setPlaying = (next) => {
      playing = next;
      playButton.textContent = playing ? word.pause : word.play;
    };
    const travel = (arrows, thisTrip) => {
      if (still || arrows.length === 0) {
        dot.setAttribute("visibility", "hidden");
        return;
      }
      const [{ path, backwards }, ...rest] = arrows;
      path.parentNode.append(dot);
      dot.setAttribute("visibility", "visible");
      const length = path.getTotalLength();
      const start = performance.now();
      const frame = (now) => {
        if (thisTrip !== trip) return;
        const done = Math.min(1, (now - start) / ${TRAVEL_MS});
        const eased = done * done * (3 - 2 * done);
        const point = path.getPointAtLength(length * (backwards ? 1 - eased : eased));
        dot.setAttribute("cx", point.x);
        dot.setAttribute("cy", point.y);
        if (done < 1) requestAnimationFrame(frame);
        else travel(rest, thisTrip);
      };
      requestAnimationFrame(frame);
    };
    const go = (index) => {
      current = (index + steps.length) % steps.length;
      const step = steps[current];
      clearTimeout(timer);
      for (const lit of svg.querySelectorAll(".diagram-step-on")) lit.classList.remove("diagram-step-on");
      for (const box of step.boxes) box.classList.add("diagram-step-on");
      for (const arrow of step.arrows) arrow.path.classList.add("diagram-step-on");
      svg.classList.toggle("diagram-stepping", step.boxes.length + step.arrows.length > 0);
      say.textContent = step.say;
      count.textContent = current + 1 + " / " + steps.length;
      travel(step.arrows, ++trip);
      if (!playing) return;
      if (current === steps.length - 1) {
        setPlaying(false);
        return;
      }
      timer = setTimeout(() => go(current + 1), Math.max(${SHORTEST_STEP_MS}, step.say.length * ${READING_MS_PER_CHARACTER}) + step.arrows.length * ${TRAVEL_MS});
    };

    button(word.back, () => {
      setPlaying(false);
      go(current - 1);
    });
    const playButton = button(playing ? word.pause : word.play, () => {
      if (playing) {
        clearTimeout(timer);
        setPlaying(false);
        return;
      }
      setPlaying(true);
      go(current === steps.length - 1 ? 0 : current + 1);
    });
    button(word.next, () => {
      setPlaying(false);
      go(current + 1);
    });
    const count = document.createElement("span");
    count.className = "diagram-steps-count";
    const say = document.createElement("div");
    say.className = "diagram-steps-say";
    say.setAttribute("aria-live", "polite");
    bar.append(count, say);
    source.after(bar);
    go(0);
  };

  /** A script loaded from another origin has its errors hidden from the page, but what it logs as an error still reaches the agent. */
  const reportingProblems = (work) => {
    try {
      work();
    } catch (error) {
      console.error(error.message);
    }
  };

  const whenDrawn = (source) => {
    const diagram = source.previousElementSibling;
    if (!diagram || !diagram.classList.contains("mermaid")) throw new Error('Diagram steps: <script class="diagram-steps"> must come right after its <pre class="mermaid">');
    // While it draws, Mermaid keeps an unfinished svg deeper inside; the finished one takes the diagram's place as its child.
    const isDrawn = () => diagram.querySelector(":scope > svg");
    if (isDrawn()) return player(diagram, source);
    const drawing = new MutationObserver(() => {
      if (!isDrawn()) return;
      drawing.disconnect();
      reportingProblems(() => player(diagram, source));
    });
    drawing.observe(diagram, { childList: true });
  };

  const start = () => {
    document.head.append(style);
    document.querySelectorAll("script.diagram-steps").forEach((source) => reportingProblems(() => whenDrawn(source)));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
`;
