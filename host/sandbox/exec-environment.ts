/** Whether a variable is one the container tool's own process reads, by its name. */
export type ReadByTool = (name: string) => boolean;

/** A tool that reads exactly these variables, and those starting with any of these. */
export const readByTool =
  (names: readonly string[], starts: readonly string[] = []): ReadByTool =>
  (name) =>
    names.includes(name) || starts.some((start) => name.startsWith(start));

/**
 * An agent's values as the `-e` flags of a container tool's `exec`: by name, taken from the exec process's own
 * environment, so none shows on its command line; only those the tool itself reads are written out.
 */
export function environmentFlags(environment: Record<string, string>, toolReads: ReadByTool) {
  const names = Object.keys(environment);
  const written = names.filter(toolReads).flatMap((name) => ["-e", `${name}=${environment[name]}`]);
  const byName = names.filter((name) => !toolReads(name)).flatMap((name) => ["-e", name]);
  return [...written, ...byName];
}

/**
 * The environment of the `exec` process on this computer: the agent's values, but of those the tool itself reads only
 * this computer's own, so no value given to the agent steers the tool; one this computer has none of stays unset.
 */
export function execProcessEnvironment(environment: Record<string, string>, here: Record<string, string | undefined>, toolReads: ReadByTool) {
  const agents = Object.entries(environment).filter(([name]) => !toolReads(name));
  const own = Object.entries(here).filter((entry): entry is [string, string] => toolReads(entry[0]) && entry[1] !== undefined);
  return Object.fromEntries([...agents, ...own]);
}
