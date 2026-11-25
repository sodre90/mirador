import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_PROTECTIONS, protectionsKept, settingsFiles } from "../host/acp/claude-protections.ts";

const SETTINGS = {
  user: { permissions: { allow: ["Bash(ls:*)"], deny: ["Bash(rm:*)"], ask: ["Bash(git push:*)"] }, sandbox: { enabled: true, network: { allowedDomains: ["a.example"] } } },
  project: { permissions: { deny: ["Read(.env)"] }, sandbox: { network: { allowedDomains: ["b.example"] } } },
  local: { permissions: { ask: ["WebFetch"] }, sandbox: { excludedCommands: ["docker"] } },
};

describe("the protections a room's Claude Code session keeps of the settings it leaves out", () => {
  test("are none when it leaves out none", () => {
    expect(protectionsKept([], SETTINGS)).toEqual(NO_PROTECTIONS);
  });

  test("are the deny and ask rules of the sources left out only, never what they allow", () => {
    expect(protectionsKept(["user"], SETTINGS)).toMatchObject({ deny: ["Bash(rm:*)"], ask: ["Bash(git push:*)"] });
    expect(protectionsKept(["project", "local"], SETTINGS)).toMatchObject({ deny: ["Read(.env)"], ask: ["WebFetch"] });
  });

  test("keep the sandbox as all the sources together set it", () => {
    expect(protectionsKept(["user"], SETTINGS).sandbox).toEqual({
      enabled: true,
      network: { allowedDomains: ["a.example", "b.example"] },
      excludedCommands: ["docker"],
    });
  });

  test("never let excluded workspace settings weaken or override the owner's user sandbox", () => {
    const hostileWorkspace = {
      user: { sandbox: { enabled: true, network: { allowedDomains: ["a.example"] } } },
      project: { sandbox: { enabled: false, allowUnsandboxedCommands: true, excludedCommands: ["bash"], network: { allowedDomains: ["evil.example"] } } },
      local: { sandbox: { enabled: false } },
    };
    expect(protectionsKept(["project", "local"], hostileWorkspace).sandbox).toBeUndefined();
    expect(protectionsKept(["user", "project", "local"], hostileWorkspace).sandbox).toEqual({
      enabled: true,
      network: { allowedDomains: ["a.example"] },
    });
  });

  test("skip what is not settings", () => {
    expect(protectionsKept(["user", "project"], { user: "not settings", project: { permissions: { deny: ["Bash", 3] }, sandbox: [] } })).toEqual({ deny: ["Bash"], ask: [] });
  });
});

describe("the settings files a room's Claude Code session would read", () => {
  const root = mkdtempSync(join(tmpdir(), "claude-protections-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("are the owner's own, and the workspace's shared and local ones, where they read as JSON", async () => {
    const [configDir, workspace] = [join(root, "config"), join(root, "workspace")];
    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(workspace, ".claude"), { recursive: true });
    writeFileSync(join(configDir, "settings.json"), JSON.stringify(SETTINGS.user));
    writeFileSync(join(workspace, ".claude", "settings.json"), "{ not json");
    expect(await settingsFiles(configDir, workspace)).toEqual({ user: SETTINGS.user, project: undefined, local: undefined });
  });
});
