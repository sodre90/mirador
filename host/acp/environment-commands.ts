import type { Profile } from "../../shared/model.ts";
import { HostProblemError, type PrelaunchFailure } from "../../shared/host-problems.ts";
import { parseEnvironment } from "../../shared/profile-environment.ts";
import { commandLine, commandShell } from "../command-shell.ts";

/** As long as a pre-launch command gets: a password manager may ask the user first. */
const COMMAND_GIVES_UP_AFTER_MS = 60_000;
const OUTPUT_IN_ERRORS = 500;

type CommandProfile = Pick<Profile, "id" | "name" | "environment">;

/** What each profile's commands printed when they last ran, by profile and command. Only here, so a secret is in no file and not in the database. */
const lastPrinted = new Map<string, string>();

const keyOf = ({ id }: CommandProfile, command: string) => JSON.stringify([id, command]);

const withoutFinalLineBreaks = (text: string) => text.replace(/[\r\n]+$/, "");

/** The profile's variables whose command has run since Mirador started, with what it last printed. */
export function commandValues(profile: CommandProfile): Record<string, string> {
  const { commands } = parseEnvironment(profile.environment);
  return Object.fromEntries(
    Object.entries(commands).flatMap(([name, command]) => {
      const printed = lastPrinted.get(keyOf(profile, command));
      return printed === undefined ? [] : [[name, printed]];
    }),
  );
}

/** Runs the profile's commands for what they print now, in the shell its pre-launch command runs in, and throws when one prints nothing. */
export async function readCommandValues(profile: CommandProfile, environment: Record<string, string>, signal?: AbortSignal) {
  await readCommands(profile, Object.entries(parseEnvironment(profile.environment).commands), environment, signal);
}

/** Runs those of the profile's commands that have not run since Mirador started. */
export async function readMissingCommandValues(profile: CommandProfile, environment: () => Record<string, string>) {
  const missing = Object.entries(parseEnvironment(profile.environment).commands).filter(([, command]) => !lastPrinted.has(keyOf(profile, command)));
  if (missing.length > 0) await readCommands(profile, missing, environment());
}

async function readCommands(profile: CommandProfile, commands: [name: string, command: string][], environment: Record<string, string>, signal?: AbortSignal) {
  await Promise.all(commands.map(async ([name, command]) => lastPrinted.set(keyOf(profile, command), await printedBy(command, name, profile, environment, signal))));
}

async function printedBy(command: string, variable: string, { name }: CommandProfile, environment: Record<string, string>, stopped = new AbortController().signal) {
  const failed = (failure: PrelaunchFailure, output = "") => new HostProblemError({ code: "environment-command-failed", profile: name, variable, failure, output });
  const timedOut = AbortSignal.timeout(COMMAND_GIVES_UP_AFTER_MS);
  const givenUp = AbortSignal.any([stopped, timedOut]);
  const child = startedOr((cause) => failed({ kind: "could-not-run", cause }), command, environment, givenUp);
  // What the command started may hold its output open after it was killed, so giving up doesn't wait for the output to end.
  const ended = await Promise.race([abortOf(givenUp), Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])]);
  if (timedOut.aborted) throw failed({ kind: "timed-out", seconds: COMMAND_GIVES_UP_AFTER_MS / 1000 });
  if (ended === "aborted") throw failed({ kind: "could-not-run", cause: "stopped" });
  const [stdout, stderr, exitCode] = ended;
  if (exitCode !== 0) throw failed({ kind: "exited", how: String(child.signalCode ?? exitCode) }, stderr.trim().slice(-OUTPUT_IN_ERRORS));
  const value = withoutFinalLineBreaks(stdout);
  if (value === "") throw new HostProblemError({ code: "environment-command-printed-nothing", profile: name, variable });
  return value;
}

const abortOf = (signal: AbortSignal) =>
  new Promise<"aborted">((resolve) => (signal.aborted ? resolve("aborted") : signal.addEventListener("abort", () => resolve("aborted"), { once: true })));

function startedOr(problem: (cause: string) => Error, command: string, environment: Record<string, string>, signal: AbortSignal) {
  try {
    const shell = commandShell(() => process.env.SHELL || "/bin/sh", environment);
    return Bun.spawn(commandLine(shell, command), { env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe", signal });
  } catch (error) {
    throw problem((error as Error).message);
  }
}
