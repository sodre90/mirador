import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { git } from "../git-command.ts";
import type { LookedAt } from "./looked-at.ts";

/** How deep git follows includes before it gives up. */
const MOST_INCLUDE_DEPTH = 10;

const LEADS_ON = "^(include(if\\..+)?\\.path|core\\.hookspath)$";

/** Where a config file leads git on to: the files it includes, by any condition, as git names them, and the hooks folders it names, as written there. */
interface LeadsTo {
  included: string[];
  hooksFolders: string[];
}

const NOWHERE: LeadsTo = { included: [], hooksFolders: [] };

const expandedHome = (path: string) => (path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path);

/** A path as git names a file, its relative part kept as written: git hands it to the kernel as it is, `..` taken after any link. */
const namedFrom = (folder: string, path: string) => (isAbsolute(path) ? path : `${folder}/${path}`);

const HOOKS_OPTIONAL = ":(optional)";

/** The hooks folder git takes the value for, a relative one from the top of the repository's working tree; null for a relative one where it has none. */
export function hooksFolderNamed(top: string | null, value: string): string | null {
  const path = expandedHome(value.startsWith(HOOKS_OPTIONAL) ? value.slice(HOOKS_OPTIONAL.length) : value);
  if (isAbsolute(path)) return path;
  return top === null ? null : namedFrom(top, path);
}

/** Where git reads the owner's own config, where there is any. */
export function ownersConfigFiles(environment: NodeJS.ProcessEnv = process.env): string[] {
  const { GIT_CONFIG_GLOBAL: named, XDG_CONFIG_HOME: configHome } = environment;
  return named ? [named] : [join(homedir(), ".gitconfig"), join(configHome || join(homedir(), ".config"), "git", "config")];
}

/** A config file git reads in a repository, as it names it; `ofThisComputer` where it reads it in every repository. */
interface ConfigFileRead {
  file: string;
  ofThisComputer: boolean;
}

const SCOPES_OF_A_REPOSITORY = ["local", "worktree"];

/** The config files git reads in the repository now, as it names them in the origins it tells of. */
export async function configFilesRead(repository: string): Promise<ConfigFileRead[]> {
  const { stdout } = await git(repository, ["config", "--list", "--show-scope", "--show-origin", "--null"]);
  const fields = stdout.split("\0");
  const origins = fields.flatMap((scope, index) => (index % 3 === 0 && fields[index + 1]?.startsWith("file:") ? [{ scope, origin: fields[index + 1]! }] : []));
  const files = new Map(origins.map(({ scope, origin }) => [namedFrom(repository, origin.slice("file:".length)), !SCOPES_OF_A_REPOSITORY.includes(scope)]));
  return [...files].map(([file, ofThisComputer]) => ({ file, ofThisComputer }));
}

/** Config files, each read once, whatever number of repositories take it. */
export class GitConfigFiles {
  private readonly read = new Map<string, Promise<LeadsTo>>();

  constructor(private readonly lookedAt: LookedAt) {}

  /** The files, and all they include at any depth and by any condition. */
  async withIncluded(files: string[]): Promise<string[]> {
    const reached = new Set(files);
    let unread = [...reached];
    for (let depth = 0; unread.length > 0 && depth <= MOST_INCLUDE_DEPTH; depth++) {
      const included = (await Promise.all(unread.map((file) => this.leadsTo(file)))).flatMap((each) => each.included);
      unread = [...new Set(included)].filter((file) => !reached.has(file));
      unread.forEach((file) => reached.add(file));
    }
    return [...reached];
  }

  async hooksFoldersNamedIn(files: string[]): Promise<string[]> {
    return (await Promise.all(files.map((file) => this.leadsTo(file)))).flatMap(({ hooksFolders }) => hooksFolders);
  }

  private leadsTo(file: string): Promise<LeadsTo> {
    const read = this.read.get(file) ?? this.readNow(file);
    this.read.set(file, read);
    return read;
  }

  /** Read from no repository, whose config, broken by a file it includes, would stop git before it reads this one; and never from a pipe, which git would wait at. */
  private async readNow(file: string): Promise<LeadsTo> {
    await this.lookedAt.entry(file);
    if (!(await stat(file).catch(() => null))?.isFile()) return NOWHERE;
    const { stdout } = await git("/", ["config", "--file", file, "--null", "--get-regexp", LEADS_ON]);
    const entries = stdout.split("\0").flatMap((entry) => {
      const keyEnds = entry.indexOf("\n");
      return keyEnds === -1 || keyEnds === entry.length - 1 ? [] : [{ key: entry.slice(0, keyEnds), value: entry.slice(keyEnds + 1) }];
    });
    const valuesOf = (hooks: boolean) => entries.filter(({ key }) => (key === "core.hookspath") === hooks).map(({ value }) => value);
    return { included: valuesOf(false).map((path) => namedFrom(dirname(file), expandedHome(path))), hooksFolders: valuesOf(true) };
  }
}
