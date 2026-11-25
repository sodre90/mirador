import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changeAskedFor, changeMade, diffOf, readInWorkspace } from "../host/room-workspace/files.ts";
import { onThisComputer } from "../host/room-workspace/workspace-place.ts";
import { placeInWorkspace, WorkspaceCallRefused, type FileChange } from "../host/sandbox/in-vm/workspace-files.ts";
import { WORKSPACE_FILE_MOST_BYTES, WORKSPACE_RESULT_MOST_CHARACTERS } from "../shared/room-workspace.ts";

const diskIgnoresCase = existsSync(import.meta.path.toUpperCase());
const onWindows = process.platform === "win32";

let root: string;
let workspace: string;
let miradorsData: string;
const here = () => onThisComputer(workspace, miradorsData, () => ({}));
const unstopped = new AbortController().signal;
const read = (path: string, fromLine = 1) => readInWorkspace({ kind: "read", path, fromLine }, here(), unstopped);
const edit = (path: string, old: string, replacement: string) => changeAskedFor({ kind: "edit", path, old, new: replacement }, here(), unstopped);
const write = (path: string, content: string) => changeAskedFor({ kind: "write", path, content }, here(), unstopped);
const makeChange = (change: FileChange) => changeMade(change, here(), unstopped);
const inWorkspace = (...path: string[]) => join(workspace, ...path);

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "room-workspace-")));
  workspace = join(root, "project");
  miradorsData = join(workspace, "data", ".mirador");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(join(workspace, ".git"));
  mkdirSync(miradorsData, { recursive: true });
  writeFileSync(inWorkspace("src", "a.ts"), "one\ntwo\nthree\n");
  writeFileSync(inWorkspace(".git", "config"), "[core]\n");
  writeFileSync(join(miradorsData, "state.sqlite"), "secret\n");
  writeFileSync(join(root, "outside.txt"), "outside\n");
  mkdirSync(join(root, "project-2"));
  writeFileSync(join(root, "project-2", "b.txt"), "a neighbour\n");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("reading in a room's workspace", () => {
  test("a file is read from a line on, saying which lines of how many", async () => {
    expect(await read("src/a.ts")).toEqual({ done: true, text: "Lines 1 to 4 of 4:\none\ntwo\nthree\n" });
    expect((await read("src/a.ts", 2)).text).toBe("Lines 2 to 4 of 4:\ntwo\nthree\n");
    await expect(read("src/a.ts", 5)).rejects.toThrow("The file has 4 lines.");
  });

  test("a file longer than an answer holds is cut, saying where", async () => {
    writeFileSync(inWorkspace("long.txt"), `${"x".repeat(99)}\n`.repeat(1_000));
    const { text } = await read("long.txt");
    expect(text.startsWith("Lines 1 to 600 of 1001, cut there:\n") || text.startsWith("Lines 1 to 601 of 1001, cut there:\n")).toBe(true);
    expect(text.length).toBeLessThan(WORKSPACE_RESULT_MOST_CHARACTERS + 100);
  });

  test("a folder is listed, the workspace itself too", async () => {
    expect((await read(".")).text).toBe(".git/\ndata/\nsrc/");
    expect((await read("src")).text).toBe("a.ts");
  });

  test.each([
    ["the parent", "../outside.txt"],
    ["a neighbour whose name begins the same", "../project-2/b.txt"],
    ["an absolute path outside", "/etc/hosts"],
    ["a path that comes back in and leaves again", "src/../../outside.txt"],
  ])("nothing outside is read: %s", async (_, path) => {
    await expect(read(path)).rejects.toThrow("is outside the room's workspace");
  });

  test("a link out of the workspace is followed to where it leads, and refused: to a file, through a folder, through a chain, and dangling", async () => {
    symlinkSync(join(root, "outside.txt"), inWorkspace("link.txt"));
    symlinkSync(root, inWorkspace("up"));
    symlinkSync("up", inWorkspace("chain"));
    symlinkSync(join(root, "not-there"), inWorkspace("dangling"));
    for (const path of ["link.txt", "up/outside.txt", "chain/outside.txt", "up/project-2/b.txt"]) await expect(read(path)).rejects.toThrow("is outside the room's workspace");
    await expect(read("dangling")).rejects.toThrow(WorkspaceCallRefused);
  });

  test("a path with more links than the computer follows is refused, read or written, rather than taken for one not there yet", async () => {
    symlinkSync("..", inWorkspace("up"));
    symlinkSync(".", inWorkspace("round"));
    symlinkSync(join(root, "project-2"), inWorkspace("out"));
    symlinkSync(".git", inWorkspace("git-link"));
    const manyLinks = [`${"up/project/".repeat(60)}up/outside.txt`, `${"round/".repeat(60)}out/b.txt`, `${"round/".repeat(60)}git-link/config`];
    for (const path of manyLinks) await expect(read(path)).rejects.toThrow(WorkspaceCallRefused);
    for (const path of [...manyLinks, `${"up/project/".repeat(60)}up/new.txt`, `${"round/".repeat(60)}out/new.txt`]) await expect(write(path, "x").then(makeChange)).rejects.toThrow(WorkspaceCallRefused);
    expect(existsSync(join(root, "new.txt"))).toBe(false);
    expect(existsSync(join(root, "project-2", "new.txt"))).toBe(false);
  });

  const otherCaseIsAnother = !existsSync(import.meta.path.toUpperCase());

  test.skipIf(!otherCaseIsAnother)("a neighbour whose name differs in case alone is outside, where the disk tells them apart", async () => {
    mkdirSync(join(root, "PROJECT"));
    writeFileSync(join(root, "PROJECT", "c.txt"), "a neighbour\n");
    await expect(read("../PROJECT/c.txt")).rejects.toThrow("is outside the room's workspace");
    await expect(write("../PROJECT/d.txt", "x")).rejects.toThrow("is outside the room's workspace");
  });

  test.skipIf(diskIgnoresCase)("a neighbour whose name differs in its case alone is outside, where the disk tells them apart", async () => {
    mkdirSync(join(root, "PROJECT"));
    writeFileSync(join(root, "PROJECT", "b.txt"), "a neighbour\n");
    await expect(read("../PROJECT/b.txt")).rejects.toThrow("is outside the room's workspace");
  });

  test("a link that stays inside is read", async () => {
    symlinkSync(inWorkspace("src", "a.ts"), inWorkspace("a-link.ts"));
    expect((await read("a-link.ts")).text).toContain("two");
  });

  test("neither git's own files nor Mirador's data are read, named straight, in another case or through a link", async () => {
    symlinkSync(miradorsData, inWorkspace("data-link"));
    symlinkSync(inWorkspace(".git"), inWorkspace("git-link"));
    for (const path of [".git/config", ".git", "src/../.git/config", "git-link/config", ".GIT/config"]) await expect(read(path)).rejects.toThrow(/\.git is|There is no/);
    for (const path of ["data/.mirador/state.sqlite", "data/.mirador", "data-link/state.sqlite"]) await expect(read(path)).rejects.toThrow("is Mirador's own data");
    await expect(read("data/.MIRADOR/state.sqlite")).rejects.toThrow(WorkspaceCallRefused);
  });

  test.skipIf(onWindows)("no pipe is read", async () => {
    Bun.spawnSync(["mkfifo", inWorkspace("pipe")]);
    await expect(read("pipe")).rejects.toThrow("is no regular file");
  });

  test("no binary and no large file is read", async () => {
    writeFileSync(inWorkspace("binary"), new Uint8Array([1, 0, 2]));
    writeFileSync(inWorkspace("latin1"), new Uint8Array([0x63, 0xe9]));
    writeFileSync(inWorkspace("large"), "x".repeat(WORKSPACE_FILE_MOST_BYTES + 1));
    await expect(read("binary")).rejects.toThrow("is no text file");
    await expect(read("latin1")).rejects.toThrow("is no text file");
    await expect(read("large")).rejects.toThrow("is larger than");
  });

  test.skipIf(onWindows)("a path that leads to a name with a line break is refused", async () => {
    writeFileSync(inWorkspace("a\n+safe"), "x");
    symlinkSync(inWorkspace("a\n+safe"), inWorkspace("plain.txt"));
    await expect(write("plain.txt", "y")).rejects.toThrow("leads to a name with control characters");
  });

  test("a path with a null character, a line break or another control character, and a workspace that is gone, are refused", async () => {
    for (const path of ["src/a.ts\0.png", "src/a.ts\n+safe", "a\r.txt", "a\u0085.txt"]) await expect(read(path)).rejects.toThrow("A path holds no control characters.");
    rmSync(workspace, { recursive: true });
    await expect(read("src/a.ts")).rejects.toThrow("The room's workspace is not there.");
  });

  test("on Windows, a path naming a data stream or holding a colon in any name is refused before anything is made", async () => {
    const folders = { workspace, miradorsData, fileMostBytes: WORKSPACE_FILE_MOST_BYTES };
    const streams = ["CLAUDE.md::$DATA", ".mcp.json::$DATA", ".mcp.json::$data", "src/a.ts:hidden", ".claude::$INDEX_ALLOCATION/settings.json", "C:CLAUDE.md", "C:/ws/CLAUDE.md::$DATA"];
    for (const path of streams) expect(() => placeInWorkspace(path, folders, true)).toThrow("A path on Windows holds no colons.");
    for (const path of ["CLAUDE.md.", ".mcp.json ", ".claude./settings.json", ".git./config"]) expect(() => placeInWorkspace(path, folders, true)).toThrow("ends no name in a dot or space");
    for (const path of ["CLAUDE.md.", ".mcp.json ", ".claude./settings.json"]) await expect(write(path, "x")).rejects.toThrow("Claude Code's own sessions");
    await expect(write("sub/.git./config", "x")).rejects.toThrow(".git is reached by git's own commands");
    if (!onWindows) {
      writeFileSync(inWorkspace("note:1.txt"), "ok\n");
      expect((await read("note:1.txt")).text).toContain("ok");
      symlinkSync(inWorkspace("note:1.txt"), inWorkspace("to-colon.txt"));
      expect(() => placeInWorkspace("to-colon.txt", folders, true)).toThrow("leads to a name with a colon");
    } else {
      expect(placeInWorkspace(inWorkspace("src", "a.ts"), folders, true).within).toBe("src/a.ts");
      for (const path of streams) await expect(write(path, "x")).rejects.toThrow("A path on Windows holds no colons.");
      expect(existsSync(inWorkspace("CLAUDE.md"))).toBe(false);
      expect(existsSync(inWorkspace(".mcp.json"))).toBe(false);
      expect(existsSync(inWorkspace(".claude"))).toBe(false);
    }
  });

  test("a workspace reached through a link is the one it leads to", () => {
    symlinkSync(workspace, join(root, "by-link"));
    expect(placeInWorkspace("src/a.ts", { workspace: join(root, "by-link"), miradorsData, fileMostBytes: WORKSPACE_FILE_MOST_BYTES }).place).toBe(inWorkspace("src", "a.ts"));
  });
});

describe("changing a file in a room's workspace", () => {
  test("a text that is there once is replaced, with the whole change to show first", async () => {
    const change = await edit("src/a.ts", "two", "2 $& $1");
    expect(diffOf(change)).toBe("--- src/a.ts\n+++ src/a.ts\n@@ -1,3 +1,3 @@\n one\n-two\n+2 $& $1\n three");
    expect(readFileSync(inWorkspace("src", "a.ts"), "utf8")).toBe("one\ntwo\nthree\n");
    expect(await makeChange(change)).toEqual({ done: true, text: "Changed src/a.ts." });
    expect(readFileSync(inWorkspace("src", "a.ts"), "utf8")).toBe("one\n2 $& $1\nthree\n");
  });

  test("a shorter text leaves nothing of the longer one", async () => {
    await makeChange(await write("src/a.ts", "1\n"));
    expect(readFileSync(inWorkspace("src", "a.ts"), "utf8")).toBe("1\n");
  });

  test.skipIf(onWindows)("a changed file keeps its mode", async () => {
    chmodSync(inWorkspace("src", "a.ts"), 0o755);
    await makeChange(await write("src/a.ts", "1\n"));
    expect(statSync(inWorkspace("src", "a.ts")).mode & 0o777).toBe(0o755);
  });

  test("a new file is written with the folders it needs", async () => {
    const change = await write("docs/deep/new.md", "hello\n");
    expect(diffOf(change)).toBe("--- /dev/null\n+++ docs/deep/new.md\n@@ -0,0 +1,1 @@\n+hello");
    expect(existsSync(inWorkspace("docs"))).toBe(false);
    expect((await makeChange(change)).text).toBe("Wrote docs/deep/new.md.");
    expect(readFileSync(inWorkspace("docs", "deep", "new.md"), "utf8")).toBe("hello\n");
  });

  test("a text that is not there, or there twice, a file that is not, and a change that changes nothing are refused", async () => {
    writeFileSync(inWorkspace("twice.txt"), "a\na\n");
    await expect(edit("src/a.ts", "four", "4")).rejects.toThrow("is not in src/a.ts");
    await expect(edit("twice.txt", "a", "b")).rejects.toThrow("2 times");
    await expect(edit("gone.txt", "a", "b")).rejects.toThrow("There is no gone.txt.");
    await expect(write("src/a.ts", "one\ntwo\nthree\n")).rejects.toThrow("already reads so");
    await expect(write("src", "x")).rejects.toThrow(WorkspaceCallRefused);
  });

  test.each([".git/hooks/pre-commit", ".GIT/hooks/pre-commit", "sub/.git/config", "data/.mirador/settings", "../outside.txt", "/tmp/elsewhere.txt"])("%s is not written", async (path) => {
    await expect(write(path, "x")).rejects.toThrow(WorkspaceCallRefused);
  });

  test("nor is .git begun by another spelling of it where there is none yet", async () => {
    rmSync(inWorkspace(".git"), { recursive: true });
    for (const path of [".git/hooks/pre-commit", ".GIT/hooks/pre-commit", "sub/.Git/config", ".g\u200Cit/config"]) await expect(write(path, "x")).rejects.toThrow("What git keeps in .git");
  });

  test("nor is Mirador's data begun by another spelling of it where there is none yet", async () => {
    rmSync(miradorsData, { recursive: true });
    for (const path of ["data/.mirador/new", "data/.MIRADOR/new"]) await expect(write(path, "x")).rejects.toThrow("is Mirador's own data");
  });

  test("nor where the folder Mirador's data would be in is named through a link", async () => {
    rmSync(miradorsData, { recursive: true });
    symlinkSync(workspace, join(root, "by-link"));
    miradorsData = join(root, "by-link", "data", ".mirador");
    await expect(write("data/.mirador/new", "x")).rejects.toThrow("is Mirador's own data");
  });

  test("a change too large to be read through asks for nothing", async () => {
    writeFileSync(inWorkspace("large.txt"), "line\n".repeat(60_000));
    const change = await write("large.txt", "short\n");
    expect(() => diffOf(change)).toThrow("too large to be read through");
  });

  test("nor does one of few lines that are as long", async () => {
    writeFileSync(inWorkspace("wide.txt"), `${"x".repeat(1_000)}\n`.repeat(200));
    const change = await write("wide.txt", "short\n");
    expect(() => diffOf(change)).toThrow("too large to be read through");
  });

  const numbered = (word: string, count: number) => Array.from({ length: count }, (_, index) => `${word}${index}\n`).join("");

  test("a change that takes out and puts in more lines than anyone reads through is refused, and one of fewer lines or a long new file is not", async () => {
    const before = numbered("a", 700);
    const withFirstLinesChanged = (count: number) => numbered("b", count) + before.split(/(?<=\n)/).slice(count).join("");
    writeFileSync(inWorkspace("many.txt"), before);
    const tooMany = await write("many.txt", withFirstLinesChanged(601));
    expect(() => diffOf(tooMany)).toThrow("too large to be read through");
    expect(diffOf(await write("many.txt", withFirstLinesChanged(300)))).toContain("\n+b299\n");
    expect(diffOf(await write("new.txt", numbered("c", 4_000))).split("\n")).toHaveLength(4_003);
  });

  test.each([".claude/settings.json", ".CLAUDE/settings.json", "CLAUDE.md", "sub/claude.md", "CLAUDE.local.md", ".mcp.json", ".mcp.j\u017Fon", ".cl\u200Baude/settings.json"])("%s, which Claude Code's own sessions load, is not written", async (path) => {
    await expect(write(path, "x")).rejects.toThrow("Claude Code's own sessions");
  });

  test("nor through a link that leads to it under another name", async () => {
    writeFileSync(inWorkspace("CLAUDE.md"), "rules\n");
    symlinkSync(inWorkspace("CLAUDE.md"), inWorkspace("notes.md"));
    await expect(edit("notes.md", "rules", "hooks")).rejects.toThrow("Claude Code's own sessions");
  });

  test("nor by such a name that is a link to another file", async () => {
    writeFileSync(inWorkspace("notes.md"), "rules\n");
    symlinkSync(inWorkspace("notes.md"), inWorkspace("CLAUDE.md"));
    await expect(edit("CLAUDE.md", "rules", "hooks")).rejects.toThrow("Claude Code's own sessions");
  });

  test("a new file under a link that leads out is not written", async () => {
    symlinkSync(root, inWorkspace("up"));
    symlinkSync(join(root, "made-later"), inWorkspace("dangling"));
    await expect(write("up/new.txt", "x")).rejects.toThrow("is outside the room's workspace");
    for (const path of ["dangling", "dangling/new.txt"]) await expect(write(path, "x")).rejects.toThrow("leads nowhere that can be reached");
    expect(existsSync(join(root, "made-later"))).toBe(false);
  });

  test("a file changed since the change was asked for is left as it is", async () => {
    const change = await edit("src/a.ts", "two", "2");
    writeFileSync(inWorkspace("src", "a.ts"), "one\ntwo\nthree\nfour\n");
    await expect(makeChange(change)).rejects.toThrow("was changed meanwhile");
    expect(readFileSync(inWorkspace("src", "a.ts"), "utf8")).toBe("one\ntwo\nthree\nfour\n");
  });

  test("a file swapped for a link out, or its folder for one, while the change waited is left as it is", async () => {
    const byFile = await edit("src/a.ts", "two", "2");
    renameSync(inWorkspace("src", "a.ts"), inWorkspace("src", "moved.ts"));
    writeFileSync(join(root, "target.txt"), "one\ntwo\nthree\n");
    symlinkSync(join(root, "target.txt"), inWorkspace("src", "a.ts"));
    await expect(makeChange(byFile)).rejects.toThrow(WorkspaceCallRefused);

    const byFolder = await write("later/new.txt", "x");
    mkdirSync(join(root, "elsewhere"));
    symlinkSync(join(root, "elsewhere"), inWorkspace("later"));
    await expect(makeChange(byFolder)).rejects.toThrow();
    expect(readFileSync(join(root, "target.txt"), "utf8")).toBe("one\ntwo\nthree\n");
    expect(existsSync(join(root, "elsewhere", "new.txt"))).toBe(false);
  });

  test("a link that came to lead to another file of the workspace while the change waited, one that reads the same, is left as it is", async () => {
    writeFileSync(inWorkspace("src", "same.ts"), readFileSync(inWorkspace("src", "a.ts")));
    symlinkSync("src/a.ts", inWorkspace("link.ts"));
    const change = await edit("link.ts", "two", "2");
    rmSync(inWorkspace("link.ts"));
    symlinkSync("src/same.ts", inWorkspace("link.ts"));
    await expect(makeChange(change)).rejects.toThrow("leads elsewhere than it did");
    expect(readFileSync(inWorkspace("src", "same.ts"), "utf8")).toBe("one\ntwo\nthree\n");
  });

  test("a new file that came to be while the change waited is left as it is", async () => {
    const change = await write("new.txt", "x");
    writeFileSync(inWorkspace("new.txt"), "someone else's\n");
    await expect(makeChange(change)).rejects.toThrow("came to be meanwhile");
    expect(readFileSync(inWorkspace("new.txt"), "utf8")).toBe("someone else's\n");
  });

  test("a hard link is a file of the workspace like any other", async () => {
    linkSync(inWorkspace("src", "a.ts"), inWorkspace("hard.ts"));
    expect((await read("hard.ts")).text).toContain("two");
  });

  test("a hard link is at its own name, also while another of its names is read", async () => {
    const otherName = join(root, "outside.txt");
    linkSync(otherName, inWorkspace("hard.ts"));
    const placed = Array.from({ length: 200 }, () => {
      const beingRead = readFile(otherName);
      return { beingRead, within: placeInWorkspace("hard.ts", { workspace, miradorsData, fileMostBytes: WORKSPACE_FILE_MOST_BYTES }).within };
    });
    await Promise.all(placed.map(({ beingRead }) => beingRead));
    expect([...new Set(placed.map(({ within }) => within))]).toEqual(["hard.ts"]);
  });
});
