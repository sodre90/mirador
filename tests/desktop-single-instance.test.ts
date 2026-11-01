import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimSingleInstance } from "../desktop/src/core/single-instance.ts";

const directory = mkdtempSync(join(tmpdir(), "mirador-instance-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("a second launch reaches the first, which opens its window, and the socket is free again once released", async () => {
  const socketPath = join(directory, "desktop-4600.sock");
  let launchedAgain = 0;
  const first = await claimSingleInstance(socketPath, () => launchedAgain++);
  expect(first).not.toBeNull();

  expect(await claimSingleInstance(socketPath, () => {})).toBeNull();
  await Bun.sleep(50);
  expect(launchedAgain).toBe(1);

  first!.release();
  const next = await claimSingleInstance(socketPath, () => {});
  expect(next).not.toBeNull();
  next!.release();
});

test("a socket left behind by an app that crashed does not block the next launch", async () => {
  const socketPath = join(directory, "stale.sock");
  await Bun.write(socketPath, "");
  const lock = await claimSingleInstance(socketPath, () => {});
  expect(lock).not.toBeNull();
  lock!.release();
});

test("of two launches at the same moment, exactly one gets the socket and the other one quits", async () => {
  const socketPath = join(directory, "race.sock");
  const claims = await Promise.all([claimSingleInstance(socketPath, () => {}), claimSingleInstance(socketPath, () => {})]);
  const winners = claims.filter((claim) => claim !== null);
  expect(winners).toHaveLength(1);
  expect(await claimSingleInstance(socketPath, () => {})).toBeNull();
  winners[0]!.release();
});
