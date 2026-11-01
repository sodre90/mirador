import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BackgroundHost, BackgroundHostEnvironment } from "./background-host.ts";
import { runCommand, type CommandRunner } from "./commands.ts";
import { hostArgv } from "./host-command.ts";
import type { DesktopSettings } from "./settings.ts";

export const hostServiceName = (port: number) => `mirador-host-${port}.service`;
export const userUnitPath = (configHome: string, name: string) => join(configHome, "systemd", "user", name);

const escapeSpecifiers = (text: string) => text.replaceAll("%", "%%");

/** One ExecStart argument, quoted so systemd neither splits it nor expands `$NAME` or `%x` in it. */
export const execStartArgument = (argument: string) =>
  `"${escapeSpecifiers(argument.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", () => "$$"))}"`;

export interface HostServiceSpec {
  port: number;
  argv: string[];
  workingDirectory: string;
  logPath: string;
}

export const hostServiceUnit = ({ port, argv, workingDirectory, logPath }: HostServiceSpec) =>
  [
    "[Unit]",
    `Description=Mirador host on port ${port}`,
    "",
    "[Service]",
    `ExecStart=${argv.map(execStartArgument).join(" ")}`,
    `WorkingDirectory=${escapeSpecifiers(workingDirectory)}`,
    "Restart=always",
    `StandardOutput=append:${escapeSpecifiers(logPath)}`,
    `StandardError=append:${escapeSpecifiers(logPath)}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");

export const systemctl = (...arguments_: string[]) => ["systemctl", "--user", ...arguments_];

/** The Linux counterpart of the background LaunchAgent: a systemd user service, enabled so it also starts at login. */
export class HostUserService implements BackgroundHost {
  constructor(
    private readonly port: number,
    private readonly unitPath: string,
    private readonly environment: BackgroundHostEnvironment,
    private readonly run: CommandRunner = runCommand,
  ) {}

  private get name() {
    return hostServiceName(this.port);
  }

  async isLoaded() {
    return (await this.run(systemctl("is-enabled", "--quiet", this.name))).exitCode === 0;
  }

  async ensureLoaded(settings: DesktopSettings) {
    const unit = this.unitFor(settings);
    if ((await this.isLoaded()) && this.unitText() === unit) return;
    mkdirSync(dirname(this.environment.logPath), { recursive: true });
    mkdirSync(dirname(this.unitPath), { recursive: true });
    writeFileSync(this.unitPath, unit);
    await this.systemctlOrThrow("reload the user units", "daemon-reload");
    await this.systemctlOrThrow(`enable ${this.name}`, "enable", this.name);
    await this.systemctlOrThrow(`start ${this.name}`, "restart", this.name);
  }

  restart() {
    return this.systemctlOrThrow(`restart ${this.name}`, "restart", this.name);
  }

  async remove() {
    if (await this.isLoaded()) await this.systemctlOrThrow(`stop ${this.name}`, "disable", "--now", this.name);
    rmSync(this.unitPath, { force: true });
    await this.systemctlOrThrow("reload the user units", "daemon-reload");
  }

  async stopBeforeUpdate() {}

  private unitText() {
    try {
      return readFileSync(this.unitPath, "utf8");
    } catch {
      return null;
    }
  }

  private unitFor(settings: DesktopSettings) {
    const { shell, overrides, logPath } = this.environment;
    return hostServiceUnit({ port: this.port, argv: hostArgv(shell, settings.bun, overrides, settings.hostDirectory), workingDirectory: settings.hostDirectory, logPath });
  }

  private async systemctlOrThrow(action: string, ...arguments_: string[]) {
    const { exitCode, output } = await this.run(systemctl(...arguments_));
    if (exitCode !== 0) throw new Error(`Could not ${action}: ${output || `systemctl exited with ${exitCode}`}`);
  }
}
