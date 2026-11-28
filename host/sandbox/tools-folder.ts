import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SandboxedHarness, SandboxSetup, SandboxTool } from "../../shared/sandbox.ts";
import { lastLineOf } from "./container-cli.ts";
import type { Mount, ThrowawayRun, VmLauncher } from "./vm-launcher.ts";

/** Where every VM sees the tools folder, read-only: Mirador's guard, Bun and each agent kind's programs, at their versions. */
export const TOOLS_IN_VM = "/opt/mirador";

/** The tools folder of this Mirador, which only it writes, from throwaway containers it runs. */
export const toolsFolderOf = (dataDir: string) => join(dataDir, "sandbox-tools");

/** An agent kind at the version of its program on this computer, which its sandbox runs. */
export interface AgentTools {
  harness: SandboxedHarness;
  version: string;
}

const GUARD_SOURCE = join(import.meta.dir, "guard");

/** The guard's source and how it is built, by name: another of either is another guard. */
export const guardSource = (): Record<string, string> =>
  Object.fromEntries(
    readdirSync(GUARD_SOURCE)
      .filter((name) => /\.(cpp|hpp|sh)$/.test(name))
      .toSorted()
      .map((name) => [name, readFileSync(join(GUARD_SOURCE, name), "utf8")]),
  );

const shortHashOf = (parts: Record<string, string>) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 10);

/** The Node.js every VM has, with npm: the major version of the installers' image. */
const NODE_MAJOR = "22";

const GUARD_FOLDER = `guard-${shortHashOf(guardSource())}`;
const BUN_FOLDER = `bun-${Bun.version}`;
const NODE_FOLDER = `node-${NODE_MAJOR}`;

/** The guard in the VM, by its whole path: the VM's first process, and what drops each command started there to its user. */
export const GUARD_IN_VM = `${TOOLS_IN_VM}/${GUARD_FOLDER}/mirador-guard`;

/** The Bun this computer runs, which runs Mirador's relays, its in-VM scripts and the ACP adapters there. */
export const BUN_IN_VM = `${TOOLS_IN_VM}/${BUN_FOLDER}/bin/bun`;

export const BUN_FOLDER_IN_VM = `${TOOLS_IN_VM}/${BUN_FOLDER}/bin`;

export const NODE_FOLDER_IN_VM = `${TOOLS_IN_VM}/${NODE_FOLDER}/bin`;

const agentFolder = ({ harness, version }: AgentTools) => `${harness}-${version}`;

/** Where an agent kind's programs are in the VM, at its version. */
export const agentProgramsInVm = (agent: AgentTools) => `${TOOLS_IN_VM}/${agentFolder(agent)}/bin`;

/** The installers' image, where npm and the Node.js the agents run on come from. */
const NODE_IMAGE = `docker.io/library/node:${NODE_MAJOR}-bookworm-slim`;

/** Alpine's packages hold the static libraries the guard links. */
const GUARD_BUILD_IMAGE = "docker.io/library/alpine:3.22";

/** Each kind's npm package and its program, and whether that is a program of its own, not a script that Node.js runs. */
const AGENT_PACKAGES: Record<SandboxedHarness, { npmPackage: string; program: string; native: boolean }> = {
  claude: { npmPackage: "@anthropic-ai/claude-code", program: "claude", native: true },
  pi: { npmPackage: "@earendil-works/pi-coding-agent", program: "pi", native: false },
};

/** The agent kind's program in the VM where it is one of its own, which a base image may lack what it needs to run; null where Node.js runs it. */
export function nativeProgramInVm(agent: AgentTools) {
  const { program, native } = AGENT_PACKAGES[agent.harness];
  return native ? `${agentProgramsInVm(agent)}/${program}` : null;
}

const INSTALLED_INTO = "/out";

/** The image's Node.js with npm, npx and corepack, their links kept as they are. */
const NODE_COPIED = [
  `mkdir -p ${INSTALLED_INTO}/bin ${INSTALLED_INTO}/lib/node_modules`,
  `cp -a /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack ${INSTALLED_INTO}/bin/`,
  `cp -a /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack ${INSTALLED_INTO}/lib/node_modules/`,
  `${INSTALLED_INTO}/bin/node --version`,
].join("; ");
const npmInstall = (packageAt: string) => `npm install --global --prefix ${INSTALLED_INTO} --no-fund --no-audit --loglevel=error ${packageAt}`;

/** How each tool is installed: the folder it goes in, and the throwaway container that puts it there, which prints its version last. */
function installOf(tool: SandboxTool): { folder: string; run: ThrowawayRun } {
  const shell = (image: string, script: string, mounts: Mount[] = []): ThrowawayRun => ({ image, entrypoint: "/bin/sh", args: ["-c", `set -eu; ${script}`], user: "0:0", network: true, mounts });
  if (tool.kind === "guard") {
    const build = `sh /src/build.sh /src ${INSTALLED_INTO}`;
    return { folder: GUARD_FOLDER, run: shell(GUARD_BUILD_IMAGE, build, [{ source: GUARD_SOURCE, target: "/src", readOnly: true }]) };
  }
  if (tool.kind === "bun") return { folder: BUN_FOLDER, run: shell(NODE_IMAGE, `${npmInstall(`bun@${tool.version}`)}; ${INSTALLED_INTO}/bin/bun --version`) };
  if (tool.kind === "node") return { folder: NODE_FOLDER, run: shell(NODE_IMAGE, NODE_COPIED) };
  const { npmPackage, program } = AGENT_PACKAGES[tool.kind];
  const script = `${npmInstall(`${npmPackage}@${tool.version}`)}; PATH=${INSTALLED_INTO}/bin:$PATH PI_OFFLINE=1 DISABLE_AUTOUPDATER=1 ${program} --version`;
  return { folder: agentFolder({ harness: tool.kind, version: tool.version }), run: shell(NODE_IMAGE, script) };
}

/** The tools every VM runs on, whatever its agents: the guard, this computer's Bun, and Node.js with npm. */
export const TOOLS_OF_EVERY_VM: SandboxTool[] = [{ kind: "guard" }, { kind: "bun", version: Bun.version }, { kind: "node", version: NODE_MAJOR }];

export const toolOfAgent = ({ harness, version }: AgentTools): SandboxTool => ({ kind: harness, version });

export class ToolInstallFailed extends Error {}

/** How far fetching an installer's image got, as a tool's install tells it: nothing once it is fetched. */
export type InstallerFetch = Pick<SandboxSetup, "fetching" | "percent" | "unpacking">;

/** An image by the name its owner would write: Docker Hub's official images without their registry and `library/`. */
const shortImageName = (image: string) => image.replace(/^docker\.io\/library\//, "");

const INSTALL_TIMEOUT_MS = 20 * 60_000;
const STAGING = ".staging-";
/** Each VM's nobody, who runs the relays, and its agents' user reach every tool; only this computer's user changes them. */
const READ_BY_EVERY_USER_OF_THE_VM = 0o755;

/**
 * The tools folder on this computer, mounted read-only in every VM. Each tool is installed by a throwaway container into
 * a folder of its own, then renamed into place whole, so a VM, which sees the folder change as it runs, never sees half
 * of one. Nothing here is ever run on this computer, and nothing is followed: what the installers leave are their files.
 */
export class ToolsFolder {
  readonly root: string;

  constructor(
    dataDir: string,
    private readonly launcher: Pick<VmLauncher, "installerImage" | "runOnce">,
  ) {
    this.root = toolsFolderOf(dataDir);
  }

  async has(tool: SandboxTool) {
    return (await stat(join(this.root, installOf(tool).folder)).catch(() => null))?.isDirectory() === true;
  }

  /**
   * Installs the tool where it is not here yet, its installer's image fetched first where it is not here, how far that
   * got told; throws ToolInstallFailed, with what the fetch or the installer said last, where it fails.
   */
  async install(tool: SandboxTool, told: (fetch: InstallerFetch) => void = () => {}) {
    if (await this.has(tool)) return;
    const { folder, run } = installOf(tool);
    await this.fetchInstaller(run.image, told);
    await mkdir(this.root, { recursive: true, mode: READ_BY_EVERY_USER_OF_THE_VM });
    const staging = await mkdtemp(join(this.root, STAGING));
    try {
      const ran = await this.launcher.runOnce({ ...run, mounts: [...run.mounts, { source: staging, target: INSTALLED_INTO, readOnly: false }] }, INSTALL_TIMEOUT_MS);
      if (ran.exitCode !== 0) throw new ToolInstallFailed(lastLineOf(ran.output) || `exit ${ran.exitCode}`);
      await chmod(staging, READ_BY_EVERY_USER_OF_THE_VM);
      await rename(staging, join(this.root, folder));
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  /** The installer's image is here, fetched where it was not, each move of the fetch told once, then that it is over. */
  private async fetchInstaller(image: string, told: (fetch: InstallerFetch) => void) {
    let last: InstallerFetch | null = null;
    const moved = ({ percent, unpacking }: SandboxSetup) => {
      if (last && last.percent === percent && last.unpacking === unpacking) return;
      last = { fetching: shortImageName(image), ...(percent === undefined ? {} : { percent }), ...(unpacking ? { unpacking } : {}) };
      told(last);
    };
    try {
      await this.launcher.installerImage(image, moved);
    } catch (error) {
      throw new ToolInstallFailed(`fetching ${shortImageName(image)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (last) told({});
  }

  /** Removes every tool but these, and what an install cut short left; no VM may be running. */
  async keepOnly(kept: SandboxTool[]) {
    const keptFolders = new Set(kept.map((tool) => installOf(tool).folder));
    const entries = await readdir(this.root).catch(() => [] as string[]);
    await Promise.all(entries.filter((name) => !keptFolders.has(name)).map((name) => rm(join(this.root, name), { recursive: true, force: true })));
  }
}
