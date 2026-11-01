import { expect, test } from "bun:test";
import { SelfUpdate, type PublishedBuild, type SelfUpdatePorts, type UpdateOffer } from "../desktop/src/core/self-update.ts";

const RUNNING = "0.5.0";
const RELEASE_060 = { kind: "release", version: "0.6.0", url: "https://github.com/sodre90/mirador/releases/tag/v0.6.0" } as const;

class World {
  published: PublishedBuild | null = { version: "0.6.0", hash: "hash060" };
  blockedBy: string | null = null;
  trusted = true;
  downloadFails = false;
  lookupFails = false;
  skipped = new Set<string>();
  lookups = 0;
  events: string[] = [];
  offers: (UpdateOffer | null)[] = [];

  selfUpdate() {
    const world = this;
    const ports: SelfUpdatePorts = {
      currentVersion: RUNNING,
      published: async () => {
        world.lookups += 1;
        if (world.lookupFails) throw new Error("offline");
        return world.published;
      },
      blockedBy: () => world.blockedBy,
      async download({ hash }) {
        world.events.push(`download ${hash}`);
        if (world.downloadFails) throw new Error("offline");
      },
      trusted: async ({ hash }) => {
        world.events.push(`check ${hash}`);
        return world.trusted;
      },
      discard: (hash) => world.events.push(`discard ${hash}`),
      skipped: { has: (hash) => world.skipped.has(hash), add: (hash) => void world.skipped.add(hash) },
      install: async () => void world.events.push("install"),
    };
    return new SelfUpdate(ports, (offer) => world.offers.push(offer));
  }
}

test("a newer release is downloaded, checked and then offered, and says so while it downloads", async () => {
  const world = new World();
  const selfUpdate = world.selfUpdate();

  await selfUpdate.look();

  expect(world.events).toEqual(["download hash060", "check hash060"]);
  expect(world.offers).toEqual([
    { version: "0.6.0", hash: "hash060", stage: "downloading" },
    { version: "0.6.0", hash: "hash060", stage: "ready" },
  ]);
  expect(selfUpdate.offer).toEqual({ version: "0.6.0", hash: "hash060", stage: "ready" });
});

test("a check that cannot reach the latest release keeps the update it downloaded, ready to restart into", async () => {
  const world = new World();
  const selfUpdate = world.selfUpdate();
  await selfUpdate.look();

  world.lookupFails = true;
  await selfUpdate.look();

  expect(selfUpdate.offer).toEqual({ version: "0.6.0", hash: "hash060", stage: "ready" });
  expect(world.offers.at(-1)).toEqual({ version: "0.6.0", hash: "hash060", stage: "ready" });
  expect(world.events).toEqual(["download hash060", "check hash060"]);
});

test("only a newer version is offered: the latest release may be older, or this version built again", async () => {
  for (const version of ["0.4.9", RUNNING]) {
    const world = new World();
    world.published = { version, hash: "other" };
    const selfUpdate = world.selfUpdate();

    await selfUpdate.look();

    expect(world.events).toEqual([]);
    expect(selfUpdate.offer).toBeNull();
  }
});

test("a download whose signature fails is deleted, never fetched again, and told as one the app cannot install", async () => {
  const world = new World();
  world.trusted = false;
  const selfUpdate = world.selfUpdate();

  await selfUpdate.look();
  await selfUpdate.look();

  expect(world.events).toEqual(["download hash060", "check hash060", "discard hash060"]);
  expect(world.skipped.has("hash060")).toBe(true);
  expect(selfUpdate.offer).toEqual({ version: "0.6.0", hash: "hash060", stage: "blocked", blockedBy: "Mirador could not install it" });
});

test("where the app cannot replace itself, it says why and downloads nothing", async () => {
  const world = new World();
  world.blockedBy = "move Mirador to Applications to update it";
  const selfUpdate = world.selfUpdate();

  await selfUpdate.look();

  expect(world.events).toEqual([]);
  expect(selfUpdate.offer).toEqual({ version: "0.6.0", hash: "hash060", stage: "blocked", blockedBy: "move Mirador to Applications to update it" });
  await selfUpdate.install();
  expect(world.events).toEqual([]);
});

test("once moved where it can replace itself, the next look downloads it", async () => {
  const world = new World();
  world.blockedBy = "move Mirador to Applications to update it";
  const selfUpdate = world.selfUpdate();
  await selfUpdate.look();

  world.blockedBy = null;
  await selfUpdate.look();

  expect(world.events).toEqual(["download hash060", "check hash060"]);
  expect(selfUpdate.offer?.stage).toBe("ready");
});

test("an update already offered is not downloaded again at the next look", async () => {
  const world = new World();
  const selfUpdate = world.selfUpdate();
  await selfUpdate.look();
  await selfUpdate.look();

  expect(world.events).toEqual(["download hash060", "check hash060"]);
  expect(world.offers).toHaveLength(2);
});

test("a failed download offers nothing, no longer says it downloads, and the next look tries again", async () => {
  const world = new World();
  world.downloadFails = true;
  const selfUpdate = world.selfUpdate();
  await selfUpdate.look();
  expect(world.offers).toEqual([{ version: "0.6.0", hash: "hash060", stage: "downloading" }, null]);

  world.downloadFails = false;
  await selfUpdate.look();
  expect(selfUpdate.offer?.version).toBe("0.6.0");
});

test("a build that failed to install is deleted, told as one the app cannot install, and skipped from then on", async () => {
  const world = new World();
  const selfUpdate = world.selfUpdate();
  await selfUpdate.look();

  selfUpdate.failedToInstall("hash060");
  await selfUpdate.look();

  expect(world.events).toEqual(["download hash060", "check hash060", "discard hash060"]);
  expect(selfUpdate.offer).toEqual({ version: "0.6.0", hash: "hash060", stage: "blocked", blockedBy: "Mirador could not install it" });
  await selfUpdate.install();
  expect(world.events.at(-1)).toBe("discard hash060");
});

test("installing restarts into the offered update, and only when there is one", async () => {
  const world = new World();
  world.published = null;
  const selfUpdate = world.selfUpdate();
  await selfUpdate.look();
  await selfUpdate.install();
  expect(world.events).toEqual([]);

  world.published = { version: "0.6.0", hash: "hash060" };
  await selfUpdate.look();
  await selfUpdate.install();
  expect(world.events.at(-1)).toBe("install");
});

test("a newer release the host found makes the app look, unless it is what the app has or is getting already", async () => {
  const world = new World();
  const selfUpdate = world.selfUpdate();

  await selfUpdate.lookFor(null);
  await selfUpdate.lookFor({ kind: "checkout", commits: 2, upstream: "origin/main", upstreamCommit: "abc" });
  expect(world.lookups).toBe(0);

  await selfUpdate.lookFor(RELEASE_060);
  expect(world.events).toEqual(["download hash060", "check hash060"]);
  expect(selfUpdate.offer?.stage).toBe("ready");

  await selfUpdate.lookFor(RELEASE_060);
  expect(world.lookups).toBe(1);
});

test("a release the app found but cannot install is not looked for again each time the host tells it", async () => {
  const world = new World();
  world.blockedBy = "move Mirador to Applications to update it";
  const selfUpdate = world.selfUpdate();
  await selfUpdate.look();

  await selfUpdate.lookFor(RELEASE_060);

  expect(world.lookups).toBe(1);
});
