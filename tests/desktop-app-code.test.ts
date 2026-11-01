import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopAppCheck } from "../host/desktop-app-check.ts";
import { desktopAppCode } from "../shared/desktop-app-code.ts";

const root = mkdtempSync(join(tmpdir(), "mirador-desktop-code-"));
const desktop = join(root, "desktop");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const write = (path: string, code: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, code);
};

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  write(join(desktop, "src/bun/index.ts"), `import { ready } from "../core/window.ts";\nimport "electrobun/main";\nready();\n`);
  write(join(desktop, "src/core/window.ts"), `import { COOKIE, type Message } from "../../../shared/protocol.ts";\nexport const ready = () => COOKIE;\n`);
  write(join(root, "shared/protocol.ts"), `export const COOKIE = "token";\nexport interface Message { type: string }\n`);
  write(join(desktop, "src/core/unused.ts"), `export const unused = 1;\n`);
});

test("the code changes with what a file the app reaches does, even outside desktop/", () => {
  const before = desktopAppCode(desktop);
  write(join(root, "shared/protocol.ts"), `export const COOKIE = "session";\nexport interface Message { type: string }\n`);
  expect(desktopAppCode(desktop)).not.toBe(before);
});

test("the code stays the same when only types, comments or files the app does not reach change", () => {
  const before = desktopAppCode(desktop);
  write(join(root, "shared/protocol.ts"), `/** The cookie. */\nexport const COOKIE = "token";\nexport interface Message { type: string; at: number }\nexport type Kind = string;\n`);
  write(join(desktop, "src/core/window.ts"), `import { COOKIE, type Message } from "../../../shared/protocol.ts";\nimport type { Kind } from "../../../shared/protocol.ts";\n// Shown once.\nexport const ready = (): string => COOKIE;\n`);
  write(join(desktop, "src/core/unused.ts"), `export const unused = 2;\n`);
  expect(desktopAppCode(desktop)).toBe(before);
});

test("a directory without the desktop app has no code to tell", () => {
  expect(desktopAppCode(join(root, "elsewhere"))).toBeNull();
});

test("an app built from other code than the checkout's is outdated until it leaves", () => {
  let checkout = "new";
  const told: boolean[] = [];
  const check = new DesktopAppCheck(() => checkout, (outdated) => told.push(outdated));
  const oldApp = {};
  const currentApp = {};

  check.connected(currentApp, "new");
  expect(check.outdated).toBe(false);
  check.connected(oldApp, "old");
  expect(check.outdated).toBe(true);
  check.disconnected(oldApp);
  expect(check.outdated).toBe(false);
  check.disconnected(currentApp);
  checkout = "newer";
  check.connected({}, "newer");
  expect(told).toEqual([true, false]);
});

test("an app built from a release, or a host without the desktop app's code, is never outdated", () => {
  const releaseApp = new DesktopAppCheck(() => "new", () => {});
  releaseApp.connected({}, null);
  expect(releaseApp.outdated).toBe(false);

  const releaseHost = new DesktopAppCheck(() => null, () => {});
  releaseHost.connected({}, "old");
  expect(releaseHost.outdated).toBe(false);
});
