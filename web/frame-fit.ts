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
 * A frame as tall as its content; content wider than the room is drawn at its own width and scaled down to fit, so none
 * of it is cut off. The text size Settings chose zooms the page inside the frame, where the text is drawn at its size:
 * scaling the frame up would show it blurred on a 1x screen.
 */
export function fittedStyles(contentSize: ContentSize | undefined, roomWidth: number): FrameStyles {
  if (!contentSize) return {};
  const { width, height } = contentSize;
  if (!width || !roomWidth || width + FRAME_BORDERS <= roomWidth) return { frame: { height } };
  const scale = roomWidth / (width + FRAME_BORDERS);
  return {
    box: { height: Math.ceil((height + FRAME_BORDERS) * scale) },
    frame: { position: "absolute", width, height, transform: `scale(${scale})`, transformOrigin: "0 0" },
  };
}
