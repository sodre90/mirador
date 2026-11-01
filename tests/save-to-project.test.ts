import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileAlreadyThere, SaveRefused, saveIntoWorkspace } from "../host/canvas/save-to-project.ts";

let sandbox: string;
let workspace: string;
let outside: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "save-to-project-"));
  workspace = join(sandbox, "workspace");
  outside = join(sandbox, "outside");
  await mkdir(workspace);
  await mkdir(outside);
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

const PAGE = "<h1>Checkout</h1>";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);

const rejectionOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => {
      throw new Error("the save was not refused");
    },
    (error: unknown) => error,
  );

const expectRefused = async (attempt: Promise<unknown>, message: string) => {
  const error = await rejectionOf(attempt);
  expect(error).toBeInstanceOf(SaveRefused);
  expect((error as Error).message).toBe(message);
};

const NOT_INSIDE = (name: string) => `"${name}" is not a file inside the project folder.`;

describe("saveIntoWorkspace", () => {
  test("creates the missing folders and returns the path relative to the workspace", async () => {
    const saved = await saveIntoWorkspace(workspace, "  docs/flows/checkout-flow.html  ", PAGE);
    expect(saved).toBe("docs/flows/checkout-flow.html");
    expect(await readFile(join(workspace, "docs/flows/checkout-flow.html"), "utf8")).toBe(PAGE);
  });

  test("writes the content as given, non-ASCII text included, and accepts an .HTM name", async () => {
    const content = "<p>Ellenőrzés — ✓ 日本語</p>";
    await saveIntoWorkspace(workspace, "Notes.HTM", content);
    expect(await readFile(join(workspace, "Notes.HTM"), "utf8")).toBe(content);
  });

  test("refuses an existing file with FileAlreadyThere and keeps it, and replaces it when asked to", async () => {
    await mkdir(join(workspace, "docs"));
    await writeFile(join(workspace, "docs/a.html"), "old");

    const error = await rejectionOf(saveIntoWorkspace(workspace, "docs/a.html", PAGE));
    expect(error).toBeInstanceOf(FileAlreadyThere);
    expect((error as Error).message).toBe("docs/a.html is already there.");
    expect(await readFile(join(workspace, "docs/a.html"), "utf8")).toBe("old");

    await saveIntoWorkspace(workspace, "docs/a.html", PAGE, { replace: true });
    expect(await readFile(join(workspace, "docs/a.html"), "utf8")).toBe(PAGE);
  });

  test("writes image bytes to a .png name, and refuses an image under any other name", async () => {
    const saved = await saveIntoWorkspace(workspace, "docs/flow.png", PNG);
    expect(saved).toBe("docs/flow.png");
    expect(new Uint8Array(await readFile(join(workspace, "docs/flow.png")))).toEqual(PNG);
    await expectRefused(saveIntoWorkspace(workspace, "flow.html", PNG), "Save the image as a .png file.");
    expect(await readdir(workspace)).toEqual(["docs"]);
  });

  test("refuses an existing image with FileAlreadyThere and keeps it, and replaces it when asked to", async () => {
    await saveIntoWorkspace(workspace, "a.png", PNG);
    const other = new Uint8Array([1, 2, 3]);

    const error = await rejectionOf(saveIntoWorkspace(workspace, "a.png", other));
    expect(error).toBeInstanceOf(FileAlreadyThere);
    expect(new Uint8Array(await readFile(join(workspace, "a.png")))).toEqual(PNG);

    await saveIntoWorkspace(workspace, "a.png", other, { replace: true });
    expect(new Uint8Array(await readFile(join(workspace, "a.png")))).toEqual(other);
  });

  test("refuses a path that leads out of the workspace and writes nothing", async () => {
    await expectRefused(saveIntoWorkspace(workspace, "../x.html", PAGE), NOT_INSIDE("../x.html"));
    await expectRefused(saveIntoWorkspace(workspace, "docs/../../x.html", PAGE), NOT_INSIDE("docs/../../x.html"));
    expect((await readdir(sandbox)).sort()).toEqual(["outside", "workspace"]);
  });

  test("refuses the workspace folder itself and writes nothing", async () => {
    await expectRefused(saveIntoWorkspace(workspace, ".", PAGE), NOT_INSIDE("."));
    await expectRefused(saveIntoWorkspace(workspace, "docs/..", PAGE), NOT_INSIDE("docs/.."));
    expect(await readdir(workspace)).toEqual([]);
  });

  test("refuses an absolute path and writes nothing", async () => {
    const absolute = join(outside, "x.html");
    await expectRefused(saveIntoWorkspace(workspace, absolute, PAGE), `"${absolute}" is an absolute path. Give a path inside the project folder.`);
    expect(await readdir(outside)).toEqual([]);
  });

  test("refuses an empty path and writes nothing", async () => {
    await expectRefused(saveIntoWorkspace(workspace, "   ", PAGE), "Name the file to save the page as.");
    expect(await readdir(workspace)).toEqual([]);
  });

  test("refuses a name that does not end in .html and writes nothing", async () => {
    await expectRefused(saveIntoWorkspace(workspace, "notes.txt", PAGE), "Save the page as an .html file.");
    expect(await readdir(workspace)).toEqual([]);
  });

  test("refuses a path that is an existing folder and writes nothing inside it", async () => {
    await mkdir(join(workspace, "page.html"));
    await expectRefused(saveIntoWorkspace(workspace, "page.html", PAGE, { replace: true }), `"page.html" is a folder. Name the page differently.`);
    expect(await readdir(join(workspace, "page.html"))).toEqual([]);
  });

  test("refuses a path through a file as if it were a folder", async () => {
    await writeFile(join(workspace, "notes.html"), PAGE);
    await expectRefused(saveIntoWorkspace(workspace, "notes.html/page.html", PAGE), 'Part of "notes.html/page.html" is a file, not a folder.');
    expect(await readFile(join(workspace, "notes.html"), "utf8")).toBe(PAGE);
  });

  test("refuses a folder that is a link to somewhere outside, and writes nothing there", async () => {
    await symlink(outside, join(workspace, "linked"));
    await expectRefused(saveIntoWorkspace(workspace, "linked/a.html", PAGE), NOT_INSIDE("linked/a.html"));
    expect(await readdir(outside)).toEqual([]);
  });

  test("refuses a page name that is a link to a file outside, even when replacing", async () => {
    const victim = join(outside, "victim.html");
    await writeFile(victim, "keep me");
    await symlink(victim, join(workspace, "page.html"));
    await expectRefused(saveIntoWorkspace(workspace, "page.html", PAGE, { replace: true }), NOT_INSIDE("page.html"));
    expect(await readFile(victim, "utf8")).toBe("keep me");
  });
});
