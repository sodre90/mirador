import { AutostartEntry, autostartEntryPath } from "./autostart.ts";
import { BackgroundHostAgent, type BackgroundHost } from "./background-host.ts";
import { runCommand } from "./commands.ts";
import { hostAgentLabel, launchAgentPath, openAtLoginLabel } from "./launch-agents.ts";
import { LaunchAgent } from "./launchd.ts";
import { OpenAtLogin, type LoginItem } from "./open-at-login.ts";
import { systemProcesses } from "./processes.ts";
import { RunKeyEntry } from "./run-key.ts";
import { HostScheduledTask, type HostTaskFiles } from "./scheduled-task.ts";
import { hostServiceName, HostUserService, userUnitPath } from "./systemd.ts";
import { interruptConsoleOf } from "./windows-console.ts";
import { parentOf } from "./windows-processes.ts";

export interface PlatformContext {
  platform: NodeJS.Platform;
  appName: string;
  port: number;
  home: string;
  configHome: string;
  appPath: string | null;
  shell: string;
  overrides: Record<string, string>;
  hostLog: string;
  hostTaskFiles: HostTaskFiles;
}

export interface PlatformServices {
  openAtLogin: LoginItem;
  background: BackgroundHost;
}

/**
 * launchd LaunchAgents on macOS; on Linux a systemd user service for the host and an XDG autostart entry for the app;
 * on Windows a scheduled task for the host and a Run key value for the app.
 */
export function platformServices(context: PlatformContext): PlatformServices {
  const { platform, appName, port, home, configHome, appPath, shell, overrides, hostLog, hostTaskFiles } = context;
  const backgroundEnvironment = { shell, overrides, logPath: hostLog };
  if (platform === "linux") {
    return {
      openAtLogin: new AutostartEntry(autostartEntryPath(configHome, port), { appName, overrides }, appPath),
      background: new HostUserService(port, userUnitPath(configHome, hostServiceName(port)), backgroundEnvironment),
    };
  }
  if (platform === "win32") {
    const ports = { run: runCommand, processes: systemProcesses, parentOf, interrupt: interruptConsoleOf, pause: Bun.sleep };
    return {
      openAtLogin: new RunKeyEntry(port, appPath, overrides),
      background: new HostScheduledTask(port, hostTaskFiles, backgroundEnvironment, ports),
    };
  }
  const agentAt = (label: string) => new LaunchAgent(label, launchAgentPath(home, label), process.getuid!());
  return {
    openAtLogin: new OpenAtLogin(agentAt(openAtLoginLabel(port)), appPath, overrides),
    background: new BackgroundHostAgent(agentAt(hostAgentLabel(port)), backgroundEnvironment),
  };
}
