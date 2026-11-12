import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NewerVersionWatcher, newerCommits, newerRelease, newerVersionLookup, pullCheckout } from "../host/newer-version.ts";
import { isNewerVersion, newerVersionKey, newerVersionLabel, type NewerVersion } from "../shared/newer-version.ts";

describe("comparing versions", () => {
  test("compares each part as a number", () => {
    expect(isNewerVersion("0.3.10", "0.3.9")).toBe(true);
    expect(isNewerVersion("0.4", "0.3.3")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
  });

  test("finds the same or an older version not newer", () => {
    expect(isNewerVersion("0.3.3", "0.3.3")).toBe(false);
    expect(isNewerVersion("0.3.3.0", "0.3.3")).toBe(false);
    expect(isNewerVersion("0.3.2", "0.3.3")).toBe(false);
  });

  test("never finds a tag that is not plain numbers newer", () => {
    expect(isNewerVersion("0.4.0-rc1", "0.3.3")).toBe(false);
    expect(isNewerVersion("nightly", "0.3.3")).toBe(false);
  });

  test("labels a release by its version and commits by their count, and keeps a dismissal to exactly that", () => {
    const release: NewerVersion = { kind: "release", version: "0.4.0", url: "https://github.com/sodre90/mirador/releases/tag/v0.4.0" };
    const commits: NewerVersion = { kind: "checkout", commits: 3, upstream: "origin/main", upstreamCommit: "abc123" };
    expect(newerVersionLabel(release)).toBe("Mirador 0.4.0 is out");
    expect(newerVersionLabel(commits)).toBe("3 new commits on origin/main");
    expect(newerVersionLabel({ ...commits, commits: 1 })).toBe("1 new commit on origin/main");
    expect([newerVersionKey(release), newerVersionKey(commits)]).toEqual(["0.4.0", "abc123"]);
  });
});

describe("the latest published release", () => {
  let answer: () => Response = () => new Response(null, { status: 404 });
  const github = Bun.serve({ port: 0, fetch: () => answer() });
  const latestRelease = `http://127.0.0.1:${github.port}/repos/sodre90/mirador/releases/latest`;
  afterAll(() => github.stop(true));

  test("is newer when its tag is, with a link made from the tag rather than the address it sent", async () => {
    answer = () => Response.json({ tag_name: "v0.4.0", html_url: "https://elsewhere.example/" });
    expect(await newerRelease(latestRelease, "0.3.3")).toEqual({ kind: "release", version: "0.4.0", url: "https://github.com/sodre90/mirador/releases/tag/v0.4.0" });
  });

  test("is nothing to show when it is this version or a pre-release", async () => {
    answer = () => Response.json({ tag_name: "v0.3.3" });
    expect(await newerRelease(latestRelease, "0.3.3")).toBeNull();
    answer = () => Response.json({ tag_name: "v0.4.0-rc1" });
    expect(await newerRelease(latestRelease, "0.3.3")).toBeNull();
  });

  test("is nothing to show while GitHub has none to give, as for a private repository", async () => {
    answer = () => new Response("Not Found", { status: 404 });
    expect(await newerRelease(latestRelease, "0.3.3")).toBeNull();
  });

  test("can't be told when GitHub fails, such as over its rate limit", async () => {
    answer = () => new Response("rate limited", { status: 403 });
    await expect(newerRelease(latestRelease, "0.3.3")).rejects.toThrow("GitHub answered 403");
  });

  test("can't be told when GitHub can't be reached, and says so", async () => {
    await expect(newerRelease("http://127.0.0.1:9/repos/sodre90/mirador/releases/latest", "0.3.3")).rejects.toThrow("Couldn't reach GitHub");
  });
});

describe("new commits on a checkout's upstream", () => {
  const root = mkdtempSync(join(tmpdir(), "mirador-newer-commits-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const git = (directory: string, ...args: string[]) =>
    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
      cwd: directory,
      encoding: "utf8",
    }).trim();
  const origin = join(root, "origin.git");
  const checkout = join(root, "checkout");
  const elsewhere = join(root, "elsewhere");
  mkdirSync(checkout);
  git(root, "init", "--quiet", "--bare", "-b", "main", origin);
  git(checkout, "init", "--quiet", "-b", "main");
  git(checkout, "commit", "--quiet", "--allow-empty", "-m", "first");
  git(checkout, "remote", "add", "origin", origin);
  git(checkout, "push", "--quiet", "-u", "origin", "main");
  git(root, "clone", "--quiet", origin, elsewhere);
  git(elsewhere, "commit", "--quiet", "--allow-empty", "-m", "second");
  git(elsewhere, "commit", "--quiet", "--allow-empty", "-m", "third");
  git(elsewhere, "push", "--quiet");

  test("are none until fetched, then counted, and none again once pulled", async () => {
    expect(await newerCommits(checkout, false)).toBeNull();
    expect(await newerCommits(checkout, true)).toEqual({ kind: "checkout", commits: 2, upstream: "origin/main", upstreamCommit: git(elsewhere, "rev-parse", "HEAD") });
    git(checkout, "merge", "--quiet", "--ff-only", "origin/main");
    expect(await newerCommits(checkout, false)).toBeNull();
  });

  test("are nothing to show on a branch that follows no upstream", async () => {
    git(checkout, "switch", "--quiet", "-c", "local-only");
    expect(await newerCommits(checkout, true)).toBeNull();
    git(checkout, "switch", "--quiet", "main");
  });

  test("can't be told with a detached HEAD, or when the remote can't be reached", async () => {
    git(checkout, "switch", "--quiet", "--detach");
    await expect(newerCommits(checkout, false)).rejects.toThrow();
    git(checkout, "switch", "--quiet", "main");
    git(checkout, "remote", "set-url", "origin", join(root, "gone.git"));
    await expect(newerCommits(checkout, true)).rejects.toThrow("Couldn't fetch origin/main");
    git(checkout, "remote", "set-url", "origin", origin);
  });

  test("are what a host with .git in its source looks for, and a release's source without it looks for a release", async () => {
    expect(await newerVersionLookup(checkout, "http://127.0.0.1:9/unused")(false)).toBeNull();
    await expect(newerVersionLookup(root, "http://127.0.0.1:9/unused")(false)).rejects.toThrow();
  });
});

describe("pulling a checkout's upstream", () => {
  const root = mkdtempSync(join(tmpdir(), "mirador-pull-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const git = (directory: string, ...args: string[]) =>
    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
      cwd: directory,
      encoding: "utf8",
    }).trim();

  function checkoutBehindUpstream(name: string) {
    const base = join(root, name);
    const origin = join(base, "origin.git");
    const checkout = join(base, "checkout");
    const elsewhere = join(base, "elsewhere");
    mkdirSync(base, { recursive: true });
    git(base, "init", "--quiet", "--bare", "-b", "main", origin);
    mkdirSync(checkout);
    git(checkout, "init", "--quiet", "-b", "main");
    writeFileSync(join(checkout, "f.txt"), "base\n");
    git(checkout, "add", "--all");
    git(checkout, "commit", "--quiet", "-m", "first");
    git(checkout, "remote", "add", "origin", origin);
    git(checkout, "push", "--quiet", "-u", "origin", "main");
    git(base, "clone", "--quiet", origin, elsewhere);
    return { checkout, elsewhere };
  }

  const pushUpstreamChange = (elsewhere: string) => {
    writeFileSync(join(elsewhere, "f.txt"), "upstream\n");
    git(elsewhere, "add", "--all");
    git(elsewhere, "commit", "--quiet", "-m", "upstream");
    git(elsewhere, "push", "--quiet");
  };

  test("fast-forwards the checkout to its upstream, and says nothing when it did", async () => {
    const { checkout, elsewhere } = checkoutBehindUpstream("ff");
    pushUpstreamChange(elsewhere);
    git(checkout, "fetch", "--quiet");

    expect(await pullCheckout(checkout)).toBeNull();
    expect(git(checkout, "rev-parse", "HEAD")).toBe(git(elsewhere, "rev-parse", "HEAD"));
    expect(readFileSync(join(checkout, "f.txt"), "utf8")).toBe("upstream\n");
    expect(await newerCommits(checkout, false)).toBeNull();
  });

  test("leaves uncommitted work as it is, and says why it can't pull over it", async () => {
    const { checkout, elsewhere } = checkoutBehindUpstream("dirty");
    pushUpstreamChange(elsewhere);
    git(checkout, "fetch", "--quiet");
    writeFileSync(join(checkout, "f.txt"), "local work\n");

    expect(await pullCheckout(checkout)).toContain("Your local changes");
    expect(readFileSync(join(checkout, "f.txt"), "utf8")).toBe("local work\n");
  });

  test("won't rewrite a checkout that has its own commits, and says why", async () => {
    const { checkout, elsewhere } = checkoutBehindUpstream("diverged");
    pushUpstreamChange(elsewhere);
    git(checkout, "fetch", "--quiet");
    writeFileSync(join(checkout, "own.txt"), "own\n");
    git(checkout, "add", "--all");
    git(checkout, "commit", "--quiet", "-m", "own");

    expect(await pullCheckout(checkout)).toContain("fast-forward");
    expect(readFileSync(join(checkout, "own.txt"), "utf8")).toBe("own\n");
  });

  test("says why when git can't even start, rather than leave the pull unanswered", async () => {
    const { checkout } = checkoutBehindUpstream("no-git");
    const path = process.env.PATH;
    // An empty PATH would not do: Bun then looks in a default one.
    process.env.PATH = join(root, "no-such-folder");
    try {
      expect(await pullCheckout(checkout)).toContain("not found");
    } finally {
      process.env.PATH = path;
    }
  });
});

describe("watching for a newer version", () => {
  const release = (version: string): NewerVersion => ({ kind: "release", version, url: `https://github.com/sodre90/mirador/releases/tag/v${version}` });

  function watcherAnswering(...answers: (NewerVersion | null | Error)[]) {
    const announced: (NewerVersion | null)[] = [];
    const fetched: boolean[] = [];
    const watcher = new NewerVersionWatcher(
      async (fetching) => {
        fetched.push(fetching);
        const answer = answers.shift() ?? null;
        if (answer instanceof Error) throw answer;
        return answer;
      },
      (newer) => announced.push(newer),
    );
    return { watcher, announced, fetched };
  }

  test("announces only what changed, and keeps the last answer when it can't tell", async () => {
    const { watcher, announced } = watcherAnswering(release("0.4.0"), release("0.4.0"), new Error("offline"), null);
    for (let look = 0; look < 4; look++) await watcher.look(true);
    expect(announced).toEqual([release("0.4.0"), null]);
    expect(watcher.current).toBeNull();
  });

  test("recounts without fetching once started, and not at all on a host that doesn't look", async () => {
    const { watcher, fetched } = watcherAnswering(null, null);
    watcher.recount();
    await watcher.look(true);
    expect(fetched).toEqual([true]);
    watcher.start();
    watcher.recount();
    watcher.stop();
    await watcher.look(true);
    expect(fetched).toEqual([true, true, false, true]);
  });

  test("a look asked for now says why it failed, keeping the last answer, and says nothing when it didn't", async () => {
    const { watcher, fetched } = watcherAnswering(release("0.4.0"), new Error("Couldn't reach GitHub"), null);
    expect(await watcher.lookNow()).toBeNull();
    expect(await watcher.lookNow()).toEqual({ problem: "Couldn't reach GitHub" });
    expect(watcher.current).toEqual(release("0.4.0"));
    expect(await watcher.lookNow()).toBeNull();
    expect(watcher.current).toBeNull();
    expect(fetched).toEqual([true, true, true]);
  });

  test("looks one at a time, so a slow fetch can't undo the recount after it", async () => {
    let finishTheFetch = () => {};
    const slowFetch = new Promise<NewerVersion | null>((resolve) => (finishTheFetch = () => resolve(release("0.4.0"))));
    const watcher = new NewerVersionWatcher((fetching) => (fetching ? slowFetch : Promise.resolve(null)), () => {});
    const looks = [watcher.look(true), watcher.look(false)];
    await Bun.sleep(5);
    finishTheFetch();
    await Promise.all(looks);
    expect(watcher.current).toBeNull();
  });
});
