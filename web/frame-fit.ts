import type { CSSProperties } from "react";

export interface ContentSize {
  height: number;
  /** The width the content asked for when it overflowed; kept once known, as the frame drawn that wide reports no overflow. */
  width: number | null;
}

/** The fitted frames (a question's page and its option previews) have a 1px border. */
export const FRAME_BORDERS = 2;

export interface FrameStyles {
  box?: CSSProperties;
  frame?: CSSProperties;
}

/**
 * A frame as tall as its content. Zoomed by the text size Settings chose, it lays its page out in the room divided by
 * the zoom and is scaled up to fill it, so the page keeps its own px, vw and vh. Content too wide for the room at that
 * zoom is scaled to fit the room instead, and the zoom then stops applying: a larger text size leaves it as it is, so
 * a wide preview shows whole rather than growing.
 */
export function fittedStyles(contentSize: ContentSize | undefined, roomWidth: number, zoom = 1): FrameStyles {
  if (!contentSize) return {};
  const { width, height } = contentSize;
  if (!roomWidth) return { frame: { height } };
  const fitsZoomed = !width || (width + FRAME_BORDERS) * zoom <= roomWidth;
  if (fitsZoomed && zoom === 1) return { frame: { height } };
  const scale = fitsZoomed ? zoom : roomWidth / (width + FRAME_BORDERS);
  return {
    box: { height: Math.ceil((height + FRAME_BORDERS) * scale) },
    frame: { position: "absolute", width: fitsZoomed ? roomWidth / zoom - FRAME_BORDERS : width, height, transform: `scale(${scale})`, transformOrigin: "0 0" },
  };
}

/**
 * A frame that fills its box, zoomed as a fitted one is: laid out in the box divided by the zoom, and scaled up to fill
 * it. The box needs a height of its own, as the shown page's `flex: 1` gives it: the frame is out of flow, so its
 * percentage height resolves against the box, and a content-sized box would collapse.
 */
export function filledStyles(zoom: number): FrameStyles {
  if (zoom === 1) return {};
  const share = `${100 / zoom}%`;
  return {
    box: { position: "relative", overflow: "hidden" },
    frame: { position: "absolute", top: 0, left: 0, width: share, height: share, transform: `scale(${zoom})`, transformOrigin: "0 0" },
  };
}
