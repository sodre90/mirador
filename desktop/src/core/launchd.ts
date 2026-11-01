import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { runCommand, type CommandRunner } from "./commands.ts";
import { launchctl } from "./launch-agents.ts";

export class LaunchAgent {
  constructor(
    readonly label: string,
    readonly plistPath: string,
    private readonly uid: number,
    private readonly run: CommandRunner = runCommand,
  ) {}

  async isLoaded() {
    return (await this.run(launchctl.print(this.uid, this.label))).exitCode === 0;
  }

  plistText() {
    try {
      return readFileSync(this.plistPath, "utf8");
    } catch {
      return null;
    }
  }

  writePlist(text: string) {
    mkdirSync(dirname(this.plistPath), { recursive: true });
    writeFileSync(this.plistPath, text);
  }

  async bootstrap() {
    await this.runOrThrow(launchctl.bootstrap(this.uid, this.plistPath), "load");
  }

  async kickstart() {
    await this.runOrThrow(launchctl.kickstart(this.uid, this.label), "restart");
  }

  async unload() {
    if (await this.isLoaded()) await this.runOrThrow(launchctl.bootout(this.uid, this.label), "unload");
  }

  async uninstall() {
    await this.unload();
    rmSync(this.plistPath, { force: true });
  }

  private async runOrThrow(argv: string[], action: string) {
    const { exitCode, output } = await this.run(argv);
    if (exitCode !== 0) throw new Error(`Could not ${action} ${this.label}: ${output || `launchctl exited with ${exitCode}`}`);
  }
}
