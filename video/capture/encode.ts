import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FRAME } from "./frame.ts";
import type { ShotFrame } from "./recorder.ts";

/**
 * Turns each clip's frames into a 60 fps video: every tick of the 60 fps clock shows the newest frame the browser had
 * presented by then, so the clip plays at the speed it was filmed and its moments land on the right frames. The frames
 * go once their clip is encoded; a capture's frames take about 10 MB a second.
 * Run with bun after the capture: bun capture/encode.ts [clips directory]
 */
const clipsDirectory = process.argv[2] ?? join(import.meta.dirname, "..", "public", "clips");

/** For each tick of the clock, the frame on screen then. */
export function framesOnTheClock(frames: ShotFrame[], endsAt: number, fps: number) {
  const startsAt = frames[0]!.at;
  const ticks = Math.max(1, Math.round(((endsAt - startsAt) / 1000) * fps));
  let shown = 0;
  return Array.from({ length: ticks }, (_, tick) => {
    const at = startsAt + (tick * 1000) / fps;
    while (shown + 1 < frames.length && frames[shown + 1]!.at <= at) shown += 1;
    return frames[shown]!.file;
  });
}

async function encode(directory: string, output: string) {
  const { frames, endsAt } = JSON.parse(readFileSync(join(directory, "frames.json"), "utf8")) as { frames: ShotFrame[]; endsAt: number };
  const ticks = framesOnTheClock(frames, endsAt, FRAME.fps);
  const ffmpeg = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FRAME.fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output], { stdio: ["pipe", "inherit", "inherit"] });
  const finished = new Promise<void>((resolve, reject) => ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed on ${output}`)))));
  for (const file of ticks) {
    if (!ffmpeg.stdin.write(readFileSync(join(directory, file)))) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
  }
  ffmpeg.stdin.end();
  await finished;
  return ticks.length;
}

if (import.meta.main) {
  const frameFolders = readdirSync(clipsDirectory).filter((name) => name.endsWith(".frames") && existsSync(join(clipsDirectory, name, "frames.json")));
  for (const folder of frameFolders) {
    const output = join(clipsDirectory, folder.replace(/\.frames$/, ".mp4"));
    const started = Date.now();
    const ticks = await encode(join(clipsDirectory, folder), output);
    console.log(`${output}: ${ticks} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`);
    if (!process.env.MIRADOR_VIDEO_KEEP_FRAMES) rmSync(join(clipsDirectory, folder), { recursive: true, force: true });
  }
}
