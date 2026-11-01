import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchScore, mentionSuggestions } from "../host/mentions.ts";
import { mentionAt, withMention } from "../shared/mentions.ts";

const workspace = mkdtempSync(join(tmpdir(), "mirador-mentions-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

function createWorkspace() {
  ["src/server", "src/web", "docs"].forEach((directory) => mkdirSync(join(workspace, directory), { recursive: true }));
  ["src/server/main.ts", "src/server/routes.ts", "src/web/Main.tsx", "docs/guide.md", "README.md", ".env", "ignored.log"].forEach((file) =>
    writeFileSync(join(workspace, file), ""),
  );
  writeFileSync(join(workspace, ".gitignore"), "*.log\n");
  Bun.spawnSync(["git", "init", "-q"], { cwd: workspace });
}
createWorkspace();

const paths = async (query: string) => (await mentionSuggestions(workspace, query)).map(({ path }) => path);

describe("@mentions", () => {
  test("are found where the caret is, after a space or at the start, and not in an email address", () => {
    expect(mentionAt("look at @src/ma", 15)).toEqual({ start: 8, query: "src/ma" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("mail me@example.com", 19)).toBeNull();
    expect(mentionAt("@done and more", 14)).toBeNull();
  });

  test("taking a suggestion replaces the whole word; a file gets a space after it, a directory stays open for more", () => {
    expect(withMention("see @src/ma now", 11, { path: "src/main.ts", directory: false })).toEqual({ text: "see @src/main.ts now", caret: 17 });
    expect(withMention("see @sr", 7, { path: "src/", directory: true })).toEqual({ text: "see @src/", caret: 9 });
  });

  test("a bare @ lists the workspace's top level, hiding dotfiles until a dot is typed", async () => {
    expect(await paths("")).toEqual(["docs/", "ignored.log", "README.md", "src/"]);
    expect(await paths(".e")).toEqual([".env"]);
  });

  test("a path is completed from its directory: relative to the workspace, absolute, or under home", async () => {
    expect(await paths("./src/")).toEqual(["./src/server/", "./src/web/"]);
    expect(await paths("./src/server/R")).toEqual(["./src/server/routes.ts"]);
    expect(await paths(`${workspace}/do`)).toEqual([`${workspace}/docs/`]);
    expect((await mentionSuggestions(workspace, "~/")).every(({ path }) => path.startsWith("~/"))).toBe(true);
  });

  test.if(process.platform === "win32")("on Windows a path may be typed with backslashes", async () => {
    expect(await paths(`${workspace}\\do`)).toEqual([`${workspace}\\docs/`]);
    expect(await paths(".\\src\\")).toEqual([".\\src\\server/", ".\\src\\web/"]);
    const underHome = await mentionSuggestions(workspace, "~\\");
    expect(underHome.length).toBeGreaterThan(0);
    expect(underHome.every(({ path }) => path.startsWith("~\\"))).toBe(true);
  });

  test("outside git, words search the workspace's files and their directories by the same names", async () => {
    const plainFolder = mkdtempSync(join(tmpdir(), "mirador-mentions-plain-"));
    mkdirSync(join(plainFolder, "src", "server"), { recursive: true });
    writeFileSync(join(plainFolder, "src", "server", "main.ts"), "");
    try {
      expect((await mentionSuggestions(plainFolder, "server")).map(({ path }) => path)).toEqual(["src/server/", "src/server/main.ts"]);
    } finally {
      rmSync(plainFolder, { recursive: true, force: true });
    }
  });

  test("words search the workspace's files and directories that git does not ignore, the closest match first", async () => {
    expect(await paths("main")).toEqual(["src/web/Main.tsx", "src/server/main.ts"]);
    expect((await paths("server"))[0]).toBe("src/server/");
    expect(await paths("ignored")).toEqual([]);
    expect(await paths("srvmain")).toEqual(["src/server/main.ts"]);
  });

  test("ranks a name over a path, and letters in order last", () => {
    expect(matchScore("src/main.ts", "main.ts")).toBe(5);
    expect(matchScore("src/main.ts", "ma")).toBe(4);
    expect(matchScore("src/domain.ts", "main")).toBe(3);
    expect(matchScore("src/main.ts", "src/m")).toBe(2);
    expect(matchScore("src/main.ts", "smts")).toBe(1);
    expect(matchScore("src/main.ts", "xyz")).toBeNull();
  });
});
