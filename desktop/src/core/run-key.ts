import type { LoginItem } from "./open-at-login.ts";
import { systemProgram } from "./scheduled-task.ts";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

export const runValueName = (port: number) => `Mirador-${port}`;

export type SyncCommandRunner = (argv: string[]) => { exitCode: number; output: string };

const runCommandSync: SyncCommandRunner = (argv) => {
  const { exitCode, stdout, stderr } = Bun.spawnSync(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
  return { exitCode, output: `${stdout}${stderr}`.trim() };
};

/**
 * The Windows counterpart of the open-at-login LaunchAgent: a value in the account's Run key, which Windows starts at
 * login. It names the launcher alone: the launcher drops its arguments, and a Run value carries no environment, so an
 * app on another port or data folder than the default cannot be opened this way.
 */
export class RunKeyEntry implements LoginItem {
  constructor(
    private readonly port: number,
    private readonly launcherPath: string | null,
    private readonly overrides: Record<string, string>,
    private readonly run: SyncCommandRunner = runCommandSync,
  ) {}

  get available() {
    return this.launcherPath !== null && Object.keys(this.overrides).length === 0;
  }

  enable() {
    if (this.launcherPath === null) throw new Error("This copy is not an installed app, so there is nothing to open at login.");
    if (!this.available) throw new Error("Windows opens Mirador at login only on its default port and data folder.");
    this.reg("add", RUN_KEY, "/v", runValueName(this.port), "/t", "REG_SZ", "/d", `"${this.launcherPath}"`, "/f");
  }

  disable() {
    if (this.run([systemProgram("reg.exe"), "query", RUN_KEY, "/v", runValueName(this.port)]).exitCode !== 0) return;
    this.reg("delete", RUN_KEY, "/v", runValueName(this.port), "/f");
  }

  private reg(...arguments_: string[]) {
    const { exitCode, output } = this.run([systemProgram("reg.exe"), ...arguments_]);
    if (exitCode !== 0) throw new Error(`Could not change what Windows opens at login: ${output || `reg exited with ${exitCode}`}`);
  }
}
