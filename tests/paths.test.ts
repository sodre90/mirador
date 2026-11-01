import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { completeDirectories, createsDirectory, directoryToAdd, existingDirectory, expandHome, parentOf } from "../host/paths.ts";

const folder = mkdtempSync(join(tmpdir(), "mirador-paths-"));
["alpha", "beta", ".hidden"].forEach((name) => mkdirSync(join(folder, name)));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe("paths typed by the user", () => {
  test("~ is home, followed by a slash anywhere and on Windows by a backslash too", () => {
    expect(expandHome("~")).toBe(homedir());
    expect(expandHome("~/prj", "darwin")).toBe(join(homedir(), "prj"));
    expect(expandHome("~\\prj", "win32")).toBe(join(homedir(), "prj"));
    expect(expandHome("~\\prj", "linux")).toBe("~\\prj");
    expect(expandHome("~other/prj", "win32")).toBe("~other/prj");
  });

  test("the folder of the name being typed ends at the last slash, on Windows at the last backslash too", () => {
    expect(parentOf("/Users/me/pr", "darwin")).toBe("/Users/me/");
    expect(parentOf("C:\\Users\\me\\pr", "win32")).toBe("C:\\Users\\me\\");
    expect(parentOf("C:\\Users/me\\pr", "win32")).toBe("C:\\Users/me\\");
    expect(parentOf("dir\\name", "linux")).toBe("");
  });

  test("a folder's directories complete what is typed, hiding dot folders until a dot is typed", async () => {
    expect(await completeDirectories(`${folder}/`)).toEqual([`${folder}/alpha/`, `${folder}/beta/`]);
    expect(await completeDirectories(`${folder}/b`)).toEqual([`${folder}/beta/`]);
    expect(await completeDirectories(`${folder}/.h`)).toEqual([`${folder}/.hidden/`]);
    expect((await completeDirectories("~")).every((path) => path.startsWith("~/"))).toBe(true);
  });

  test("adding a path that is not there yet makes the folder, but only in a folder that is", async () => {
    const parent = join(folder, "alpha");
    expect(await createsDirectory(`${folder}/beta`)).toBe(false);
    expect(await createsDirectory(`${parent}/missing/new`)).toBe(false);
    expect(await createsDirectory(`${parent}/new`)).toBe(true);
    expect(await directoryToAdd(`${parent}/new/`)).toBe(join(parent, "new"));
    expect(statSync(join(parent, "new")).isDirectory()).toBe(true);
    await expect(directoryToAdd(`${parent}/missing/new`)).rejects.toThrow("is not a directory");
    expect(existsSync(join(parent, "missing"))).toBe(false);
  });

  test.if(process.platform === "win32")("on Windows a folder typed with backslashes completes, and ~\\ is home", async () => {
    expect(await completeDirectories(`${folder}\\`)).toEqual([`${folder}\\alpha/`, `${folder}\\beta/`]);
    expect(await completeDirectories(`${folder}\\al`)).toEqual([`${folder}\\alpha/`]);
    expect((await completeDirectories("~\\")).every((path) => path.startsWith("~\\"))).toBe(true);
    expect(await existingDirectory("~\\")).toBe(homedir());
  });
});
