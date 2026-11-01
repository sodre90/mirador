import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PublicAddress } from "../shared/model.ts";
import { RELEASES_REPOSITORY } from "../shared/newer-version.ts";
import { relayPorts } from "../shared/relay-ports.ts";
import { HostProblemError } from "../shared/host-problems.ts";

const PLUGIN_CATALOG_URL = "https://raw.githubusercontent.com/sodre90/mirador-plugins/main/index.json";
const DEFAULT_PLUGINS_FILE = join(dirname(import.meta.dir), "plugins", "defaults.json");

/** Other devices reach the host over HTTPS on these ports of every network it is on. */
export interface NetworkListening {
  port: number;
  canvasPort: number;
  /** The owner's certificate and key, e.g. from a company CA or mkcert; null when Mirador makes its own. */
  ownCertificate: { certificatePath: string; keyPath: string } | null;
}

/** How other devices reach the host. The environment wins over config.json, so Settings can't change what it sets. */
export interface Reachability {
  publicAddress: PublicAddress | null;
  publicAddressSetByEnvironment: boolean;
  network: NetworkListening | null;
  networkSetByEnvironment: boolean;
}

export const agentLogsDirectory = (dataDir: string) => join(dataDir, "logs");

export interface HostConfig {
  port: number;
  canvasAssetsPort: number;
  relayPorts: number[];
  dataDir: string;
  databasePath: string;
  browserToken: string;
  mcpToken: string;
  /** Lets scripts an agent started post messages back to its conversation; kept across restarts so waiting scripts still get through. */
  scriptToken: string;
  appOrigin: string;
  /** Where other devices reach this host, through a proxy such as tailscale serve or on the network itself; null when only this machine does. */
  publicOrigin: string | null;
  /** Where canvas pages load D3, Mermaid and three from: the public one when there is one, so the agents' pages load for every viewer. */
  canvasAssetsOrigin: string;
  reachability: Reachability;
  notifierDir: string | null;
  /** Test runs pin a cheap model for Claude Code on the user's own setup; a profile with an environment of its own chooses its model itself. */
  testModelOverride: { model?: string; effort?: string };
  /** Test hosts' own Claude Code sessions skip the user's settings and CLAUDE.md, which can steer or refuse test prompts. */
  testSkipsUserSettings: boolean;
  /** Hot reload makes open pages swap modules mid-conversation, so it is opt-in for working on the UI itself. */
  developmentMode: boolean;
  /** Runs the statusline command from the user's Claude Code settings; test hosts turn it off with MIRADOR_STATUSLINE=off. */
  runsUserStatusLine: boolean;
  /** Test hosts turn it off with MIRADOR_NEWER_VERSION_CHECK=off, so they neither fetch the checkout they run from nor ask GitHub. */
  checksForNewerVersion: boolean;
  /** Test hosts turn it off with MIRADOR_PLUGIN_UPDATE_CHECK=off, so they fetch no plugin's repo unless a spec asks. */
  checksForPluginUpdates: boolean;
  /** Where a release finds the latest published release; e2e points it at a fake. */
  latestReleaseUrl: string;
  /** Where the catalog of official plugins is; MIRADOR_PLUGIN_CATALOG=off, as test hosts have it unless a spec gives one, fetches none. */
  pluginCatalogUrl: string | null;
  /** The plugins Mirador installs once at its start; MIRADOR_DEFAULT_PLUGINS=off, as test hosts have it unless a spec gives a file, installs none. */
  defaultPluginsFile: string | null;
  /** Where setting up voice on this Mac downloads its models: Hugging Face, or e2e's fake of it. */
  voiceModelsUrl: string;
  /** e2e's stand-in for the speech engine's Python, on machines without MLX. */
  voiceEnginePython: string | null;
  /** e2e's stand-in for this Mac's memory, which tells the voice models that fit it. */
  voiceEngineMemoryBytes: number | null;
}

function loadOrCreateToken(dataDir: string, fileName: string) {
  const tokenFile = join(dataDir, fileName);
  if (existsSync(tokenFile)) return readFileSync(tokenFile, "utf8").trim();
  const token = crypto.randomUUID().replaceAll("-", "");
  writeFileSync(tokenFile, token, { mode: 0o600 });
  return token;
}

function notifierDirIfInstalled() {
  const dir = join(homedir(), ".config", "claude-notifier");
  return existsSync(dir) ? dir : null;
}

type AddressNames = { origin: string; canvasOrigin: string };

/** The names Settings shows the two addresses by; their problems are for the page to say in its own language. */
export const SETTINGS_ADDRESS_NAMES: AddressNames = { origin: "Address", canvasOrigin: "Canvas address" };

function notWebAddress(name: string) {
  if (name === SETTINGS_ADDRESS_NAMES.origin) return new HostProblemError({ code: "address-must-be-web-address" });
  if (name === SETTINGS_ADDRESS_NAMES.canvasOrigin) return new HostProblemError({ code: "canvas-address-must-be-web-address" });
  return new Error(`${name} must be a web address, like https://box.example.ts.net.`);
}

function webOrigin(address: unknown, name: string) {
  const url = typeof address === "string" ? URL.parse(address) : null;
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) throw notWebAddress(name);
  return url.origin;
}

/** Both addresses or neither, each cut down to its origin. */
export function publicAddressOf(origin: unknown, canvasOrigin: unknown, names: AddressNames): PublicAddress | null {
  if (!origin && !canvasOrigin) return null;
  if (!origin || !canvasOrigin) {
    throw names === SETTINGS_ADDRESS_NAMES ? new HostProblemError({ code: "set-both-addresses-or-neither" }) : new Error(`Set both ${names.origin} and ${names.canvasOrigin}, or neither.`);
  }
  return { origin: webOrigin(origin, names.origin), canvasOrigin: webOrigin(canvasOrigin, names.canvasOrigin) };
}

const publicAddressInEnvironment = (env: NodeJS.ProcessEnv) =>
  publicAddressOf(env.MIRADOR_PUBLIC_ORIGIN, env.MIRADOR_PUBLIC_CANVAS_ORIGIN, { origin: "MIRADOR_PUBLIC_ORIGIN", canvasOrigin: "MIRADOR_PUBLIC_CANVAS_ORIGIN" });

export const configFilePath = (dataDir: string) => join(dataDir, "config.json");

function readConfigFile(dataDir: string): Record<string, unknown> {
  const path = configFilePath(dataDir);
  if (!existsSync(path)) return {};
  try {
    const settings: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof settings === "object" && settings !== null && !Array.isArray(settings)) return settings as Record<string, unknown>;
  } catch {}
  throw new HostProblemError({ code: "config-file-must-be-object", path });
}

/** The public address saved in config.json, by hand or from Settings. */
export function savedPublicAddress(dataDir: string) {
  const { publicOrigin, publicCanvasOrigin } = readConfigFile(dataDir);
  try {
    return publicAddressOf(publicOrigin, publicCanvasOrigin, { origin: "publicOrigin", canvasOrigin: "publicCanvasOrigin" });
  } catch (error) {
    throw new Error(`${configFilePath(dataDir)}: ${(error as Error).message}`);
  }
}

/** Keeps whatever else config.json holds; the host uses the change from its next start. */
function changeConfigFile(dataDir: string, change: Record<string, unknown>) {
  const settings = Object.fromEntries(Object.entries({ ...readConfigFile(dataDir), ...change }).filter(([, value]) => value !== undefined));
  writeFileSync(configFilePath(dataDir), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}

export function savePublicAddress(dataDir: string, address: PublicAddress | null) {
  changeConfigFile(dataDir, { publicOrigin: address?.origin, publicCanvasOrigin: address?.canvasOrigin });
}

export const savedNetwork = (dataDir: string) => switchIn(readConfigFile(dataDir).network, `network in ${configFilePath(dataDir)}`) ?? false;

export function saveNetwork(dataDir: string, on: boolean) {
  changeConfigFile(dataDir, { network: on || undefined });
}

const environmentSwitches: Record<string, boolean> = { "1": true, on: true, true: true, "0": false, off: false, false: false };

function switchIn(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  const on = typeof value === "boolean" ? value : environmentSwitches[String(value).toLowerCase()];
  if (on === undefined) throw new Error(`${name} must be on or off.`);
  return on;
}

/** The name this machine answers to on the local network: its own, or name.local through mDNS when it has no domain. */
export const localNetworkName = (machineName = hostname()) => (machineName.includes(".") ? machineName : `${machineName}.local`);

function certificateFiles(certificatePath: unknown, keyPath: unknown, names: { certificate: string; key: string; where: string }, dataDir: string) {
  if (!certificatePath && !keyPath) return null;
  if (typeof certificatePath !== "string" || typeof keyPath !== "string" || !certificatePath || !keyPath) {
    throw new Error(`Set both ${names.certificate} and ${names.key}${names.where}, or neither.`);
  }
  return { certificatePath: resolve(dataDir, certificatePath), keyPath: resolve(dataDir, keyPath) };
}

export function reachability(env: NodeJS.ProcessEnv, dataDir: string, port: number): Reachability {
  const publicAddressFromEnvironment = publicAddressInEnvironment(env);
  const networkFromEnvironment = switchIn(env.MIRADOR_NETWORK, "MIRADOR_NETWORK");
  const settings = readConfigFile(dataDir);
  const networkPort = Number(env.MIRADOR_NETWORK_PORT ?? port + 2);
  const network = (networkFromEnvironment ?? savedNetwork(dataDir))
    ? {
        port: networkPort,
        canvasPort: networkPort + 1,
        ownCertificate:
          certificateFiles(env.MIRADOR_TLS_CERTIFICATE, env.MIRADOR_TLS_KEY, { certificate: "MIRADOR_TLS_CERTIFICATE", key: "MIRADOR_TLS_KEY", where: "" }, dataDir) ??
          certificateFiles(settings.tlsCertificate, settings.tlsKey, { certificate: "tlsCertificate", key: "tlsKey", where: ` in ${configFilePath(dataDir)}` }, dataDir),
      }
    : null;
  const addressOnTheNetwork = network && {
    origin: `https://${localNetworkName()}:${network.port}`,
    canvasOrigin: `https://${localNetworkName()}:${network.canvasPort}`,
  };
  return {
    publicAddress: publicAddressFromEnvironment ?? savedPublicAddress(dataDir) ?? addressOnTheNetwork,
    publicAddressSetByEnvironment: publicAddressFromEnvironment !== null,
    network,
    networkSetByEnvironment: networkFromEnvironment !== undefined,
  };
}

export function loadConfig(env = process.env): HostConfig {
  const port = Number(env.MIRADOR_PORT ?? 4600);
  const canvasAssetsPort = Number(env.MIRADOR_CANVAS_PORT ?? port + 1);
  const dataDir = env.MIRADOR_DATA_DIR ?? join(homedir(), ".mirador");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const reachedAs = reachability(env, dataDir, port);
  return {
    port,
    canvasAssetsPort,
    relayPorts: relayPorts(port),
    dataDir,
    databasePath: join(dataDir, "state.sqlite"),
    browserToken: loadOrCreateToken(dataDir, "browser-token"),
    mcpToken: env.MIRADOR_MCP_TOKEN ?? crypto.randomUUID().replaceAll("-", ""),
    scriptToken: loadOrCreateToken(dataDir, "script-token"),
    appOrigin: `http://127.0.0.1:${port}`,
    publicOrigin: reachedAs.publicAddress?.origin ?? null,
    canvasAssetsOrigin: reachedAs.publicAddress?.canvasOrigin ?? `http://127.0.0.1:${canvasAssetsPort}`,
    reachability: reachedAs,
    notifierDir: env.MIRADOR_NOTIFIER_DIR ?? notifierDirIfInstalled(),
    testModelOverride: { model: env.MIRADOR_TEST_MODEL, effort: env.MIRADOR_TEST_EFFORT },
    testSkipsUserSettings: env.MIRADOR_TEST_SKIP_USER_SETTINGS === "1",
    developmentMode: env.MIRADOR_DEV === "1",
    runsUserStatusLine: env.MIRADOR_STATUSLINE !== "off",
    checksForNewerVersion: env.MIRADOR_NEWER_VERSION_CHECK !== "off",
    checksForPluginUpdates: env.MIRADOR_PLUGIN_UPDATE_CHECK !== "off",
    latestReleaseUrl: env.MIRADOR_LATEST_RELEASE_URL ?? `https://api.github.com/repos/${RELEASES_REPOSITORY}/releases/latest`,
    pluginCatalogUrl: env.MIRADOR_PLUGIN_CATALOG === "off" ? null : (env.MIRADOR_PLUGIN_CATALOG ?? PLUGIN_CATALOG_URL),
    defaultPluginsFile: env.MIRADOR_DEFAULT_PLUGINS === "off" ? null : (env.MIRADOR_DEFAULT_PLUGINS ?? DEFAULT_PLUGINS_FILE),
    voiceModelsUrl: env.MIRADOR_VOICE_MODELS_URL ?? "https://huggingface.co",
    voiceEnginePython: env.MIRADOR_VOICE_PYTHON ?? null,
    voiceEngineMemoryBytes: env.MIRADOR_VOICE_MEMORY_GB ? Number(env.MIRADOR_VOICE_MEMORY_GB) * 2 ** 30 : null,
  };
}
