import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where the owner keeps their model server's address and key on a machine that runs the e2e specs, outside the repository. */
export const MODEL_SERVER_FILE = join(homedir(), ".config", "mirador", "e2e-model-server.env");
const MODEL_SERVER_MODEL = "radiance-qwen3.8-flash-next";
/** Nothing listens here: without a model server, a spec that waits for a real reply fails instead of spending a Claude subscription. */
export const NO_MODEL_SERVER = "http://127.0.0.1:9";
/** Without retries, so such a spec fails at its first request rather than after minutes of backing off. */
const NOWHERE = { ANTHROPIC_BASE_URL: NO_MODEL_SERVER, ANTHROPIC_AUTH_TOKEN: "no-e2e-model-server", CLAUDE_CODE_MAX_RETRIES: "0" };

/** `NAME=value` lines, a value optionally quoted; blank lines and `#` comments are skipped. */
export function settingsIn(text: string): Record<string, string> {
  return Object.fromEntries(
    text.split(/\r?\n/).flatMap((line) => {
      const setting = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (!setting) return [];
      const value = setting[2]!.trim();
      return [[setting[1]!, /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value]];
    }),
  );
}

/**
 * What a test host's Claude Code talks to: the owner's model server, named by LLM_SERVER_URL and LLM_SERVER_KEY in the
 * run's environment or in MODEL_SERVER_FILE, on its one model, as the Windows workflow has it. It wins over a server the
 * run inherited, such as the paid gateway of the agent that runs the specs. Only with none named does a run already
 * pointed at a server keep it, as the Windows workflow points its own; otherwise an address nothing answers, so the
 * owner's own login is never used.
 */
export function modelServerEnvironment(run: NodeJS.ProcessEnv, savedFile: string | null): Record<string, string> {
  const saved = savedFile === null ? {} : settingsIn(savedFile);
  const url = run.LLM_SERVER_URL || saved.LLM_SERVER_URL;
  const key = run.LLM_SERVER_KEY || saved.LLM_SERVER_KEY;
  if (!url || !key) return run.ANTHROPIC_BASE_URL ? {} : NOWHERE;
  return {
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_AUTH_TOKEN: key,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: MODEL_SERVER_MODEL,
    ANTHROPIC_DEFAULT_SONNET_MODEL: MODEL_SERVER_MODEL,
    ANTHROPIC_DEFAULT_OPUS_MODEL: MODEL_SERVER_MODEL,
    ANTHROPIC_SMALL_FAST_MODEL: MODEL_SERVER_MODEL,
    ENABLE_TOOL_SEARCH: "false",
  };
}

let toldNoModelServer = false;

/** This machine's model server for the test hosts, saying once per run when there is none. */
export function ownersModelServer(): Record<string, string> {
  const environment = modelServerEnvironment(process.env, existsSync(MODEL_SERVER_FILE) ? readFileSync(MODEL_SERVER_FILE, "utf8") : null);
  if (environment.ANTHROPIC_BASE_URL === NO_MODEL_SERVER && !toldNoModelServer) {
    toldNoModelServer = true;
    console.warn(`No e2e model server: set LLM_SERVER_URL and LLM_SERVER_KEY, or write them to ${MODEL_SERVER_FILE}. Specs that wait for a real Claude reply will fail.`);
  }
  return environment;
}
