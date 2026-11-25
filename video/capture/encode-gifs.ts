import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClipInfo, ShotFrame } from "./recorder.ts";

/**
 * Turns the light-theme GIF clips in video/public/gif-clips into crisp, fast-loading, looping GIFs in docs/gifs/*.gif.
 * Uses ffmpeg two-pass palettegen (stats_mode=diff) + paletteuse (bayer dither, diff_mode=rectangle) at 1024px wide
 * and 12 fps, smoothly accelerating typing/waiting segments and holding the final payoff frame for ~2.2 seconds.
 */
const repoRoot = join(import.meta.dirname, "..", "..");
const clipsDir = join(import.meta.dirname, "..", "public", "gif-clips");
const outDir = join(repoRoot, "docs", "gifs");
const GIF_FPS = 12;
const GIF_WIDTH = 1024;

type Segment = { from: number | string; to: number | string; speed: number };
type GifSpec = { name: string; segments: Segment[]; holdSeconds: number };

const SPECS: GifSpec[] = [
  {
    name: "show-and-point",
    segments: [
      { from: 0, to: "shown", speed: 2.2 },
      { from: "shown", to: "pointing", speed: 1.0 },
      { from: "pointing", to: "asked", speed: 2.0 },
      { from: "asked", to: "done", speed: 1.4 },
      { from: "done", to: "end", speed: 1.0 },
    ],
    holdSeconds: 2.2,
  },
  {
    name: "ask",
    segments: [
      { from: 0, to: "picked", speed: 1.3 },
      { from: "picked", to: "done", speed: 1.3 },
      { from: "done", to: "end", speed: 1.0 },
    ],
    holdSeconds: 2.0,
  },
  {
    name: "tour",
    segments: [
      { from: 0, to: "opened", speed: 2.2 },
      { from: "opened", to: "step1", speed: 1.2 },
      { from: "step1", to: "step2", speed: 1.0 },
      { from: "step2", to: "done", speed: 1.0 },
      { from: "done", to: "end", speed: 1.0 },
    ],
    holdSeconds: 2.0,
  },
  {
    name: "review",
    segments: [
      { from: 0, to: "opened", speed: 2.2 },
      { from: "opened", to: "flow", speed: 1.4 },
      { from: "flow", to: "asked", speed: 2.1 },
      { from: "asked", to: "done", speed: 1.3 },
      { from: "done", to: "end", speed: 1.0 },
    ],
    holdSeconds: 2.2,
  },
  {
    name: "changes",
    segments: [
      { from: 0, to: "approval", speed: 2.2 },
      { from: "approval", to: "approved", speed: 1.0 },
      { from: "approved", to: "done", speed: 1.5 },
      { from: "done", to: "end", speed: 1.0 },
    ],
    holdSeconds: 2.2,
  },
  {
    name: "side-chat",
    segments: [
      { from: 0, to: "opened", speed: 1.8 },
      { from: "opened", to: "done", speed: 1.2 },
      { from: "done", to: "end", speed: 1.0 },
    ],
    holdSeconds: 2.2,
  },
  {
    name: "delegate",
    segments: [
      { from: 0, to: "delegated", speed: 2.2 },
      { from: "delegated", to: "unfolded", speed: 1.2 },
      { from: "unfolded", to: "done", speed: 2.2 },
      { from: "done", to: "end", speed: 1.0 },
    ],
    holdSeconds: 2.2,
  },
];

function resolveTime(info: ClipInfo, point: number | string) {
  if (typeof point === "number") return point;
  if (point === "end") return info.seconds;
  const at = info.moments[point];
  if (at === undefined) throw new Error(`${info.name} has no moment "${point}" (has ${Object.keys(info.moments).join(", ")})`);
  return at;
}

function sampleFiles(frames: ShotFrame[], info: ClipInfo, spec: GifSpec) {
  const startedAt = frames[0]!.at;
  const frameAt = (seconds: number) => {
    const target = startedAt + seconds * 1000;
    let index = 0;
    while (index + 1 < frames.length && frames[index + 1]!.at <= target) index++;
    return frames[index]!.file;
  };
  const chosen: string[] = [];
  for (const segment of spec.segments) {
    const from = resolveTime(info, segment.from);
    const to = resolveTime(info, segment.to);
    if (to <= from) continue;
    const outSeconds = (to - from) / segment.speed;
    const count = Math.max(1, Math.round(outSeconds * GIF_FPS));
    for (let tick = 0; tick < count; tick++) {
      const t = from + ((tick / GIF_FPS) * segment.speed);
      chosen.push(frameAt(Math.min(to, t)));
    }
  }
  const holdFrames = Math.round(spec.holdSeconds * GIF_FPS);
  const lastFile = chosen.at(-1) ?? frames.at(-1)!.file;
  for (let i = 0; i < holdFrames; i++) chosen.push(lastFile);
  return chosen;
}

function encodeGif(spec: GifSpec) {
  const infoPath = join(clipsDir, `${spec.name}.json`);
  const framesDir = join(clipsDir, `${spec.name}.frames`);
  if (!existsSync(infoPath) || !existsSync(join(framesDir, "frames.json"))) {
    console.log(`Skipping ${spec.name}: not filmed yet`);
    return;
  }
  const info = JSON.parse(readFileSync(infoPath, "utf8")) as ClipInfo;
  const { frames } = JSON.parse(readFileSync(join(framesDir, "frames.json"), "utf8")) as { frames: ShotFrame[] };
  const chosen = sampleFiles(frames, info, spec);
  const listFile = join(tmpdir(), `mirador-gif-${spec.name}-${process.pid}.txt`);
  const paletteFile = join(tmpdir(), `mirador-palette-${spec.name}-${process.pid}.png`);
  const duration = (1 / GIF_FPS).toFixed(6);
  const concatBody = `${chosen.map((file) => `file '${join(framesDir, file)}'\nduration ${duration}`).join("\n")}\nfile '${join(framesDir, chosen.at(-1)!)}'\n`;
  writeFileSync(listFile, concatBody);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${spec.name}.gif`);
  const scale = `scale=${GIF_WIDTH}:-1:flags=lanczos`;

  const pass1 = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", `fps=${GIF_FPS},${scale},palettegen=max_colors=192:stats_mode=diff`, paletteFile],
    { encoding: "utf8" },
  );
  if (pass1.status !== 0) throw new Error(`palettegen failed for ${spec.name}: ${pass1.stderr}`);

  const pass2 = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-i",
      paletteFile,
      "-lavfi",
      `fps=${GIF_FPS},${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
      "-loop",
      "0",
      outPath,
    ],
    { encoding: "utf8" },
  );
  rmSync(listFile, { force: true });
  rmSync(paletteFile, { force: true });
  if (pass2.status !== 0) throw new Error(`paletteuse failed for ${spec.name}: ${pass2.stderr}`);
  const sizeMb = (statSync(outPath).size / (1024 * 1024)).toFixed(2);
  console.log(`${outPath}: ${(chosen.length / GIF_FPS).toFixed(1)} s (${chosen.length} frames @ ${GIF_FPS} fps), ${sizeMb} MB`);
  if (!process.env.MIRADOR_VIDEO_KEEP_FRAMES) rmSync(framesDir, { recursive: true, force: true });
}

if (import.meta.main) {
  const only = process.env.MIRADOR_GIFS?.split(",");
  for (const spec of SPECS) {
    if (only && !only.includes(spec.name)) continue;
    encodeGif(spec);
  }
}
