import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { isCanvasFrameMessage } from "../shared/canvas-document.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { DEFAULT_LEFT_SHARE, DEFAULT_TOP_SHARE, placement, swapPanes, type PaneId, type PaneLayout } from "./layout.ts";
import { Splitter, type SplitAxis } from "./Splitter.tsx";

const panes = t.shell.panes;

const MIN_PANE_WIDTH = 240;
const MIN_PANE_HEIGHT = 120;
/** Its header, the last lines of the timeline and the composer. */
const MIN_CONVERSATION_HEIGHT = 300;
const minimumHeightOf = (pane: PaneId) => (pane === "conversation" ? MIN_CONVERSATION_HEIGHT : MIN_PANE_HEIGHT);
const paneOrder: PaneId[] = ["conversation", "canvas", "terminals"];
const NOT_A_BAR_BACKGROUND = "button, a, input, select, textarea, label, [role=tab], [role=separator], [role=dialog], .renamable, [contenteditable]";

interface PaneControls {
  fullscreen: PaneId | null;
  toggleFullscreen: (pane: PaneId) => void;
  setFullscreen: (pane: PaneId | null) => void;
  startMove: (pane: PaneId, event: ReactPointerEvent<HTMLElement>) => void;
}

const PaneControlsContext = createContext<PaneControls | null>(null);

const paneUnder = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pane]")?.dataset.pane as PaneId | undefined) ?? null;

/** The ⋮⋮ in a pane's bar: drag it onto another pane to swap the two. */
export function PaneGrip({ pane }: { pane: PaneId }) {
  const controls = useContext(PaneControlsContext);
  if (!controls) return null;
  return (
    <button
      type="button"
      className="icon pane-grip"
      aria-label={panes.move(panes.names[pane])}
      data-hint={hints.paneGrip}
      onPointerDown={(event) => controls.startMove(pane, event)}
    >
      ⋮⋮
    </button>
  );
}

/** Whether the pane fills the workspace, and a way to change that; null outside a workspace area. */
export function usePaneFullscreen(pane: PaneId) {
  const controls = useContext(PaneControlsContext);
  if (!controls) return null;
  return { isFullscreen: controls.fullscreen === pane, setFullscreen: (on: boolean) => controls.setFullscreen(on ? pane : null) };
}

export function FullscreenToggle({ pane }: { pane: PaneId }) {
  const controls = useContext(PaneControlsContext);
  if (!controls) return null;
  const isFullscreen = controls.fullscreen === pane;
  return (
    <button
      type="button"
      className={`icon pane-fullscreen ${isFullscreen ? "on" : ""}`}
      aria-label={isFullscreen ? panes.exitFullscreen : panes.fullscreen(panes.names[pane])}
      aria-pressed={isFullscreen}
      data-hint={isFullscreen ? hints.paneExitFullscreen : hints.paneFullscreen}
      onClick={() => controls.toggleFullscreen(pane)}
    >
      ⛶
    </button>
  );
}

function useFullscreen(
  area: RefObject<HTMLDivElement | null>,
  layout: PaneLayout,
  shown: Record<PaneId, boolean>,
  onChange: (update: (layout: PaneLayout) => PaneLayout) => void,
) {
  const fullscreen = layout.fullscreen && shown[layout.fullscreen] ? layout.fullscreen : null;
  const setFullscreen = (pane: PaneId | null) => onChange((current) => ({ ...current, fullscreen: pane }));

  useEffect(() => {
    if (!fullscreen) return;
    const dialogOpen = () => document.querySelector(".modal-backdrop") !== null;
    const restoreOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || dialogOpen()) return;
      const target = event.target as Node;
      const keptByTerminal = target instanceof Element && target.closest(".terminal-pane");
      if ((target === document.body || area.current?.contains(target)) && !keptByTerminal) setFullscreen(null);
    };
    const restoreOnCanvasPageEscape = (event: MessageEvent) => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLIFrameElement) || event.source !== focused.contentWindow || !area.current?.contains(focused)) return;
      if (isCanvasFrameMessage(event.data) && event.data.kind === "key" && event.data.key === "Escape" && !event.data.typing && !dialogOpen()) setFullscreen(null);
    };
    window.addEventListener("keydown", restoreOnEscape);
    window.addEventListener("message", restoreOnCanvasPageEscape);
    return () => {
      window.removeEventListener("keydown", restoreOnEscape);
      window.removeEventListener("message", restoreOnCanvasPageEscape);
    };
  }, [fullscreen, onChange]);

  const toggleFullscreen = (pane: PaneId) => setFullscreen(fullscreen === pane ? null : pane);
  return { fullscreen, toggleFullscreen, setFullscreen };
}

/** Swapping by dragging a grip uses pointer events rather than HTML drag and drop, so it keeps working over the canvas iframe. */
function useMovePane(onChange: (update: (layout: PaneLayout) => PaneLayout) => void) {
  const [moving, setMoving] = useState<{ pane: PaneId; over: PaneId | null } | null>(null);

  const startMove = (pane: PaneId, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    let over: PaneId | null = null;
    setMoving({ pane, over });
    document.body.classList.add("moving-pane");
    const follow = (move: PointerEvent) => {
      const under = paneUnder(move.clientX, move.clientY);
      over = under === pane ? null : under;
      setMoving({ pane, over });
    };
    const finish = (swap: boolean) => {
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", cancelOnEscape, true);
      document.body.classList.remove("moving-pane");
      const target = over;
      if (swap && target) onChange((layout) => swapPanes(layout, pane, target));
      setMoving(null);
    };
    const drop = () => finish(true);
    const cancel = () => finish(false);
    const cancelOnEscape = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      key.stopPropagation();
      cancel();
    };
    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", cancelOnEscape, true);
  };

  return { moving, startMove };
}

/**
 * The workspace's three panes in three places: left, right top and right bottom. They are rendered in a fixed order
 * and only their grid areas change, so moving or hiding one never reloads another (the canvas page, a terminal). A pane
 * hidden with something kept out of sight stays in its place, so showing it again doesn't reload that either.
 */
export function WorkspaceArea({
  layout,
  onChange,
  content,
  keptOutOfSight = {},
}: {
  layout: PaneLayout;
  onChange: (update: (layout: PaneLayout) => PaneLayout) => void;
  content: Record<PaneId, ReactNode | null>;
  keptOutOfSight?: Partial<Record<PaneId, ReactNode>>;
}) {
  const area = useRef<HTMLDivElement>(null);
  const shown = { conversation: content.conversation !== null, canvas: content.canvas !== null, terminals: content.terminals !== null };
  const { fullscreen, toggleFullscreen, setFullscreen } = useFullscreen(area, layout, shown, onChange);
  const { moving, startMove } = useMovePane(onChange);
  const [dragged, setDragged] = useState<Partial<Pick<PaneLayout, "leftShare" | "topShare">>>({});
  const shownLayout = { ...layout, ...dragged };
  const { columns, rows, areas, columnDivider, rowDivider, topLeft } = placement(shownLayout, shown, fullscreen);
  const commitShares = (shares: Partial<Pick<PaneLayout, "leftShare" | "topShare">>) => {
    setDragged({});
    onChange((current) => ({ ...current, ...shares }));
  };

  const areaAlong = (axis: SplitAxis) => () => {
    const rect = area.current!.getBoundingClientRect();
    return axis === "columns" ? { start: rect.left, size: rect.width } : { start: rect.top, size: rect.height };
  };

  const fullscreenFromBar = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    const bar = target.closest("[data-pane-bar]");
    if (!bar || target.closest(NOT_A_BAR_BACKGROUND)) return;
    const pane = bar.closest<HTMLElement>("[data-pane]")?.dataset.pane as PaneId | undefined;
    if (pane) toggleFullscreen(pane);
  };

  const paneClass = (pane: PaneId) =>
    ["pane", topLeft === pane && "top-left", fullscreen === pane && "fullscreen", moving?.pane === pane && "moving", moving?.over === pane && "drop-target"].filter(Boolean).join(" ");

  return (
    <PaneControlsContext.Provider value={{ fullscreen, toggleFullscreen, setFullscreen, startMove }}>
      <div ref={area} className="workspace-area" style={{ gridTemplateColumns: columns, gridTemplateRows: rows }} onDoubleClick={fullscreenFromBar}>
        {paneOrder.map((pane) =>
          content[pane] !== null ? (
            <div key={pane} data-pane={pane} className={paneClass(pane)} style={{ gridArea: areas[pane] }} inert={fullscreen !== null && fullscreen !== pane}>
              {content[pane]}
            </div>
          ) : (
            keptOutOfSight[pane] && (
              <div key={pane} data-pane={pane} className="pane" style={{ display: "none" }} inert>
                {keptOutOfSight[pane]}
              </div>
            )
          ),
        )}
        {columnDivider && (
          <Splitter
            key="columns"
            style={{ gridArea: columnDivider }}
            share={shownLayout.leftShare}
            onDrag={(leftShare) => setDragged({ leftShare })}
            onChange={(leftShare) => commitShares({ leftShare })}
            label={panes.resizeColumns}
            resetShare={DEFAULT_LEFT_SHARE}
            minimumSize={MIN_PANE_WIDTH}
            area={areaAlong("columns")}
          />
        )}
        {rowDivider && (
          <Splitter
            key="rows"
            style={{ gridArea: rowDivider }}
            share={shownLayout.topShare}
            onDrag={(topShare) => setDragged({ topShare })}
            onChange={(topShare) => commitShares({ topShare })}
            label={panes.resizeRows}
            resetShare={DEFAULT_TOP_SHARE}
            axis="rows"
            minimumSize={minimumHeightOf(shownLayout.slots[1])}
            secondMinimumSize={minimumHeightOf(shownLayout.slots[2])}
            area={areaAlong("rows")}
          />
        )}
      </div>
    </PaneControlsContext.Provider>
  );
}
