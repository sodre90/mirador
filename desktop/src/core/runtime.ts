import { join } from "node:path";
import { relayPorts } from "../../../shared/relay-ports.ts";

export const DEFAULT_PORT = 4600;

type Environment = Record<string, string | undefined>;

export interface Runtime {
  port: number;
  canvasPort: number;
  dataDir: string;
  origin: string;
  canvasOrigin: string;
  /** Where the host shows its other machines, each in a frame of the window. */
  relayOrigins: string[];
}

function portFrom(value: string | undefined, fallback: number) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

const defaultDataDir = (home: string) => join(home, ".mirador");

export function resolveRuntime(env: Environment, home: string): Runtime {
  const port = portFrom(env.MIRADOR_PORT, DEFAULT_PORT);
  const canvasPort = portFrom(env.MIRADOR_CANVAS_PORT, port + 1);
  return {
    port,
    canvasPort,
    dataDir: env.MIRADOR_DATA_DIR || defaultDataDir(home),
    origin: `http://127.0.0.1:${port}`,
    canvasOrigin: `http://127.0.0.1:${canvasPort}`,
    relayOrigins: relayPorts(port).map((relayPort) => `http://127.0.0.1:${relayPort}`),
  };
}

/** Only what differs from the host's own defaults, so the real app passes the host nothing. */
export function hostEnvironmentOverrides(runtime: Runtime, home: string): Record<string, string> {
  return {
    ...(runtime.port !== DEFAULT_PORT && { MIRADOR_PORT: String(runtime.port) }),
    ...(runtime.canvasPort !== runtime.port + 1 && { MIRADOR_CANVAS_PORT: String(runtime.canvasPort) }),
    ...(runtime.dataDir !== defaultDataDir(home) && { MIRADOR_DATA_DIR: runtime.dataDir }),
  };
}

export interface DataPaths {
  settings: string;
  ownedHostPid: string;
  /** Written by a host a Windows scheduled task runs, which the app does not start itself. */
  backgroundHostPid: string;
  hostTaskXml: string;
  hostTaskScript: string;
  hostLog: string;
  desktopLog: string;
  browserToken: string;
  /** Written before the app hands over to the updater, and cleared by the next start: that start is running new files. */
  pendingUpdate: string;
  windowFrame: string;
}

export const dataPaths = (dataDir: string): DataPaths => ({
  settings: join(dataDir, "desktop.json"),
  ownedHostPid: join(dataDir, "desktop-host.pid"),
  backgroundHostPid: join(dataDir, "background-host.pid"),
  hostTaskXml: join(dataDir, "host-task.xml"),
  hostTaskScript: join(dataDir, "host-task.cmd"),
  hostLog: join(dataDir, "logs", "host.log"),
  desktopLog: join(dataDir, "logs", "desktop.log"),
  browserToken: join(dataDir, "browser-token"),
  pendingUpdate: join(dataDir, "desktop-update-pending"),
  windowFrame: join(dataDir, "desktop-window.json"),
});

export const authUrl = (runtime: Runtime, token: string) => `${runtime.origin}/auth?token=${token}`;
