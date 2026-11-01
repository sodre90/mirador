import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineServerState } from "../shared/voice-engine.ts";
import { VoiceEngineServers, type VoiceEngineServersOptions } from "../host/voice/engine/servers.ts";
import { speak, transcribe } from "../host/voice/endpoints.ts";
import { VoiceUnavailable } from "../host/voice/voice.ts";

const fakeEngine = join(import.meta.dir, "..", "e2e", "fake-voice-engine.ts");

interface Logged {
  module: string;
  pid: number;
  event: string;
  model?: string;
  responseFormat?: string;
  refAudio?: string;
}

let root = "";
let servers: VoiceEngineServers | null = null;
let others: number[] = [];

afterEach(async () => {
  await servers?.stopAll();
  servers = null;
  others.forEach((pid) => isRunning(pid) && process.kill(pid, "SIGKILL"));
  others = [];
  rmSync(root, { recursive: true, force: true });
});

function isRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const logPath = () => join(root, "engine.log");

const logged = (): Logged[] =>
  existsSync(logPath())
    ? readFileSync(logPath(), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Logged)
    : [];

const startsOf = (serverModule: string) => logged().filter((entry) => entry.event === "start" && entry.module === serverModule);

/** The servers run python with an environment of their own, so the fake's settings are written into the program. */
function writePython(script: string) {
  const python = join(root, "python");
  writeFileSync(python, script);
  chmodSync(python, 0o755);
  return python;
}

const fakePython = (loadMs = 0) =>
  writePython(`#!/bin/sh
export FAKE_VOICE_ENGINE_LOG="${logPath()}" FAKE_VOICE_ENGINE_LOAD_MS=${loadMs}
exec "${process.execPath}" "${fakeEngine}" "$@"
`);

const brokenPython = () =>
  writePython(`#!/bin/sh
echo "Warning: something harmless" >&2
echo "ModuleNotFoundError: No module named 'mlx_audio'" >&2
exit 1
`);

const WHISPER = "whisper-large-v3-turbo";
const GEMMA = "gemma-4-26b-a4b";
const SMALL_GEMMA = "gemma-4-12b";
const KOKORO = "kokoro-82m";
const OMNIVOICE = "omnivoice";

function engineServers({
  python = fakePython(),
  installed = [KOKORO, OMNIVOICE, WHISPER, GEMMA, SMALL_GEMMA],
  downloading = [],
  ...options
}: Partial<VoiceEngineServersOptions> & { python?: string; installed?: string[]; downloading?: string[] } = {}) {
  const states: Record<string, EngineServerState>[] = [];
  servers = new VoiceEngineServers({
    installer: { python, modelDir: (id) => join(root, "models", id), isInstalled: (id) => installed.includes(id), isSetUp: () => installed.length > 0, isDownloading: (id) => downloading.includes(id) },
    voiceDir: join(root, "voice"),
    logsDir: join(root, "logs"),
    idleMs: () => 60_000,
    onChange: () => states.push(servers!.states()),
    ...options,
  });
  return { servers, states };
}

async function until(condition: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(20);
  }
}

const silentClip = new Blob([new Uint8Array(44)], { type: "audio/wav" });

/** The fake python is a shell script, which Windows can't run; voice on this Mac needs a Mac anyway. */
const hasPosixShell = process.platform !== "win32";

describe.if(hasPosixShell)("the engine's servers", () => {
  test("start at their first use, once for uses at the same time, and lend their address and model", async () => {
    root = mkdtempSync(join(tmpdir(), "mirador-voice-servers-"));
    const { servers, states } = engineServers({ python: fakePython(300) });
    const hear = () => servers.use("recognition", WHISPER, (endpoint) => transcribe(endpoint, silentClip, null, { detailed: true }));
    const [first, second] = await Promise.all([hear(), hear()]);
    expect(first).toEqual({ text: "Futtasd le az e2e teszteket.", language: "hu" });
    expect(second).toEqual(first);
    expect(startsOf("mlx_audio.server")).toHaveLength(1);
    expect(states).toEqual([
      { speech: "loading", voiceModel: "stopped", speaking: "stopped" },
      { speech: "ready", voiceModel: "stopped", speaking: "stopped" },
    ]);
    const transcriptions = logged().filter((entry) => entry.event === "transcription");
    expect(transcriptions.map(({ responseFormat }) => responseFormat)).toEqual(["json", "verbose_json", "verbose_json"]);
    expect(new Set(transcriptions.map(({ model }) => model))).toEqual(new Set([join(root, "models", WHISPER)]));
  });

  test("start the voice model's server with its model", async () => {
    root = mkdtempSync(join(tmpdir(), "mirador-voice-servers-"));
    const { servers } = engineServers();
    const endpoint = await servers.use("voiceModel", GEMMA, async (endpoint) => endpoint);
    expect(endpoint).toMatchObject({ url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/v1$/), apiKey: "", model: join(root, "models", GEMMA) });
    expect(startsOf("mlx_lm.server").map(({ model }) => model)).toEqual([join(root, "models", GEMMA)]);
    expect(servers.states()).toEqual({ speech: "stopped", voiceModel: "ready", speaking: "stopped" });
  });

  test("start again for another model, as a server holds what it loaded, and stop for a model being removed", async () => {
    root = mkdtempSync(join(tmpdir(), "mirador-voice-servers-"));
    const { servers } = engineServers();
    await servers.use("voiceModel", GEMMA, async () => {});
    const [first] = startsOf("mlx_lm.server");
    const endpoint = await servers.use("voiceModel", SMALL_GEMMA, async (endpoint) => endpoint);
    expect(endpoint.model).toBe(join(root, "models", SMALL_GEMMA));
    expect(startsOf("mlx_lm.server").map(({ model }) => model)).toEqual([join(root, "models", GEMMA), join(root, "models", SMALL_GEMMA)]);
    expect(isRunning(first!.pid)).toBe(false);

    await servers.use("recognition", WHISPER, async () => {});
    expect(servers.servedModels().sort()).toEqual([SMALL_GEMMA, WHISPER]);
    await servers.stopServing(SMALL_GEMMA);
    expect(servers.states()).toEqual({ speech: "ready", voiceModel: "stopped", speaking: "stopped" });
    expect(servers.servedModels()).toEqual([WHISPER]);
  });

  test("speak replies with a server of their own, warmed up with a word in Kokoro's voice, so that Whisper stays loaded", async () => {
    root = mkdtempSync(join(tmpdir(), "mirador-voice-servers-"));
    const { servers } = engineServers();
    await servers.use("recognition", WHISPER, async () => {});
    const sound = await servers.use("speaking", KOKORO, (endpoint) => speak(endpoint, "The tests passed.", { voice: "af_heart" }));
    expect(sound.type).toBe("audio/wav");
    expect(startsOf("mlx_audio.server")).toHaveLength(2);
    expect(servers.states()).toEqual({ speech: "ready", voiceModel: "stopped", speaking: "ready" });
    const kokoro = join(root, "models", KOKORO);
    expect(logged().filter((entry) => entry.event === "speech")).toMatchObject([
      { model: kokoro, input: "Ready.", voice: join(kokoro, "voices", "am_fenrir.safetensors"), responseFormat: "wav" },
      { model: kokoro, input: "The tests passed.", voice: "af_heart", responseFormat: "wav" },
    ]);
    expect(existsSync(join(root, "logs", "voice-speaking.log"))).toBe(true);
    expect(existsSync(join(root, "voice", "run", "speaking.pid"))).toBe(true);
  });

  test("speak Hungarian replies with OmniVoice instead of Kokoro, warmed up copying the voice of its clip", async () => {
    root = mkdtempSync(join(tmpdir(), "mirador-voice-servers-"));
    const { servers } = engineServers();
    await servers.use("speaking", KOKORO, async () => {});
    await servers.use("speaking", OMNIVOICE, async () => {});
    expect(startsOf("mlx_audio.server")).toHaveLength(2);
    expect(servers.servedModels()).toEqual([OMNIVOICE]);
    const warmUp = logged().filter((entry) => entry.event === "speech").at(-1)!;
    expect(warmUp).toMatchObject({ model: join(root, "models", OMNIVOICE), input: "Ready.", langCode: "hu", refText: expect.stringContaining("Fedora") });
    expect(existsSync(warmUp.refAudio!)).toBe(true);
  });

  test("stop once unused for the idle time, but not while work goes on", async () => {
    root = mkdtempSync(join(tmpdir(), "mirador-voice-servers-"));
    const { servers } = engineServers({ idleMs: () => 200 });
    await servers.use("recognition", WHISPER, async () => Bun.sleep(500));
    expect(servers.states().speech).toBe("ready");
    const { pid } = startsOf("mlx_audio.server")[0]!;
    await until(() => servers.states().speech === "stopped");
    expect(isRunning(pid)).toBe(false);
    expect(existsSync(join(root, "voice", "run", "speech.pid"))).toBe(false);
    await servers.use("recognition", WHISPER, async () => {});
    expect(startsOf("mlx_audio.server")).toHaveLength(2);
  });

  test("use again within the idle time keeps the server", async () => {
    root = mkdtempSync(join(tmpdir(), "mirador-voice-servers-"));
    const { servers } = engineServers({ idleMs: () => 300 });
    await servers.use("recognition", WHISPER, async () => {});
    await Bun.sleep(200);
    await servers.use("recognition", WHISPER, async () => {});
    await Bun.sleep(200);
    expect(servers.states().speech).toBe("ready");
    expect(startsOf("mlx_audio.server")).toHaveLength(1);
  });

  test("unloading follows a new idle time, counted from the last use", async () => {
    root = mkdtempSync(join(tmpdir(), "mirador-voice-servers-"));
    let idleMs = 60_000;
    const { servers } = engineServers({ idleMs: () => idleMs });
    await Promise.all([servers.use("recognition", WHISPER, async () => {}), servers.use("voiceModel", GEMMA, async () => {})]);
    idleMs = 300;
    servers.idleTimeChanged();
    await until(() => servers.states().speech === "stopped" && servers.states().voiceModel === "stopped");

    await servers.use("recognition", WHISPER, async () => {});
    idleMs = 60_000;
    servers.idleTimeChanged();
    await Bun.sleep(600);
    expect(servers.states().speech).toBe("ready");
  });

  test("stop with the host, all of each server's processes", async () => {
    root = mkdtempSync(join(tmpdir(), "mirador-voice-servers-"));
    const { servers } = engineServers();
    await Promise.all([servers.use("recognition", WHISPER, async () => {}), servers.use("voiceModel", GEMMA, async () => {}), servers.use("speaking", KOKORO, async () => {})]);
    const pids = logged()
      .filter((entry) => entry.event === "start")
      .map(({ pid }) => pid);
    await servers.stopAll();
    expect(pids.filter(isRunning)).toEqual([]);
    expect(servers.states()).toEqual({ speech: "stopped", voiceModel: "stopped", speaking: "stopped" });
  });

  test("say why a server stopped while starting, and try again at the next use", async () => {
    root = mkdtempSync(join(tmpdir(), "mirador-voice-servers-"));
    const { servers } = engineServers({ python: brokenPython() });
    await expect(servers.use("recognition", WHISPER, async () => {})).rejects.toThrow("The speech server on this Mac stopped while starting: ModuleNotFoundError: No module named 'mlx_audio'");
    await until(() => servers.states().speech === "stopped");
    fakePython();
    expect(await servers.use("recognition", WHISPER, async () => "heard")).toBe("heard");
  });

  test("give up on a server that doesn't answer in time", async () => {
    root = mkdtempSync(join(tmpdir(), "mirador-voice-servers-"));
    const { servers } = engineServers({ python: fakePython(10_000), startTimeoutMs: 1_500 });
    await expect(servers.use("voiceModel", GEMMA, async () => {})).rejects.toThrow("The voice model server on this Mac didn't start within 1.5 seconds.");
    await until(() => servers.states().voiceModel === "stopped");
    const { pid } = startsOf("mlx_lm.server")[0]!;
    await until(() => !isRunning(pid));
  });

  test("refuse services whose models aren't set up, saying when one is still downloading", async () => {
    root = mkdtempSync(join(tmpdir(), "mirador-voice-servers-"));
    const nothing = engineServers({ installed: [] }).servers;
    await expect(nothing.use("recognition", WHISPER, async () => {})).rejects.toThrow(new VoiceUnavailable({ code: "voice-not-set-up-here" }));
    const withoutVoiceModel = engineServers({ installed: ["kokoro-82m", WHISPER] }).servers;
    await expect(withoutVoiceModel.use("voiceModel", GEMMA, async () => {})).rejects.toThrow(new VoiceUnavailable({ code: "voice-engine-model-not-on-mac", model: "Gemma 4 26B-A4B" }));
    const downloadingVoiceModel = engineServers({ installed: ["kokoro-82m", WHISPER], downloading: [GEMMA] }).servers;
    await expect(downloadingVoiceModel.use("voiceModel", GEMMA, async () => {})).rejects.toThrow(
      new VoiceUnavailable({ code: "voice-engine-model-downloading", model: "Gemma 4 26B-A4B" }),
    );
    expect(logged()).toEqual([]);
  });

  test("stop servers a crashed host left running, and nothing else a pid file names", async () => {
    root = mkdtempSync(join(tmpdir(), "mirador-voice-servers-"));
    const python = fakePython();
    const serving = (port: number, serverModule = "mlx_lm.server") =>
      Bun.spawn([python, "-m", serverModule, "--host", "127.0.0.1", "--port", String(port)], { detached: true, stdio: ["ignore", "ignore", "ignore"] });
    const leftOver = serving(0);
    const usersOwn = serving(0);
    const leftSpeaking = serving(0, "mlx_audio.server");
    others.push(leftOver.pid, usersOwn.pid, leftSpeaking.pid);
    await until(() => startsOf("mlx_lm.server").length === 2 && startsOf("mlx_audio.server").length === 1);
    const runDir = join(root, "voice", "run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "voiceModel.pid"), JSON.stringify({ pid: leftOver.pid, port: 0 }));
    writeFileSync(join(runDir, "speech.pid"), JSON.stringify({ pid: usersOwn.pid, port: 0 }));
    writeFileSync(join(runDir, "speaking.pid"), JSON.stringify({ pid: leftSpeaking.pid, port: 0 }));
    engineServers({ python });
    await Promise.all([leftOver.exited, leftSpeaking.exited]);
    expect(isRunning(usersOwn.pid), "a voice model server isn't the speech server the pid file named").toBe(true);
    expect(["voiceModel.pid", "speech.pid", "speaking.pid"].filter((name) => existsSync(join(runDir, name)))).toEqual([]);

    const onAnotherPort = serving(0);
    others.push(onAnotherPort.pid);
    await until(() => startsOf("mlx_lm.server").length === 3);
    writeFileSync(join(runDir, "voiceModel.pid"), JSON.stringify({ pid: onAnotherPort.pid, port: 1 }));
    writeFileSync(join(runDir, "speech.pid"), "not a pid file");
    engineServers({ python });
    expect(isRunning(onAnotherPort.pid), "a server on another port isn't the one the pid file named").toBe(true);
    expect(existsSync(join(runDir, "speech.pid"))).toBe(false);
  });
});
