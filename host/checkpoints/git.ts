import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Workspace } from "../../shared/model.ts";
import { HostProblemError } from "../../shared/host-problems.ts";

/** Mirador's own commits need no identity or signing setup from the user's git config. */
export const IDENTITY = ["-c", "user.name=mirador", "-c", "user.email=mirador@localhost", "-c", "commit.gpgsign=false"];
const WITHOUT_AUTOCRLF = ["-c", "core.autocrlf=false"];
/**
 * core.safecrlf=true makes git add refuse a file whose line endings it would not check out as they are. Undo keeps each
 * file's own bytes beside what git stores and a tour only shows the diff, so neither needs that check. A file a filter
 * cleans is the one undo checks out, through the filter, with git's line endings, as it does without the setting.
 */
export const WITHOUT_SAFECRLF = ["-c", "core.safecrlf=false"];

const SUBMODULE_MODE = "160000";
export const SYMLINK_MODE = "120000";
export const EXECUTABLE_MODE = "100755";
/** The mode git gives the side of a change that has no file; given to update-index, it takes the path out. */
export const NO_FILE_MODE = "000000";

/**
 * Where git runs on paths from the repository's top, the workspace folder's own path from there, the user's index, and
 * HEAD, which is "" before the first commit.
 */
export type Location = { atTop: Workspace; prefix: string; usersIndex: string; head: string };

export type Entry = { mode: string; blob: string; path: string };
export type Change = ReturnType<typeof changesIn>[number];

/**
 * git's `-z --raw` output: each change's modes, objects and status (":100644 100644 <old> <new> M"), then its path, each
 * ended by NUL, with names left as they are.
 */
export function changesIn(output: string) {
  const fields = output.split("\0").filter(Boolean);
  return fields.flatMap((field, index) => {
    if (index % 2 === 1) return [];
    const [fromMode = "", toMode = "", fromBlob = "", toBlob = "", status = ""] = field.slice(1).split(" ");
    return [{ status, path: fields[index + 1] ?? "", fromMode, toMode, fromBlob, toBlob, submodule: fromMode === SUBMODULE_MODE || toMode === SUBMODULE_MODE }];
  });
}

type GitOptions = { input?: string; index?: string; ownIndex?: string; pathspecMagic?: boolean };

/** git as checkpoints run it: in the workspace's repository, on index files of our own kept in Mirador's data folder. */
export class CheckpointGit {
  constructor(private readonly dataDir: string) {}

  /** One of our files for the workspace, such as its staging index, named by the workspace and the suffix. */
  fileOf(workspace: Workspace, suffix: string) {
    return join(this.dataDir, "checkpoints", `${workspace.id}${suffix}`);
  }

  async run(workspace: Workspace, args: string[], options: GitOptions = {}) {
    const { stdout, stderr, exitCode } = await this.runForBytes(workspace, args, options);
    return { stdout: new TextDecoder().decode(stdout).trim(), stderr, exitCode };
  }

  /** git for the calls whose failure the user has to hear about, rather than one that only answers a question. */
  async mustRun(workspace: Workspace, args: string[], options: GitOptions = {}) {
    const result = await this.run(workspace, args, options);
    if (result.exitCode !== 0) throw new HostProblemError({ code: "git-failed", command: args[0], directory: workspace.path, output: result.stderr || result.stdout });
    return result;
  }

  /** Like `mustRun`, with git's output as the bytes it wrote. */
  async mustRunForBytes(workspace: Workspace, args: string[], options: GitOptions = {}) {
    const result = await this.runForBytes(workspace, args, options);
    if (result.exitCode !== 0) throw new HostProblemError({ code: "git-failed", command: args[0], directory: workspace.path, output: result.stderr });
    return result;
  }

  /**
   * On our staging index unless told another; paths given to git are taken as they are, never as patterns, unless
   * `pathspecMagic` asks for git's own matching, which an exclude pathspec needs. Files go into our own indexes and back
   * out without core.autocrlf's conversion, while the user's index is compared with their own.
   */
  private async runForBytes(workspace: Workspace, args: string[], { input, index, ownIndex, pathspecMagic }: GitOptions = {}) {
    await mkdir(join(this.dataDir, "checkpoints"), { recursive: true });
    const conversion = index === undefined ? WITHOUT_AUTOCRLF : [];
    const child = Bun.spawn(["git", "-C", workspace.path, ...IDENTITY, ...conversion, ...args], {
      env: { ...process.env, GIT_INDEX_FILE: index ?? ownIndex ?? this.fileOf(workspace, ".index"), GIT_LITERAL_PATHSPECS: pathspecMagic ? "0" : "1" },
      stdin: input === undefined ? "ignore" : new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).bytes(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr: stderr.trim(), exitCode };
  }
}
