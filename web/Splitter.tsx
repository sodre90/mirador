import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { SplitAxis } from "../shared/terminal-layout.ts";
import { hints } from "./hints.ts";

const MIN_PANEL_WIDTH = 240;
const KEYBOARD_STEP = 0.03;

export type { SplitAxis };

/** Where the two panes start and how much room they take together with the divider, along the axis. */
export interface SplitArea {
  start: number;
  size: number;
}

const startOf = (rect: DOMRect, axis: SplitAxis) => (axis === "columns" ? rect.left : rect.top);
const sizeOf = (rect: DOMRect, axis: SplitAxis) => (axis === "columns" ? rect.width : rect.height);

/**
 * Divides two panes: side by side for columns, one above the other for rows. `share` is the first pane's part of
 * the room they share. Without `area`, the two panes are the divider's previous and next siblings. With `onDrag`,
 * a pointer drag shows its shares there and `onChange` gets only the last one, so a costly owner updates once.
 */
export function Splitter({
  share,
  onChange,
  onDrag,
  label,
  resetShare,
  axis = "columns",
  minimumSize = MIN_PANEL_WIDTH,
  secondMinimumSize = minimumSize,
  area,
  style,
}: {
  share: number;
  onChange: (share: number) => void;
  onDrag?: (share: number) => void;
  label: string;
  resetShare: number;
  axis?: SplitAxis;
  minimumSize?: number;
  /** The second pane's own minimum, when it needs more room than the first. */
  secondMinimumSize?: number;
  area?: () => SplitArea;
  style?: CSSProperties;
}) {
  const handle = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const draggedShare = useRef<number | null>(null);

  useEffect(() => {
    document.body.classList.toggle("resizing", dragging);
    document.body.classList.toggle("resizing-rows", dragging && axis === "rows");
  }, [dragging, axis]);

  const siblingArea = (): SplitArea => {
    const first = handle.current!.previousElementSibling!.getBoundingClientRect();
    const second = handle.current!.nextElementSibling!.getBoundingClientRect();
    return { start: startOf(first, axis), size: startOf(second, axis) + sizeOf(second, axis) - startOf(first, axis) };
  };

  const room = () => {
    const { start, size } = area?.() ?? siblingArea();
    const divider = sizeOf(handle.current!.getBoundingClientRect(), axis);
    return { start: start + divider / 2, size: size - divider };
  };

  const withinLimits = (next: number) => {
    const { size } = room();
    const firstMinimumShare = Math.min(minimumSize / size, 0.5);
    const secondMinimumShare = Math.min(secondMinimumSize / size, 0.5);
    return Math.min(Math.max(next, firstMinimumShare), 1 - secondMinimumShare);
  };

  const shareAtPointer = (event: PointerEvent<HTMLDivElement>) => {
    const { start, size } = room();
    return withinLimits(((axis === "columns" ? event.clientX : event.clientY) - start) / size);
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    handle.current!.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const next = shareAtPointer(event);
    if (!onDrag) return onChange(next);
    draggedShare.current = next;
    onDrag(next);
  };

  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
    handle.current!.releasePointerCapture(event.pointerId);
    setDragging(false);
    if (draggedShare.current !== null) onChange(draggedShare.current);
    draggedShare.current = null;
  };

  const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = axis === "columns" ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
    const direction = keys[event.key];
    if (!direction) return;
    event.preventDefault();
    onChange(withinLimits(share + direction * KEYBOARD_STEP));
  };

  return (
    <div
      ref={handle}
      className={`splitter ${axis} ${dragging ? "dragging" : ""}`}
      style={style}
      role="separator"
      aria-orientation={axis === "columns" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={Math.round(share * 100)}
      tabIndex={0}
      data-hint={hints.splitter}
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onDoubleClick={() => onChange(resetShare)}
      onKeyDown={nudge}
    />
  );
}
