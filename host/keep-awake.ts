import type { KeepAwake } from "../shared/model.ts";

export interface AwakeHold {
  release(): void;
}

/** Null where the platform has no way to hold the computer awake. */
export type HoldAwake = () => AwakeHold | null;

export const wantsAwake = (keepAwake: KeepAwake, runningTurns: number) => keepAwake === "always" || (keepAwake === "while-working" && runningTurns > 0);

/**
 * Holds off idle sleep only: no program can stop the sleep that comes from closing a laptop's lid without root.
 * Both commands watch the host's process, so the hold ends with the host even when it is killed.
 */
export function awakeCommand(platform: NodeJS.Platform, hostPid: number): string[] | null {
  if (platform === "darwin") return ["caffeinate", "-i", "-w", String(hostPid)];
  if (platform === "linux") return ["systemd-inhibit", "--what=idle", "--who=Mirador", "--why=Keep awake is on in Mirador's settings", "tail", `--pid=${hostPid}`, "-f", "/dev/null"];
  return null;
}

export function holdAwakeWithSystemCommand(command = awakeCommand(process.platform, process.pid)): HoldAwake {
  return () => {
    if (!command) return null;
    try {
      const child = Bun.spawn(command, { stdio: ["ignore", "ignore", "pipe"] });
      let released = false;
      void child.exited.then(async (code) => {
        if (!released) console.error(`keeping the computer awake stopped on its own (${command[0]} exited with ${code}): ${(await new Response(child.stderr).text()).trim()}`);
      });
      return {
        release: () => {
          released = true;
          child.kill();
        },
      };
    } catch (error) {
      console.error(`keeping the computer awake failed: ${error}`);
      return null;
    }
  };
}

/** Follows the setting and the number of running turns, holding the computer awake while they ask for it. */
export class KeepAwakeHold {
  private hold: AwakeHold | null = null;
  private keepAwake: KeepAwake;
  private runningTurns = 0;

  constructor(
    keepAwake: KeepAwake,
    private readonly holdAwake: HoldAwake = holdAwakeWithSystemCommand(),
  ) {
    this.keepAwake = keepAwake;
    this.apply();
  }

  setKeepAwake(keepAwake: KeepAwake) {
    this.keepAwake = keepAwake;
    this.apply();
  }

  setRunningTurns(count: number) {
    this.runningTurns = count;
    this.apply();
  }

  stop() {
    this.hold?.release();
    this.hold = null;
  }

  private apply() {
    const wanted = wantsAwake(this.keepAwake, this.runningTurns);
    if (wanted && !this.hold) this.hold = this.holdAwake();
    else if (!wanted) this.stop();
  }
}
