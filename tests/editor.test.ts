import { expect, test } from "bun:test";
import { commandWords, editorCommand, editorState, foundEditors, ideaLauncherMissing, type FindProgram } from "../host/editor.ts";
import { englishProblem } from "../shared/host-problems.ts";

const installed =
  (...programs: string[]): FindProgram =>
  (name) =>
    programs.includes(name) ? `/bin/${name}` : null;

test("without IDEA's launcher, the host says how IDEA sets one up on the host's platform", () => {
  expect(englishProblem(ideaLauncherMissing("darwin"))).toContain("In IDEA, choose Tools › Create Command Line Launcher…");
  expect(englishProblem(ideaLauncherMissing("win32"))).toContain(`Tick Add "bin" folder to the PATH in IDEA's installer, or install IDEA with the Toolbox App, then try again.`);
  expect(englishProblem(ideaLauncherMissing("win32"))).not.toContain("Create Command Line Launcher");
});

test("each editor Mirador knows gets the file and the line its own way", () => {
  const find = installed("idea", "code", "cursor", "zed", "subl");
  expect(editorCommand({ editor: "idea" }, "/w/a.ts", 7, find)).toEqual(["/bin/idea", "--line", "7", "/w/a.ts"]);
  expect(editorCommand({ editor: "code" }, "/w/a.ts", 7, find)).toEqual(["/bin/code", "--goto", "/w/a.ts:7"]);
  expect(editorCommand({ editor: "cursor" }, "/w/a.ts", 7, find)).toEqual(["/bin/cursor", "--goto", "/w/a.ts:7"]);
  expect(editorCommand({ editor: "zed" }, "/w/a.ts", 7, find)).toEqual(["/bin/zed", "/w/a.ts:7"]);
  expect(editorCommand({ editor: "subl" }, "/w/a.ts", 7, find)).toEqual(["/bin/subl", "/w/a.ts:7"]);
});

test("the first editor found is IDEA when it is there, and the next one in order when it is not", () => {
  expect(editorCommand({ editor: "first-found" }, "/w/a.ts", 2, installed("subl", "idea"))[0]).toBe("/bin/idea");
  expect(editorCommand({ editor: "first-found" }, "/w/a.ts", 2, installed("subl", "zed"))[0]).toBe("/bin/zed");
  expect(foundEditors(installed("subl", "code"))).toEqual(["code", "subl"]);
});

test("with no editor found, or the one Settings name missing, the error says what to do", () => {
  expect(() => editorCommand({ editor: "first-found" }, "/w/a.ts", 2, installed())).toThrow("Mirador found no editor on the host");
  expect(() => editorCommand({ editor: "code" }, "/w/a.ts", 2, installed("idea"))).toThrow("VS Code's command-line launcher (code) was not found on the host's PATH");
  expect(() => editorCommand({ editor: "custom", command: "emacsclient +{line} {file}" }, "/w/a.ts", 2, installed())).toThrow("Mirador cannot find emacsclient");
});

test("a command of the owner's gets {file} and {line} filled in, each path one word, with no shell", () => {
  const find = installed("nvim", "emacsclient");
  expect(editorCommand({ editor: "custom", command: "nvim +{line} {file}" }, "/w/my file.ts", 12, find)).toEqual(["/bin/nvim", "+12", "/w/my file.ts"]);
  expect(editorCommand({ editor: "custom", command: "emacsclient -n" }, "/w/a.ts; rm -rf ~", 3, find)).toEqual(["/bin/emacsclient", "-n", "/w/a.ts; rm -rf ~"]);
});

test("a program's path with spaces in it can be quoted", () => {
  expect(commandWords(`"/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl" {file}:{line}`)).toEqual(["/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl", "{file}:{line}"]);
  expect(commandWords(`'my editor' --wait`)).toEqual(["my editor", "--wait"]);
});

test("buttons name the editor they open in, or none when the first one found is wanted and none is", () => {
  expect(editorState({ editor: "first-found" }, installed("cursor")).opensIn).toBe("Cursor");
  expect(editorState({ editor: "first-found" }, installed()).opensIn).toBeNull();
  expect(editorState({ editor: "zed" }, installed()).opensIn).toBe("Zed");
  expect(editorState({ editor: "custom", command: "/usr/local/bin/nvim.exe +{line} {file}" }, installed()).opensIn).toBe("nvim");
});

test("on Windows, a launcher that runs through cmd.exe doesn't get a file name cmd.exe could take for a command", () => {
  const batchLaunchers: FindProgram = (name) => (name === "code" ? "C:\\VS Code\\bin\\code.cmd" : name === "subl" ? "C:\\Sublime\\subl.exe" : null);
  expect(() => editorCommand({ editor: "code" }, "C:\\w\\a&calc.ts", 1, batchLaunchers, "win32")).toThrow("runs through cmd.exe");
  expect(() => editorCommand({ editor: "code" }, "C:\\w\\100%.ts", 1, batchLaunchers, "win32")).toThrow("runs through cmd.exe");
  expect(editorCommand({ editor: "code" }, "C:\\w\\my file (1).ts", 1, batchLaunchers, "win32")).toEqual(["C:\\VS Code\\bin\\code.cmd", "--goto", "C:\\w\\my file (1).ts:1"]);
  expect(editorCommand({ editor: "subl" }, "C:\\w\\a&b.ts", 1, batchLaunchers, "win32")).toEqual(["C:\\Sublime\\subl.exe", "C:\\w\\a&b.ts:1"]);
  expect(editorCommand({ editor: "code" }, "/w/a&b.ts", 1, batchLaunchers, "darwin")[2]).toBe("/w/a&b.ts:1");
});
