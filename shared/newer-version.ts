/** A newer Mirador than the one running: a published release, or commits on the checkout's upstream that it lacks. */
export type NewerVersion =
  | { kind: "release"; version: string; url: string }
  | { kind: "checkout"; commits: number; upstream: string; upstreamCommit: string };

export const RELEASES_REPOSITORY = "sodre90/mirador";

const versionParts = (version: string) => (/^\d+(\.\d+)*$/.test(version) ? version.split(".").map(Number) : null);

/** Only plain dotted numbers compare, so a tag such as 0.4.0-rc1 is never newer. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const [newer, now] = [versionParts(candidate), versionParts(current)];
  if (!newer || !now) return false;
  const partCount = Math.max(newer.length, now.length);
  const firstDifference = Array.from({ length: partCount }, (_, index) => (newer[index] ?? 0) - (now[index] ?? 0)).find((difference) => difference !== 0);
  return (firstDifference ?? 0) > 0;
}

/** Made from the tag, never taken from the response, so a link the user clicks always leads to the repository's own release page. */
export const releasePage = (tag: string) => `https://github.com/${RELEASES_REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`;

export function newerVersionLabel(newer: NewerVersion) {
  if (newer.kind === "release") return `Mirador ${newer.version} is out`;
  return `${newer.commits} new ${newer.commits === 1 ? "commit" : "commits"} on ${newer.upstream}`;
}

/** A dismissed sign stays hidden for this version, or these commits, and shows again for anything newer. */
export const newerVersionKey = (newer: NewerVersion) => (newer.kind === "release" ? newer.version : newer.upstreamCommit);
