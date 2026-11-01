import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, statfs, writeFile } from "node:fs/promises";
import { homedir, platform, arch, release, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { gigabytes, type VoiceEngineSetup, type VoiceEngineStatus, type VoiceEngineStep } from "../../../shared/voice-engine.ts";
import { ENGINE_PACKAGES_BYTES, FIRST_MODELS, type ChoosableModel, type EngineModel } from "../../../shared/voice-engine-models.ts";
import { isUnusedModelFile, modelFolderName, type EngineSources } from "./catalog.ts";
import { bytesOnDisk, downloadFile, type Download } from "./downloads.ts";
import { causeOf, englishProblem, HostProblemError, problemFieldsOf, type HostProblem } from "../../../shared/host-problems.ts";

/** Room left over once everything is in, so the Mac isn't left full. */
const SPARE_BYTES = 2e9;
/** What installing takes on top, for uv's cache of the packages while it installs them. */
const INSTALLING_BYTES = ENGINE_PACKAGES_BYTES + 1.5e9;
const PROGRESS_INTERVAL_MS = 250;
const MACOS_14_DARWIN_MAJOR = 23;

interface SetupRecord {
  uvSha256: string;
  pythonVersion: string;
  lockSha256: string;
  /** Each model's revision by its id, or by its service in setups from before models could be chosen. */
  models: Record<string, string>;
}

interface TreeEntry {
  type: string;
  path: string;
  size: number;
  oid: string;
  lfs?: { oid: string };
}

export interface VoiceEngineInstallerOptions {
  voiceDir: string;
  logsDir: string;
  sources: EngineSources;
  /** e2e's stand-in for the engine's Python where there is no MLX: setup then only downloads the models. */
  fakePython: string | null;
  freeBytes?: (path: string) => Promise<number>;
  platform?: { os: string; cpu: string; darwinMajor: number };
  memoryBytes?: number;
  onChange: () => void;
}

const thisMachine = () => ({ os: platform(), cpu: arch(), darwinMajor: Number(release().split(".")[0]) });

const freeBytesOf = async (path: string) => {
  const { bavail, bsize } = await statfs(path);
  return bavail * bsize;
};

function unsupportedReason({ os, cpu, darwinMajor }: { os: string; cpu: string; darwinMajor: number }) {
  if (os !== "darwin" || cpu !== "arm64") return "Voice on this Mac needs a Mac with Apple silicon.";
  if (darwinMajor < MACOS_14_DARWIN_MAJOR) return "Voice on this Mac needs macOS 14 or newer.";
  return null;
}

const sha256Of = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");

/** A setup run starts over from what was set up, forgetting why an earlier run failed. */
function withoutProblem(setup: VoiceEngineSetup): VoiceEngineSetup {
  if (setup.state !== "set-up") return setup;
  const { notAdded: _, ...setUp } = setup;
  return setUp;
}

/** Why adding models failed, in English and as the problem it was about. */
function addingFailed(models: string[], error: unknown, cause: string) {
  const problem: HostProblem = { code: "engine-adding-failed", models, ...causeOf(error, cause) };
  return { problem: englishProblem(problem), problemAbout: problem };
}

const lastLine = (text: string) => text.trim().split("\n").at(-1) ?? "";

const namesOf = (models: EngineModel[]) => models.map(({ name }) => name);

/** Downloads and installs Mirador's own speech engine into the data folder, and takes it away again. */
export class VoiceEngineInstaller {
  private setup: VoiceEngineSetup;
  /** The models, by id, a finished setup put in place, which the servers may use even while setup adds others. */
  private installed: string[] = [];
  /** The models, by id, the running setup downloads. */
  private downloading: string[] = [];
  private run: AbortController | null = null;
  private progressFlush: Timer | null = null;
  private readonly freeBytes: (path: string) => Promise<number>;
  private readonly memoryBytes: number;

  constructor(private readonly options: VoiceEngineInstallerOptions) {
    this.freeBytes = options.freeBytes ?? freeBytesOf;
    this.memoryBytes = options.memoryBytes ?? totalmem();
    const reason = options.fakePython ? null : unsupportedReason(options.platform ?? thisMachine());
    this.setup = reason ? { state: "unsupported", reason } : { state: "not-set-up" };
  }

  /** Reads what an earlier setup left, once at the host's start. */
  async load() {
    if (this.setup.state === "unsupported") return;
    const record = await this.record();
    if (!record || !(await this.packagesCurrent(record))) return;
    const current = this.currentModels(record);
    if (!current.includes(this.options.sources.spokenVoice.id)) return;
    this.installed = current;
    this.setup = { state: "set-up", bytesOnDisk: await this.bytesOnDisk() };
    this.changed();
  }

  status(): Omit<VoiceEngineStatus, "servers"> {
    return { setup: this.setup, onDisk: [...this.installed], memoryBytes: this.memoryBytes };
  }

  isInstalled(id: string) {
    return this.installed.includes(id);
  }

  isSetUp() {
    return this.installed.length > 0;
  }

  isSettingUp() {
    return this.run !== null;
  }

  isDownloading(id: string) {
    return this.downloading.includes(id);
  }

  /** Where a model's files are, once set up. */
  modelDir(id: string) {
    return this.folderOf(this.modelOf(id));
  }

  get python() {
    return this.options.fakePython ?? join(this.options.voiceDir, "venv", "bin", "python");
  }

  /** Sets up what is missing: the packages and the spoken voice, and those of these models that aren't on this Mac yet. */
  setUp(models: string[]) {
    if (this.setup.state === "unsupported" || this.run) return;
    const adding = this.options.sources.models.filter(({ id }) => models.includes(id) && !this.isInstalled(id));
    const before = withoutProblem(this.setup);
    if (before.state === "set-up" && adding.length === 0) return;
    const run = new AbortController();
    this.run = run;
    this.install(adding, run.signal)
      .then(async () => {
        this.setup = { state: "set-up", bytesOnDisk: await this.bytesOnDisk() };
      })
      .catch((error) => {
        const problem = error instanceof Error ? error.message : String(error);
        if (run.signal.aborted) this.setup = before;
        else if (before.state === "set-up") this.setup = { ...before, notAdded: { models: adding.map(({ id }) => id), ...addingFailed(namesOf(adding), error, problem) } };
        else this.setup = { state: "failed", ...problemFieldsOf(error, problem) };
      })
      .finally(() => {
        this.run = null;
        this.downloading = [];
        this.changed();
      });
  }

  cancel() {
    this.run?.abort();
  }

  async remove() {
    if (this.setup.state === "unsupported" || this.run) return;
    await rm(this.options.voiceDir, { recursive: true, force: true });
    this.installed = [];
    this.setup = { state: "not-set-up" };
    this.changed();
  }

  /** Takes one model away; the spoken voice goes only with the rest. */
  async removeModel(id: string) {
    if (this.setup.state !== "set-up" || this.run || !this.isInstalled(id) || id === this.options.sources.spokenVoice.id) return;
    this.installed = this.installed.filter((each) => each !== id);
    await this.writeRecord(this.installed);
    await rm(this.modelDir(id), { recursive: true, force: true });
    this.setup = { state: "set-up", bytesOnDisk: await this.bytesOnDisk() };
    this.changed();
  }

  private async install(adding: ChoosableModel[], signal: AbortSignal) {
    const { spokenVoice } = this.options.sources;
    const models = this.isInstalled(spokenVoice.id) ? adding : [spokenVoice, ...adding];
    this.downloading = models.map(({ id }) => id);
    this.progress("space", 0, 0);
    const downloads = (await Promise.all(models.map((model) => this.downloadsOf(model, signal)))).flat();
    await this.checkSpace(downloads);
    if (!this.options.fakePython) {
      this.progress("uv", 0, 0);
      await this.installUv(signal);
      this.progress("python", 0, 0);
      await this.uv(["python", "install", this.options.sources.pythonVersion, "--no-bin"], signal);
      this.progress("packages", 0, 0);
      await this.installPackages(signal);
    }
    await this.downloadModels(downloads, signal);
    const installed = [...this.installed, ...models.map(({ id }) => id)];
    await this.writeRecord(installed);
    this.installed = installed;
  }

  private get knownModels(): EngineModel[] {
    const { spokenVoice, models } = this.options.sources;
    return [spokenVoice, ...models];
  }

  private modelOf(id: string) {
    const model = this.knownModels.find((each) => each.id === id);
    if (!model) throw new HostProblemError({ code: "engine-has-no-such-model", model: id });
    return model;
  }

  private folderOf(model: EngineModel) {
    return join(this.options.voiceDir, "models", modelFolderName(model));
  }

  private async downloadsOf(model: EngineModel, signal: AbortSignal): Promise<Download[]> {
    const { repo, revision } = model;
    const { modelsUrl } = this.options.sources;
    const response = await fetch(`${modelsUrl}/api/models/${repo}/tree/${revision}?recursive=true`, { signal });
    if (!response.ok) throw new HostProblemError({ code: "engine-files-list-failed", host: new URL(modelsUrl).host, status: response.status, repo });
    const entries = (await response.json()) as TreeEntry[];
    return entries
      .filter(({ type, path }) => type === "file" && !isUnusedModelFile(path))
      .map(({ path, size, oid, lfs }) => ({
        url: `${modelsUrl}/${repo}/resolve/${revision}/${path.split("/").map(encodeURIComponent).join("/")}`,
        destination: join(this.folderOf(model), path),
        size,
        checksum: lfs ? { sha256: lfs.oid } : { gitBlobSha1: oid },
      }));
  }

  private async checkSpace(downloads: Download[]) {
    const onDisk = await Promise.all(downloads.map(bytesOnDisk));
    const stillToDownload = downloads.reduce((sum, { size }, index) => sum + size - onDisk[index]!, 0);
    const installing = this.options.fakePython || (await this.packagesInstalled()) ? 0 : INSTALLING_BYTES;
    const needed = stillToDownload + installing + SPARE_BYTES;
    await mkdir(this.options.voiceDir, { recursive: true });
    const free = await this.freeBytes(this.options.voiceDir);
    if (free < needed) throw new HostProblemError({ code: "engine-needs-space", needed: gigabytes(needed), free: gigabytes(free) });
  }

  private async installUv(signal: AbortSignal) {
    const binDir = join(this.options.voiceDir, "bin");
    const marker = join(binDir, "uv.sha256");
    const { url, sha256 } = this.options.sources.uv;
    if ((await readFile(marker, "utf8").catch(() => "")) === sha256) return;
    const archive = join(binDir, "uv.tar.gz");
    const download = { url, destination: archive, size: await this.sizeAt(url, signal), checksum: { sha256 } };
    await downloadFile(download, signal, () => {});
    await this.command(["tar", "-xzf", archive, "-C", binDir, "--strip-components", "1"], signal);
    await rm(archive);
    await writeFile(marker, sha256);
  }

  private async sizeAt(url: string, signal: AbortSignal) {
    const response = await fetch(url, { method: "HEAD", signal });
    const size = Number(response.headers.get("content-length"));
    if (!response.ok || !size) throw new HostProblemError({ code: "engine-download-answered", host: new URL(url).host, status: response.status, url });
    return size;
  }

  private async installPackages(signal: AbortSignal) {
    if (await this.packagesInstalled()) return;
    const venv = join(this.options.voiceDir, "venv");
    await this.uv(["venv", "--python", this.options.sources.pythonVersion, "--managed-python", "--clear", venv], signal);
    await this.uv(["pip", "install", "--require-hashes", "-r", this.options.sources.lockFile, "--python", join(venv, "bin", "python")], signal);
    await writeFile(join(venv, "mirador-lock.sha256"), await sha256Of(this.options.sources.lockFile));
    await rm(join(this.options.voiceDir, "uv-cache"), { recursive: true, force: true });
  }

  private async packagesInstalled() {
    const installed = await readFile(join(this.options.voiceDir, "venv", "mirador-lock.sha256"), "utf8").catch(() => null);
    return installed === (await sha256Of(this.options.sources.lockFile));
  }

  private async downloadModels(downloads: Download[], signal: AbortSignal) {
    const onDisk = await Promise.all(downloads.map(bytesOnDisk));
    const total = downloads.reduce((sum, { size }) => sum + size, 0);
    const done = () => onDisk.reduce((sum, bytes) => sum + bytes, 0);
    this.progress("models", done(), total);
    for (const [index, download] of downloads.entries()) {
      await downloadFile(download, signal, (bytes) => {
        onDisk[index] = bytes;
        this.progress("models", done(), total);
      });
    }
  }

  /** uv kept to the voice folder: its own Python, cache and no user configuration. */
  private uv(args: string[], signal: AbortSignal) {
    return this.command([join(this.options.voiceDir, "bin", "uv"), ...args, "--no-config"], signal, {
      UV_CACHE_DIR: join(this.options.voiceDir, "uv-cache"),
      UV_PYTHON_INSTALL_DIR: join(this.options.voiceDir, "python"),
      UV_NO_PROGRESS: "1",
    });
  }

  private async command(command: string[], signal: AbortSignal, environment: Record<string, string> = {}) {
    await mkdir(this.options.logsDir, { recursive: true });
    const log = createWriteStream(join(this.options.logsDir, "voice-setup.log"), { flags: "a" });
    log.write(`${new Date().toISOString()} ${command.join(" ")}\n`);
    const child = Bun.spawn(command, {
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: homedir(), TMPDIR: tmpdir(), ...environment },
      stdout: "pipe",
      stderr: "pipe",
      signal,
    });
    const [output, errors, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    log.end(output + errors);
    signal.throwIfAborted();
    if (exitCode !== 0) throw new HostProblemError({ code: "engine-command-failed", command: `${command[0]!.split("/").at(-1)} ${command[1]}`, lastError: lastLine(errors), exitCode });
  }

  private recordPath() {
    return join(this.options.voiceDir, "setup.json");
  }

  private async record() {
    return JSON.parse(await readFile(this.recordPath(), "utf8").catch(() => "null")) as SetupRecord | null;
  }

  private async writeRecord(models: string[]) {
    const record: SetupRecord = {
      uvSha256: this.options.sources.uv.sha256,
      pythonVersion: this.options.sources.pythonVersion,
      lockSha256: await sha256Of(this.options.sources.lockFile),
      models: Object.fromEntries(models.map((id) => [id, this.modelOf(id).revision])),
    };
    await writeFile(this.recordPath(), JSON.stringify(record, null, 2));
  }

  /** Installed by this version of Mirador: a newer one may pin other packages, which setting up again brings in. */
  private async packagesCurrent(record: SetupRecord) {
    if (this.options.fakePython) return true;
    const { sources } = this.options;
    return record.uvSha256 === sources.uv.sha256 && record.pythonVersion === sources.pythonVersion && record.lockSha256 === (await sha256Of(sources.lockFile));
  }

  /** The recorded models at the revisions this version of Mirador pins; one it pins anew downloads again when added. */
  private currentModels(record: SetupRecord) {
    const byService: Record<string, string> = { ...FIRST_MODELS, speech: this.options.sources.spokenVoice.id };
    return Object.entries(record.models)
      .map(([key, revision]) => [byService[key] ?? key, revision] as const)
      .filter(([id, revision]) => this.knownModels.some((model) => model.id === id && model.revision === revision))
      .map(([id]) => id);
  }

  private async bytesOnDisk() {
    const child = Bun.spawn(["du", "-sk", this.options.voiceDir], { stdout: "pipe", stderr: "ignore" });
    const kilobytes = Number((await new Response(child.stdout).text()).split(/\s/)[0]);
    return Number.isFinite(kilobytes) ? kilobytes * 1024 : 0;
  }

  /** Sent at most every quarter second, as a download reports every chunk. */
  private progress(step: VoiceEngineStep, done: number, total: number) {
    const stepChanged = this.setup.state !== "setting-up" || this.setup.step !== step;
    this.setup = { state: "setting-up", step, done, total, models: [...this.downloading] };
    if (stepChanged) return this.changed();
    this.progressFlush ??= setTimeout(() => this.changed(), PROGRESS_INTERVAL_MS);
  }

  private changed() {
    if (this.progressFlush) clearTimeout(this.progressFlush);
    this.progressFlush = null;
    this.options.onChange();
  }
}
