import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TerminalActivity } from "../shared/model.ts";

const POLL_INTERVAL_MS = 2_000;

interface RegisteredSession {
  pid: number;
  sessionId: string;
  entrypoint?: string;
  status?: string;
}

export const claudeConfigDir = (environment: Record<string, string>) => environment.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

const activityOf = (status: string | undefined): TerminalActivity =>
  status === "busy" ? "working" : status === "waiting" ? "waiting" : "idle";

/** A session open in several terminals shows what the busiest one is doing. */
const urgency: TerminalActivity[] = ["idle", "waiting", "working"];

function isRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readRegistration(path: string): Promise<RegisteredSession | null> {
  try {
    const session = JSON.parse(await readFile(path, "utf8"));
    return typeof session.pid === "number" && typeof session.sessionId === "string" ? session : null;
  } catch {
    return null;
  }
}

/**
 * Claude Code registers every running session as <config dir>/sessions/<pid>.json. Sessions in a
 * terminal register with entrypoint "cli"; the app's own, run through the Agent SDK, with "sdk-ts".
 */
export async function sessionsOpenInTerminals(configDir: string): Promise<Map<string, TerminalActivity>> {
  const directory = join(configDir, "sessions");
  const names = await readdir(directory).catch((): string[] => []);
  const registered = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readRegistration(join(directory, name))));
  const activityBySession = new Map<string, TerminalActivity>();
  registered
    .filter((session): session is RegisteredSession => session?.entrypoint === "cli" && isRunning(session.pid))
    .forEach(({ sessionId, status }) => {
      const activity = activityOf(status);
      const known = activityBySession.get(sessionId);
      if (!known || urgency.indexOf(activity) > urgency.indexOf(known)) activityBySession.set(sessionId, activity);
    });
  return activityBySession;
}

export class TerminalSessionWatcher {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    private readonly configDirs: () => string[],
    private readonly onChange: (activityBySession: Map<string, TerminalActivity>) => void,
  ) {}

  start() {
    this.scheduleNextPoll();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private scheduleNextPoll() {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      await this.poll().catch(() => {});
      this.scheduleNextPoll();
    }, POLL_INTERVAL_MS);
  }

  private async poll() {
    const found = await Promise.all([...new Set(this.configDirs())].map(sessionsOpenInTerminals));
    this.onChange(new Map(found.flatMap((activityBySession) => [...activityBySession])));
  }
}
