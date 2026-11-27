import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { protects, type ProtectedParts } from "../host/sandbox/guarded-workspace.ts";
import { LookedAt } from "../host/sandbox/looked-at.ts";
import { PlanWatch } from "../host/sandbox/plan-watch.ts";
import type { SandboxBlocker } from "../shared/sandbox.ts";
import { RUNS_SANDBOXES } from "./sandbox-computer.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-plan-watch-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const folder = () => {
  const path = join(scratch, crypto.randomUUID());
  mkdirSync(path);
  return path;
};

const NOTHING: ProtectedParts = { files: [], folders: [], onTheWay: [], gitFolders: [".git"] };

describe("what was looked at", () => {
  const changedBy = async (look: (lookedAt: LookedAt) => Promise<void>, change: () => void) => {
    const lookedAt = new LookedAt();
    await look(lookedAt);
    expect(await lookedAt.changed()).toBe(false);
    change();
    return lookedAt.changed();
  };

  test.skipIf(!RUNS_SANDBOXES)("has changed once a file holds something else, comes, goes or is replaced, or what a link leads to does", async () => {
    const at = folder();
    const file = join(at, "config");
    const link = join(at, "link");
    symlinkSync("config", link);
    const look = (path: string) => (lookedAt: LookedAt) => lookedAt.entry(path);
    expect(await changedBy(look(file), () => writeFileSync(file, "one"))).toBe(true);
    expect(await changedBy(look(file), () => writeFileSync(file, "three"))).toBe(true);
    expect(await changedBy(look(link), () => writeFileSync(file, "seven"))).toBe(true);
    expect(
      await changedBy(look(file), () => {
        writeFileSync(join(at, "new"), "eight");
        utimesSync(join(at, "new"), 1, 1);
        renameSync(join(at, "new"), file);
      }),
    ).toBe(true);
    expect(await changedBy(look(file), () => rmSync(file))).toBe(true);
    expect(await changedBy(look(file), () => {})).toBe(false);
  });

  test.skipIf(!RUNS_SANDBOXES)("has changed once a folder is another, though not by what is made in it, unless its names were read", async () => {
    const at = folder();
    const looked = join(at, "hooks");
    mkdirSync(looked);
    expect(await changedBy((lookedAt) => lookedAt.entry(looked), () => writeFileSync(join(looked, "pre-commit"), ""))).toBe(false);
    expect(await changedBy((lookedAt) => lookedAt.names(looked), () => writeFileSync(join(looked, "pre-push"), ""))).toBe(true);
    expect(
      await changedBy(
        (lookedAt) => lookedAt.entry(looked),
        () => {
          renameSync(looked, join(at, "old"));
          symlinkSync("old", looked);
        },
      ),
    ).toBe(true);
  });

  test.skipIf(!RUNS_SANDBOXES)("goes by how it was when first looked at", async () => {
    const file = join(folder(), "config");
    const lookedAt = new LookedAt();
    await lookedAt.entry(file);
    writeFileSync(file, "new");
    await lookedAt.entry(file);
    expect(await lookedAt.changed()).toBe(true);
  });
});

test("a plan protects another's parts where each file and hooks folder is protected, each folder on the way stays and each git folder is one", () => {
  const plan: ProtectedParts = { files: ["a/team.cfg"], folders: [".husky/_", ".claude"], onTheWay: ["a"], gitFolders: [".git", "remote.git"] };
  const protectsToo = (others: Partial<ProtectedParts>) => protects(plan, { ...NOTHING, gitFolders: [], ...others });
  expect(protectsToo({})).toBe(true);
  expect(protectsToo(plan)).toBe(true);
  expect(protectsToo({ files: [".husky/_/pre-commit", ".claude/x.cfg"], folders: [".claude/hooks"] })).toBe(true);
  expect(protectsToo({ onTheWay: [".husky", "a", ".claude/deep"] })).toBe(true);
  expect(protectsToo({ files: ["b.cfg"] })).toBe(false);
  expect(protectsToo({ files: [".husky"] })).toBe(false);
  expect(protectsToo({ folders: [".husky"] })).toBe(false);
  expect(protectsToo({ folders: [".husky/_2"] })).toBe(false);
  expect(protectsToo({ onTheWay: ["b"] })).toBe(false);
  expect(protectsToo({ gitFolders: [".git/modules/lib"] })).toBe(false);
});

describe("a plan's watch", () => {
  const EVERY_MS = 5;
  type Now = { parts: ProtectedParts } | { refused: SandboxBlocker };

  function watched() {
    const at = folder();
    const file = join(at, "config");
    let now: () => Now = () => ({ parts: NOTHING });
    const counts = { planned: 0, outgrown: 0 };
    const lookedAtFile = async () => {
      const lookedAt = new LookedAt();
      await lookedAt.entry(file);
      return lookedAt;
    };
    const start = async () =>
      new PlanWatch(
        { parts: NOTHING, lookedAt: await lookedAtFile() },
        async () => {
          counts.planned += 1;
          const planned = now();
          return "refused" in planned ? planned : { ...planned, lookedAt: await lookedAtFile() };
        },
        async () => void (counts.outgrown += 1),
        EVERY_MS,
      );
    const plansAs = (to: () => Now) => (now = to);
    const change = (to: () => Now) => {
      plansAs(to);
      writeFileSync(file, crypto.randomUUID());
    };
    return { start, change, plansAs, counts };
  }

  const MORE: Now = { parts: { ...NOTHING, folders: [".husky"] } };
  const afterSomeLooks = () => Bun.sleep(EVERY_MS * 20);
  const until = async (what: () => boolean) => {
    while (!what()) await Bun.sleep(EVERY_MS);
  };

  test("says nothing, and plans nothing, while what the plan was made from stays", async () => {
    const { start, counts } = watched();
    const watch = await start();
    await afterSomeLooks();
    watch.stop();
    expect(counts).toEqual({ planned: 0, outgrown: 0 });
  });

  test("says so once there is more to protect, and again while it isn't stopped", async () => {
    const { start, change, counts } = watched();
    const watch = await start();
    change(() => MORE);
    await until(() => counts.outgrown > 1);
    watch.stop();
    const { outgrown } = counts;
    await afterSomeLooks();
    expect(counts.outgrown).toBe(outgrown);
  });

  test("looks through all of it when asked, though what the plan was made from stays, once for all asked while one waits, says so where there is more, and looks no more once stopped", async () => {
    const { start, plansAs, counts } = watched();
    const watch = await start();
    await watch.lookThrough();
    expect(counts).toEqual({ planned: 1, outgrown: 0 });
    await Promise.all([watch.lookThrough(), watch.lookThrough(), watch.lookThrough()]);
    expect(counts).toEqual({ planned: 2, outgrown: 0 });
    plansAs(() => MORE);
    await afterSomeLooks();
    expect(counts).toEqual({ planned: 2, outgrown: 0 });
    await watch.lookThrough();
    expect(counts).toEqual({ planned: 4, outgrown: 1 });
    watch.stop();
    await watch.lookThrough();
    expect(counts).toEqual({ planned: 4, outgrown: 1 });
  });

  test("says so once no plan can be made", async () => {
    const { start, change, counts } = watched();
    const watch = await start();
    change(() => ({ refused: { kind: "part-is-link", part: ".git/hooks" } }));
    await until(() => counts.outgrown > 0);
    watch.stop();
  });

  test("says nothing of a change that asks for no more, of one gone at the second look, or of a look that fails, and hears the next one", async () => {
    const { start, change, counts } = watched();
    const watch = await start();
    change(() => ({ parts: { ...NOTHING, gitFolders: [] } }));
    await until(() => counts.planned === 1);
    let looks = 0;
    change(() => (looks++ === 0 ? { refused: { kind: "config-includes-missing-file", file: "team.cfg" } } : { parts: NOTHING }));
    await until(() => looks === 2);
    let failed = false;
    change(() => {
      failed = true;
      throw new Error("no git");
    });
    await until(() => failed);
    await afterSomeLooks();
    expect(counts.outgrown).toBe(0);
    change(() => MORE);
    await until(() => counts.outgrown > 0);
    watch.stop();
  });
});
