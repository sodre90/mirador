import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { LINES, SAMPLE_VOICES, SPEED, textOf, VOICE, voiceOf, type LineName } from "./lines.ts";

/**
 * Speaks the narration with Kokoro, an open-weight voice model that runs on this machine, into public/narration, and
 * records each line's length in its manifest, which the trailer is timed by. A line is spoken again only when its
 * words, the voice or the pace changed. With --samples, speaks one line in each of a few voices into out/voice-samples.
 */
const MODEL = {
  directory: join(homedir(), ".cache", "mirador-video", "kokoro-v1.0"),
  files: [
    { name: "kokoro-v1.0.onnx", sha256: "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5" },
    { name: "voices-v1.0.bin", sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d" },
  ],
  release: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0",
};
const PYTHON_PACKAGES = ["kokoro-onnx==0.6.1", "soundfile==0.14.0"];

const video = join(import.meta.dirname, "..");
const narrationDirectory = join(video, "public", "narration");
const manifestPath = join(narrationDirectory, "manifest.json");

type Job = { text: string; voice: string; speed: number; out: string };
type SpokenLine = { text: string; file: string; seconds: number; voice: string; speed: number };
type Manifest = { voice: string; lines: Partial<Record<LineName, SpokenLine>> };

async function sha256Of(path: string) {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

async function modelFiles() {
  mkdirSync(MODEL.directory, { recursive: true });
  for (const { name, sha256 } of MODEL.files) {
    const path = join(MODEL.directory, name);
    if (!existsSync(path)) {
      console.log(`Downloading ${name}…`);
      const response = await fetch(`${MODEL.release}/${name}`);
      if (!response.ok) throw new Error(`Could not download ${name}: ${response.status}`);
      await Bun.write(path, response);
    }
    const actual = await sha256Of(path);
    if (actual !== sha256) throw new Error(`${path} has sha256 ${actual}, expected ${sha256}; delete it to download it again`);
  }
  return MODEL.files.map(({ name }) => join(MODEL.directory, name));
}

async function speak(jobs: Job[]) {
  if (jobs.length === 0) return new Map<string, number>();
  const [model, voices] = await modelFiles();
  const jobsPath = join(tmpdir(), `mirador-narration-${process.pid}.json`);
  writeFileSync(jobsPath, JSON.stringify(jobs));
  const packages = PYTHON_PACKAGES.flatMap((name) => ["--with", name]);
  const result = spawnSync("uv", ["run", "--isolated", "--no-project", "--python", "3.12", ...packages, "python", "-I", join(import.meta.dirname, "speak.py"), model!, voices!, jobsPath], {
    cwd: tmpdir(),
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Kokoro failed with status ${result.status}`);
  const spoken = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as { out: string; seconds: number });
  return new Map(spoken.map(({ out, seconds }) => [out, seconds]));
}

function readManifest(): Manifest {
  return existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest) : { voice: VOICE, lines: {} };
}

async function narrate() {
  mkdirSync(narrationDirectory, { recursive: true });
  const manifest = readManifest();
  const isCurrent = (name: LineName) => {
    const line = manifest.lines[name];
    return line && line.text === textOf(name) && line.voice === voiceOf(name) && line.speed === SPEED && existsSync(join(narrationDirectory, line.file));
  };
  const stale = (Object.keys(LINES) as LineName[]).filter((name) => !isCurrent(name));
  const jobs = stale.map((name) => ({ text: textOf(name), voice: voiceOf(name), speed: SPEED, out: join(narrationDirectory, `${name}.wav`) }));
  const seconds = await speak(jobs);
  const lines = Object.fromEntries(
    (Object.keys(LINES) as LineName[]).map((name) => [
      name,
      stale.includes(name) ? { text: textOf(name), file: `${name}.wav`, seconds: seconds.get(join(narrationDirectory, `${name}.wav`))!, voice: voiceOf(name), speed: SPEED } : manifest.lines[name]!,
    ]),
  );
  writeFileSync(manifestPath, `${JSON.stringify({ voice: VOICE, lines }, null, 2)}\n`);
  console.log(stale.length ? `Spoke ${stale.map((name) => `${name} in ${voiceOf(name)}`).join(", ")}` : "The narration is up to date");
}

async function speakSamples() {
  const directory = join(video, "out", "voice-samples");
  mkdirSync(directory, { recursive: true });
  const text = `${textOf("canvas")} ${textOf("show")}`;
  const seconds = await speak(SAMPLE_VOICES.map((voice) => ({ text, voice, speed: SPEED, out: join(directory, `${voice}.wav`) })));
  seconds.forEach((length, out) => console.log(`${out}: ${length.toFixed(1)} s`));
}

if (import.meta.main) await (process.argv.includes("--samples") ? speakSamples() : narrate());
