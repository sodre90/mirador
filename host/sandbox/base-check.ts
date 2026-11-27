import type { BaseImageNeed } from "../../shared/sandbox.ts";
import { SHELL_IN_VM } from "./agent-environment.ts";
import { BUN_IN_VM, NODE_FOLDER_IN_VM, TOOLS_IN_VM } from "./tools-folder.ts";
import type { ThrowawayRun } from "./vm-launcher.ts";

const CHECK_STARTED = "mirador-base-check";
const LACKS = "lacks ";
const PATH_IS = "PATH=";
const NEEDS: BaseImageNeed[] = ["bash", "git", "glibc"];

const CHECK_SCRIPT = [
  `echo ${CHECK_STARTED}`,
  `[ -x ${SHELL_IN_VM} ] || echo ${LACKS}bash`,
  `command -v git >/dev/null || echo ${LACKS}git`,
  `{ ${BUN_IN_VM} --version && ${NODE_FOLDER_IN_VM}/node --version; } >/dev/null 2>&1 || echo ${LACKS}glibc`,
  `echo "${PATH_IS}$PATH"`,
].join("\n");

const NOBODY = "65534:65534";

export const CHECK_TIMEOUT_MS = 2 * 60_000;

/**
 * The check of an owner's base image: a throwaway run of it as nobody, with no network, which sees the tools folder and
 * says what of the agents' needs the image lacks, then the PATH it sets.
 */
export const baseCheck = (image: string, toolsFolder: string): ThrowawayRun => ({
  image,
  entrypoint: "/bin/sh",
  args: ["-c", CHECK_SCRIPT],
  user: NOBODY,
  network: false,
  mounts: [{ source: toolsFolder, target: TOOLS_IN_VM, readOnly: true }],
});

/** What a base image is to the agents: usable, with the PATH it sets, null where it sets none; or what it lacks. */
export type BaseVerdict = { path: string | null } | { lacks: BaseImageNeed[] };

const isNeed = (value: string): value is BaseImageNeed => NEEDS.some((need) => need === value);

/**
 * What the check said of the image, where it ran to its end: null where it didn't, as where the image has no /bin/sh
 * or the runtime failed to start it, which says nothing of the image for sure.
 */
export function verdictIn(output: string): BaseVerdict | null {
  const lines = output.split("\n").map((line) => line.trim());
  const said = lines.slice(lines.indexOf(CHECK_STARTED) + 1);
  const path = said.findLast((line) => line.startsWith(PATH_IS));
  if (!lines.includes(CHECK_STARTED) || path === undefined) return null;
  const lacks = said.flatMap((line) => (line.startsWith(LACKS) ? [line.slice(LACKS.length)] : [])).filter(isNeed);
  return lacks.length > 0 ? { lacks } : { path: path.slice(PATH_IS.length) || null };
}

const AGENT_CHECK_STARTED = "mirador-agent-check";
const AGENT_RUNS = "agent-runs";
const AGENT_FAILS = "agent-fails ";

/** Runs the program for its version, as nobody, whose home the image may lack: what it said last where it failed, else how it exited. */
const agentCheckScript = (program: string) => `echo ${AGENT_CHECK_STARTED}
said=$(HOME=/tmp DISABLE_AUTOUPDATER=1 '${program}' --version 2>&1)
exited=$?
newline='
'
if [ "$exited" -eq 0 ]; then echo ${AGENT_RUNS}; else last=\${said##*"$newline"}; echo "${AGENT_FAILS}\${last:-exit $exited}"; fi`;

/** The check that an agent kind's own program runs on an owner's base image: as nobody, with no network, from the tools folder. */
export const agentCheck = (image: string, toolsFolder: string, program: string): ThrowawayRun => ({
  ...baseCheck(image, toolsFolder),
  args: ["-c", agentCheckScript(program)],
});

/** Whether the agent's program ran, or what it said as it failed; null where the check didn't get that far, which says nothing of the image for sure. */
export function agentVerdictIn(output: string): { runs: true } | { fails: string } | null {
  const lines = output.split("\n").map((line) => line.trim());
  if (!lines.includes(AGENT_CHECK_STARTED)) return null;
  const said = lines.slice(lines.indexOf(AGENT_CHECK_STARTED) + 1);
  if (said.includes(AGENT_RUNS)) return { runs: true };
  const failed = said.find((line) => line.startsWith(AGENT_FAILS));
  return failed === undefined ? null : { fails: failed.slice(AGENT_FAILS.length) };
}
