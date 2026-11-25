import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileAlreadyThere, SaveRefused } from "../host/canvas/save-to-project.ts";
import { saveExportedSettings } from "../host/settings-file/save-export.ts";

const tempDirs: string[] = [];
const freshHome = () => {
  const dir = mkdtempSync(join(tmpdir(), "mirador-save-export-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("saveExportedSettings", () => {
  it("expands ~/ paths, creates missing parent folders, and writes owner-only", async () => {
    const home = freshHome();
    const saved = await saveExportedSettings("~/Downloads/mirador-settings-2026-11-25.json", '{"schemaVersion":1}\n', { home });
    expect(saved).toBe("~/Downloads/mirador-settings-2026-11-25.json");
    const target = join(home, "Downloads", "mirador-settings-2026-11-25.json");
    expect(readFileSync(target, "utf8")).toBe('{"schemaVersion":1}\n');
    if (process.platform !== "win32") expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it("refuses overwriting an existing file until replace is set", async () => {
    const home = freshHome();
    const target = join(home, "settings.json");
    writeFileSync(target, "before", { mode: 0o644 });

    await expect(saveExportedSettings("~/settings.json", "after", { home })).rejects.toBeInstanceOf(FileAlreadyThere);
    expect(readFileSync(target, "utf8")).toBe("before");

    expect(await saveExportedSettings("~/settings.json", "after", { home, replace: true })).toBe("~/settings.json");
    expect(readFileSync(target, "utf8")).toBe("after");
    if (process.platform !== "win32") expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it("resolves relative paths against home and keeps absolute paths outside home", async () => {
    const home = freshHome();
    const outside = freshHome();
    expect(await saveExportedSettings("backup/settings.json", "rel", { home })).toBe("~/backup/settings.json");
    expect(readFileSync(join(home, "backup", "settings.json"), "utf8")).toBe("rel");

    const external = join(outside, "settings.json");
    expect(await saveExportedSettings(external, "ext", { home })).toBe(external);
    expect(readFileSync(external, "utf8")).toBe("ext");
  });

  it("refuses empty paths, folders, and paths through a regular file", async () => {
    const home = freshHome();
    mkdirSync(join(home, "Downloads"));
    writeFileSync(join(home, "not-a-dir"), "x");

    await expect(saveExportedSettings("   ", "{}", { home })).rejects.toThrow(SaveRefused);
    await expect(saveExportedSettings("~/Downloads", "{}", { home })).rejects.toMatchObject({ problem: { code: "export-path-is-folder" } });
    await expect(saveExportedSettings("~/not-a-dir/settings.json", "{}", { home })).rejects.toMatchObject({ problem: { code: "save-path-part-is-file" } });
  });
});
