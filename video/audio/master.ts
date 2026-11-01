import { spawnSync } from "node:child_process";
import { join } from "node:path";

/**
 * Masters the rendered trailer's sound to YouTube's loudness, -14 LUFS with 1.5 dB of headroom, in two passes of
 * ffmpeg's loudnorm: one measures, the other applies. The picture is copied untouched.
 * Run with bun after the render: bun audio/master.ts
 */
const TARGET = "I=-14:TP=-1.5:LRA=11";
const video = join(import.meta.dirname, "..");
const rendered = join(video, "out", "render.mp4");
const mastered = join(video, "out", "mirador-trailer.mp4");

function ffmpeg(args: string[]) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr.slice(-2000)}`);
  return result.stderr;
}

type Measured = { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string };

function measure(path: string): Measured {
  const report = ffmpeg(["-i", path, "-af", `loudnorm=${TARGET}:print_format=json`, "-f", "null", "-"]);
  return JSON.parse(report.slice(report.lastIndexOf("{"), report.lastIndexOf("}") + 1)) as Measured;
}

if (import.meta.main) {
  const before = measure(rendered);
  const applied = `loudnorm=${TARGET}:measured_I=${before.input_i}:measured_TP=${before.input_tp}:measured_LRA=${before.input_lra}:measured_thresh=${before.input_thresh}:offset=${before.target_offset}:linear=true`;
  ffmpeg(["-y", "-i", rendered, "-c:v", "copy", "-af", applied, "-ar", "48000", "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", mastered]);
  const after = measure(mastered);
  console.log(`${mastered}: ${before.input_i} LUFS, peak ${before.input_tp} dBTP before; ${after.input_i} LUFS, peak ${after.input_tp} dBTP after`);
}
