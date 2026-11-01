import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CDPSession, Locator, Page } from "@playwright/test";
import { FRAME } from "./frame.ts";

/** A frame the browser presented, by its file and when it was presented, in epoch milliseconds. */
export type ShotFrame = { file: string; at: number };

/** A box on the page, in the page's own points (1536 x 864). */
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * What the edit needs to know about a clip: how long it runs, when its moments happen, in seconds from its start, and
 * where the things the camera moves to are.
 */
export type ClipInfo = { name: string; seconds: number; moments: Record<string, number>; rects: Record<string, Rect>; frames: number; medianGapMs: number; p95GapMs: number };

/** A scene that runs longer than this is stuck; its frames would fill the disk at about 40 MB a second. */
const LONGEST_CLIP_SECONDS = 60;

/** Width and height from a JPEG's start-of-frame header. */
function jpegSize(data: Buffer) {
  for (let offset = 2; offset < data.length; ) {
    const marker = data[offset + 1]!;
    if (marker === 0xc0 || marker === 0xc2) return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    offset += 2 + data.readUInt16BE(offset + 2);
  }
  return { width: 0, height: 0 };
}

/**
 * Records the page as the 4K frames the browser hands over whenever the picture changes, each with the moment it was
 * presented, and names moments as they happen ("canvas shown"), so the edit can key zooms and captions to them.
 * Encoding is a later step: it would slow the browser down while it is being filmed.
 */
export class ClipRecorder {
  private frames: ShotFrame[] = [];
  private moments: Record<string, number> = {};
  private rects: Record<string, Rect> = {};
  private directory = "";
  private name = "";
  private devtools?: CDPSession;
  private wrongSizes = 0;

  constructor(
    private readonly page: Page,
    private readonly clipsDirectory: string,
  ) {}

  async start(name: string) {
    this.name = name;
    this.directory = join(this.clipsDirectory, `${name}.frames`);
    rmSync(this.directory, { recursive: true, force: true });
    mkdirSync(this.directory, { recursive: true });
    this.frames = [];
    this.moments = {};
    this.rects = {};
    this.wrongSizes = 0;
    const devtools = await this.page.context().newCDPSession(this.page);
    this.devtools = devtools;
    devtools.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      void devtools.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      if (this.frames.length > 0 && metadata.timestamp! * 1000 - this.frames[0]!.at > LONGEST_CLIP_SECONDS * 1000) return;
      const image = Buffer.from(data, "base64");
      const file = `${String(this.frames.length).padStart(6, "0")}.jpg`;
      writeFileSync(join(this.directory, file), image);
      this.frames.push({ file, at: metadata.timestamp! * 1000 });
      const { width, height } = jpegSize(image);
      if (width !== FRAME.width || height !== FRAME.height) this.wrongSizes += 1;
    });
    await devtools.send("Page.startScreencast", { format: "jpeg", quality: 94, maxWidth: FRAME.width, maxHeight: FRAME.height });
  }

  /** Names this moment of the clip. */
  mark(moment: string) {
    this.moments[moment] = Date.now();
  }

  /** Remembers where something is, for the camera to move to. */
  async markRect(name: string, target: Locator) {
    const box = await target.boundingBox();
    if (!box) throw new Error(`${this.name}: ${name} is not on the page`);
    this.rects[name] = box;
  }

  /** Stops filming; the last frame lasts until now, so a still ending keeps its length. */
  async stop(): Promise<ClipInfo> {
    const stoppedAt = Date.now();
    await this.devtools!.send("Page.stopScreencast");
    await this.devtools!.detach();
    const frames = this.frames;
    if (frames.length === 0) throw new Error(`${this.name}: the browser handed over no frames`);
    if (stoppedAt - frames[0]!.at > LONGEST_CLIP_SECONDS * 1000) throw new Error(`${this.name}: ran over ${LONGEST_CLIP_SECONDS} s, so the scene is stuck`);
    if (this.wrongSizes > 0) throw new Error(`${this.name}: ${this.wrongSizes} frames were not ${FRAME.width}x${FRAME.height}`);
    const startedAt = frames[0]!.at;
    writeFileSync(join(this.directory, "frames.json"), JSON.stringify({ frames, endsAt: stoppedAt }));
    const gaps = frames.slice(1).map((frame, index) => frame.at - frames[index]!.at).sort((a, b) => a - b);
    const info: ClipInfo = {
      name: this.name,
      seconds: (stoppedAt - startedAt) / 1000,
      rects: this.rects,
      moments: Object.fromEntries(Object.entries(this.moments).map(([moment, at]) => [moment, Math.max(0, (at - startedAt) / 1000)])),
      frames: frames.length,
      medianGapMs: Math.round(gaps[Math.floor(gaps.length / 2)] ?? 0),
      p95GapMs: Math.round(gaps[Math.floor(gaps.length * 0.95)] ?? 0),
    };
    writeFileSync(join(this.clipsDirectory, `${this.name}.json`), JSON.stringify(info, null, 2));
    return info;
  }
}
