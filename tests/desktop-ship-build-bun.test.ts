import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { BUN_PROGRAM, buildMachineBun, bunInApp, definedBunVersion, requireDefinedBun, shipBuildBun } from "../desktop/scripts/ship-build-bun.ts";

const CHECKOUT = join(import.meta.dir, "..");

const scratch = mkdtempSync(join(tmpdir(), "mirador-ship-bun-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let folders = 0;
const newFolder = () => {
  const folder = join(scratch, String(++folders));
  mkdirSync(folder);
  return folder;
};

const fakeBun = (path: string, version: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\necho ${version}\n`);
  chmodSync(path, 0o755);
  return path;
};

describe("bunInApp", () => {
  test("is the program in the macOS app, not the folder of the same name among its resources", () => {
    const build = newFolder();
    const bun = fakeBun(join(build, "Mirador.app", "Contents", "MacOS", "bun"), "1.4.0");
    mkdirSync(join(build, "Mirador.app", "Contents", "Resources", "app", "bun"), { recursive: true });
    expect(bunInApp(build, "macos")).toBe(bun);
  });

  test("is in the bin folder of the Linux app", () => {
    const build = newFolder();
    const bun = fakeBun(join(build, "Mirador", "bin", "bun"), "1.4.0");
    expect(bunInApp(build, "linux")).toBe(bun);
  });

  test("is in the bin folder of the Windows app", () => {
    const build = newFolder();
    const bun = fakeBun(join(build, "Mirador", "bin", "bun.exe"), "1.4.0");
    expect(bunInApp(build, "win")).toBe(bun);
  });

  test("needs exactly one app, and a system whose app it knows", () => {
    const build = newFolder();
    expect(() => bunInApp(build, "macos")).toThrow("found 0");
    fakeBun(join(build, "Mirador.app", "Contents", "MacOS", "bun"), "1.4.0");
    fakeBun(join(build, "Mirador-dev.app", "Contents", "MacOS", "bun"), "1.4.0");
    expect(() => bunInApp(build, "macos")).toThrow("found 2 among");
    expect(() => bunInApp(build, "freebsd")).toThrow("for freebsd is not known yet");
  });
});

describe("buildMachineBun", () => {
  test("is the first Bun on the PATH, else the one in ~/.bun", () => {
    const home = newFolder();
    const empty = newFolder();
    const first = fakeBun(join(home, "first", BUN_PROGRAM), "1.4.3");
    fakeBun(join(home, "second", BUN_PROGRAM), "1.4.2");
    const installed = fakeBun(join(home, ".bun", "bin", BUN_PROGRAM), "1.4.1");
    expect(buildMachineBun([empty, dirname(first), join(home, "second")].join(delimiter), home)).toBe(first);
    expect(buildMachineBun(empty, home)).toBe(installed);
  });

  test("is not the link to the running Bun that bun run puts first on the PATH", () => {
    const home = newFolder();
    const bunRunFolder = join(home, "bun-node-c6da4a4d3");
    fakeBun(join(bunRunFolder, BUN_PROGRAM), "1.4.3");
    const installed = fakeBun(join(home, "installed", BUN_PROGRAM), "1.4.3");
    expect(buildMachineBun([bunRunFolder, dirname(installed)].join(delimiter), home)).toBe(installed);
  });

  test.skipIf(process.platform === "win32")("is never the Bun Electrobun pins, also through a symbolic link", () => {
    const home = newFolder();
    const pinned = fakeBun(join(home, ".hutch", "toolchains", "bun", "1.4.0", "bun"), "1.4.0");
    expect(() => buildMachineBun(dirname(pinned), home)).toThrow("is the Bun Electrobun pins");
    mkdirSync(join(home, "bin"));
    symlinkSync(pinned, join(home, "bin", "bun"));
    expect(() => buildMachineBun(join(home, "bin"), home)).toThrow("is the Bun Electrobun pins");
  });
});

describe.skipIf(process.platform === "win32")("shipBuildBun", () => {
  test("puts the build machine's Bun in the app, runnable, and leaves another link to the pinned one alone", () => {
    const build = newFolder();
    const appBun = fakeBun(join(build, "Mirador.app", "Contents", "MacOS", "bun"), "1.4.0");
    const toolchainCopy = join(newFolder(), "bun");
    linkSync(appBun, toolchainCopy);
    const buildBun = fakeBun(join(newFolder(), "bun"), "1.4.3");

    expect(shipBuildBun(build, "macos", buildBun)).toEqual({ appBun, pinned: "1.4.0", shipped: "1.4.3" });
    expect(readFileSync(appBun, "utf8")).toBe(readFileSync(buildBun, "utf8"));
    expect(statSync(appBun).mode & 0o111).toBe(0o111);
    expect(statSync(appBun).nlink).toBe(1);
    expect(readFileSync(toolchainCopy, "utf8")).toContain("1.4.0");
  });

  test("keeps Electrobun's own Bun when the build machine's is the same version", () => {
    const build = newFolder();
    const appBun = fakeBun(join(build, "Mirador", "bin", "bun"), "1.4.3");
    const electrobunBun = readFileSync(appBun, "utf8");
    const buildBun = fakeBun(join(newFolder(), "bun"), "1.4.3");
    writeFileSync(buildBun, `${readFileSync(buildBun, "utf8")}# the build machine's\n`);

    expect(shipBuildBun(build, "linux", buildBun)).toEqual({ appBun, pinned: "1.4.3", shipped: "1.4.3" });
    expect(readFileSync(appBun, "utf8")).toBe(electrobunBun);
  });
});

describe("the defined Bun", () => {
  test("is named once, in .bun-version, which the workflows and the Linux image read", () => {
    expect(definedBunVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    const workflows = join(CHECKOUT, ".github", "workflows");
    const settingUpBun = readdirSync(workflows)
      .map((workflow) => readFileSync(join(workflows, workflow), "utf8"))
      .filter((text) => text.includes("oven-sh/setup-bun"));
    expect(settingUpBun.length).toBeGreaterThan(0);
    for (const text of settingUpBun) {
      expect(text.split("oven-sh/setup-bun").length - 1).toBe(text.split("bun-version-file: .bun-version").length - 1);
      expect(text).not.toContain("bun-version: ");
    }
    expect(readFileSync(join(CHECKOUT, "scripts", "linux-test.Dockerfile"), "utf8")).toMatch(/^ARG BUN_VERSION$/m);
    expect(readFileSync(join(CHECKOUT, "scripts", "linux-common.sh"), "utf8")).toContain('--build-arg "BUN_VERSION=$(<"$repo/.bun-version")"');
  });

  test.skipIf(process.platform === "win32")("is the only one a release is built or checked with", () => {
    const bun = fakeBun(join(newFolder(), "bun"), "1.4.3");
    expect(() => requireDefinedBun(bun, "1.4.3")).not.toThrow();
    expect(() => requireDefinedBun(bun, "1.4.4")).toThrow("is Bun 1.4.3, but .bun-version names 1.4.4");
  });
});
