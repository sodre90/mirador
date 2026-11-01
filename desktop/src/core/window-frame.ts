import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

/** A window opened again has to be reachable: enough of its title bar on some display to grab it and drag it back. */
const GRABBABLE_TITLE_BAR = { width: 100, height: 30 };

const isWindowFrame = (value: unknown): value is WindowFrame => {
  if (typeof value !== "object" || value === null) return false;
  const { x, y, width, height } = value as Record<string, unknown>;
  return [x, y, width, height].every(Number.isFinite) && (width as number) > 0 && (height as number) > 0;
};

export function parseWindowFrame(text: string): WindowFrame | null {
  try {
    const parsed = JSON.parse(text);
    return isWindowFrame(parsed) ? { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height } : null;
  } catch {
    return null;
  }
}

const overlap = (start: number, length: number, otherStart: number, otherLength: number) =>
  Math.min(start + length, otherStart + otherLength) - Math.max(start, otherStart);

const titleBarIsOn = (frame: WindowFrame, workArea: WindowFrame) =>
  overlap(frame.x, frame.width, workArea.x, workArea.width) >= GRABBABLE_TITLE_BAR.width &&
  overlap(frame.y, GRABBABLE_TITLE_BAR.height, workArea.y, workArea.height) >= GRABBABLE_TITLE_BAR.height;

/**
 * The frame the window had last, unless no display shows its title bar any more, as when the display it was on is
 * gone. Then a size alone, which the window opens centred in. No displays means the system did not tell them.
 */
export function frameToOpenWith(saved: WindowFrame | null, workAreas: WindowFrame[], defaultSize: WindowSize): WindowFrame | WindowSize {
  if (!saved) return defaultSize;
  const reachable = workAreas.length === 0 || workAreas.some((workArea) => titleBarIsOn(saved, workArea));
  return reachable ? saved : defaultSize;
}

export function readWindowFrame(file: string): WindowFrame | null {
  try {
    return parseWindowFrame(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeWindowFrame(file: string, frame: WindowFrame) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(frame)}\n`);
}

/** Moving or resizing a window sends a stream of frames; only the one it comes to rest at is written. */
export class WindowFrameKeeper {
  private pending: WindowFrame | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly file: string,
    private readonly settleMs = 500,
  ) {}

  remember(frame: WindowFrame) {
    this.pending = frame;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.settleMs);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return;
    writeWindowFrame(this.file, this.pending);
    this.pending = null;
  }
}
