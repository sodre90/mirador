import type { Locator, Page } from "@playwright/test";

type Point = { x: number; y: number };

/**
 * A mouse pointer drawn into the page, since a headless browser draws none. It glides on a slight arc, the way a hand
 * moves a mouse, and pulses where it clicks. The real mouse follows the same path, so hovers light up as it passes.
 */
export class Cursor {
  private at: Point;

  constructor(
    private readonly page: Page,
    start: Point,
  ) {
    this.at = start;
  }

  /** Draws the pointer in every page the tab loads from now on, and puts it at its starting point. */
  async install() {
    await this.page.addInitScript(({ x, y }) => ((globalThis as unknown as PointerWindow).moviePointerStart = { x, y }), this.at);
    await this.page.addInitScript(drawPointer);
  }

  /** After a reload the page draws the pointer anew; this puts it back where it was. */
  async restore() {
    await this.page.evaluate(({ x, y }) => (window as unknown as PointerWindow).moviePointer?.place(x, y), this.at);
  }

  async glideTo(to: Point, milliseconds = glideTime(this.at, to)) {
    const from = this.at;
    const drawn = this.page.evaluate(({ to, milliseconds }) => (window as unknown as PointerWindow).moviePointer!.glide(to.x, to.y, milliseconds), { to, milliseconds });
    const steps = Math.max(1, Math.round(milliseconds / 50));
    for (let step = 1; step <= steps; step++) {
      const point = arcPoint(from, to, step / steps);
      await this.page.mouse.move(point.x, point.y);
      await sleep(milliseconds / steps);
    }
    await drawn;
    this.at = to;
  }

  async glideToElement(target: Locator, { offsetX = 0.5, offsetY = 0.5 } = {}) {
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!;
    await this.glideTo({ x: box.x + box.width * offsetX, y: box.y + box.height * offsetY });
  }

  async click(target?: Locator, options?: { offsetX?: number; offsetY?: number }) {
    if (target) {
      await this.glideToElement(target, options);
      await this.followIfMoved(target, options);
    }
    await sleep(120);
    await this.page.evaluate(() => (window as unknown as PointerWindow).moviePointer!.press());
    await this.page.mouse.down();
    await sleep(70);
    await this.page.mouse.up();
    await sleep(160);
  }

  /** The page can shift while the pointer travels; a hand then corrects its aim. */
  private async followIfMoved(target: Locator, { offsetX = 0.5, offsetY = 0.5 } = {}) {
    const box = (await target.boundingBox())!;
    const isInside = this.at.x >= box.x && this.at.x <= box.x + box.width && this.at.y >= box.y && this.at.y <= box.y + box.height;
    if (!isInside) await this.glideTo({ x: box.x + box.width * offsetX, y: box.y + box.height * offsetY }, 260);
  }

  /** Presses on one place and lets go on another, moving the way a hand drags. */
  async drag(to: Point) {
    await this.page.evaluate(() => (window as unknown as PointerWindow).moviePointer!.press());
    await this.page.mouse.down();
    await sleep(150);
    await this.glideTo(to, Math.max(700, glideTime(this.at, to) * 1.4));
    await sleep(150);
    await this.page.mouse.up();
  }

  get position() {
    return this.at;
  }
}

type PointerWindow = {
  moviePointerStart?: Point;
  moviePointer?: { place(x: number, y: number): void; glide(x: number, y: number, milliseconds: number): Promise<void>; press(): void };
};

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Longer moves take longer, but not proportionally: a hand speeds up over a long way. */
const glideTime = (from: Point, to: Point) => Math.round(380 + Math.sqrt(Math.hypot(to.x - from.x, to.y - from.y)) * 16);

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** A point on a path that bows a little to one side, as a wrist turning makes it. */
function arcPoint(from: Point, to: Point, progress: number): Point {
  const t = easeInOut(progress);
  const bow = Math.sin(Math.PI * t) * 0.08;
  return { x: from.x + (to.x - from.x) * t - (to.y - from.y) * bow, y: from.y + (to.y - from.y) * t + (to.x - from.x) * bow };
}

/** Runs in the page: the pointer, its glide on the same arc, and the pulse of a click. */
function drawPointer() {
  if (window.top !== window) return;
  const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const install = () => {
    const pointer = document.createElement("div");
    pointer.setAttribute("aria-hidden", "true");
    pointer.style.cssText = "position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;will-change:translate,scale;transform-origin:5px 2.5px;filter:drop-shadow(0 1.5px 2.5px rgba(0,0,0,.35))";
    pointer.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 2.5v17.2l4.3-4.1 2.9 6.6 3-1.3-2.9-6.5h6z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(pointer);
    const state = { x: 0, y: 0 };
    const place = (x: number, y: number) => {
      state.x = x;
      state.y = y;
      // The individual translate property, not transform: the click pulse animates scale, which CSS applies before
      // transform, so a position held in transform would make the pulse pull the pointer toward the page's corner.
      pointer.style.translate = `${x - 5}px ${y - 2.5}px`;
    };
    const glide = (x: number, y: number, milliseconds: number) =>
      new Promise<void>((resolve) => {
        const from = { ...state };
        const started = performance.now();
        const frame = (now: number) => {
          const progress = Math.min(1, (now - started) / milliseconds);
          const t = easeInOut(progress);
          const bow = Math.sin(Math.PI * t) * 0.08;
          place(from.x + (x - from.x) * t - (y - from.y) * bow, from.y + (y - from.y) * t + (x - from.x) * bow);
          if (progress < 1) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
    const press = () => {
      const ring = document.createElement("div");
      ring.style.cssText = `position:fixed;left:${state.x - 18}px;top:${state.y - 18}px;width:36px;height:36px;border-radius:50%;z-index:2147483646;pointer-events:none;background:rgba(110,86,207,.28);border:2px solid rgba(110,86,207,.85)`;
      document.documentElement.appendChild(ring);
      ring.animate([{ transform: "scale(.3)", opacity: 1 }, { transform: "scale(1.25)", opacity: 0 }], { duration: 520, easing: "cubic-bezier(.2,.7,.3,1)" }).finished.then(() => ring.remove());
      pointer.animate([{ scale: "1" }, { scale: ".82" }, { scale: "1" }], { duration: 260, easing: "ease-out" });
    };
    const start = (window as unknown as PointerWindow).moviePointerStart ?? { x: 0, y: 0 };
    place(start.x, start.y);
    (window as unknown as PointerWindow).moviePointer = { place, glide, press };
  };
  if (document.documentElement) install();
  else document.addEventListener("DOMContentLoaded", install);
}
