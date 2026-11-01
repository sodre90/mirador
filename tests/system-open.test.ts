import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProgram, looksLikeText, openingOf, scriptOpeningCommand, systemOpenCommand } from "../host/system-open.ts";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mirador-system-open-"));
});
afterEach(() => rm(directory, { recursive: true, force: true }));

test("each platform opens a file with its own default-program command", () => {
  expect(systemOpenCommand("/a/b.png", "darwin")).toEqual({ command: ["open", "/a/b.png"], environment: {} });
  expect(systemOpenCommand("/a/b.png", "linux")).toEqual({ command: ["xdg-open", "/a/b.png"], environment: {} });
});

test("on Windows the file reaches the default program through the environment, never through a command line cmd would read", () => {
  const file = "C:\\a\\opener.cmd&probe&.txt";
  const { command, environment } = systemOpenCommand(file, "win32");
  expect(command.join(" ")).not.toContain(file);
  expect(command.some((part) => part.toLowerCase().includes("cmd"))).toBe(false);
  expect(environment).toEqual({ MIRADOR_OPEN_FILE: file });
});

test("a file Windows would run is a program, by PATHEXT or by the other extensions its default action runs", () => {
  expect(isProgram("C:\\a\\setup.EXE", "win32", { PATHEXT: ".COM;.EXE;.BAT" })).toBe(true);
  expect(isProgram("C:\\a\\run.bat", "win32", { PATHEXT: ".COM;.EXE;.BAT" })).toBe(true);
  expect(isProgram("C:\\a\\tool.js", "win32", {})).toBe(true);
  expect(isProgram("C:\\a\\setup.EXE", "win32", { PATHEXT: "" })).toBe(true);
  expect(isProgram("C:\\a\\shortcut.lnk", "win32", {})).toBe(true);
  expect(isProgram("C:\\a\\help.chm", "win32", {})).toBe(true);
  expect(isProgram("C:\\a\\notes.md", "win32", {})).toBe(false);
  expect(isProgram("C:\\a\\diagram.png", "win32", {})).toBe(false);
});

test("on macOS and Linux a file is a program when it is executable or its type runs when opened", async () => {
  const script = join(directory, "build");
  const notes = join(directory, "notes.md");
  await writeFile(script, "#!/bin/sh\n");
  await chmod(script, 0o755);
  await writeFile(notes, "notes\n");
  // NTFS carries no executable bit, so a chmod there leaves no trace: the file is a program exactly when the disk says so.
  const isExecutable = ((await stat(script)).mode & 0o111) !== 0;
  for (const platform of ["darwin", "linux"] as const) {
    expect(isProgram(script, platform)).toBe(isExecutable);
    expect(isProgram(notes, platform)).toBe(false);
  }
  expect(isProgram(join(directory, "Tool.app"), "darwin")).toBe(true);
  expect(isProgram(join(directory, "run.command"), "darwin")).toBe(true);
  expect(isProgram(join(directory, "launcher.desktop"), "linux")).toBe(true);
});

test("on Linux a Windows program is a program even without the executable bit, as Wine could run it", () => {
  for (const name of ["setup.exe", "installer.msi", "run.bat", "run.cmd"]) {
    expect(isProgram(join(directory, name), "linux")).toBe(true);
  }
  expect(openingOf(join(directory, "setup.exe"), "linux", {})).toBe("refused");
  expect(isProgram(join(directory, "notes.md"), "linux")).toBe(false);
});

test("on Linux a file named after a domain is not a program", () => {
  expect(isProgram(join(directory, "example.com"), "linux")).toBe(false);
  expect(openingOf(join(directory, "example.com"), "linux", {})).toBe("default");
});

test("a script opens as text, executable or not; a program is still refused, and any other file opens with the default program", async () => {
  const script = join(directory, "build.sh");
  await writeFile(script, "#!/bin/sh\n");
  await chmod(script, 0o755);
  for (const platform of ["darwin", "linux", "win32"] as const) {
    expect(openingOf(script, platform, {})).toBe("as-text");
    expect(openingOf(join(directory, "tool.py"), platform, {})).toBe("as-text");
    expect(openingOf(join(directory, "notes.md"), platform, {})).toBe("default");
    expect(openingOf(join(directory, "tool.jar"), platform, {})).toBe("refused");
  }
  const onWindows = (names: string[]) => names.map((name) => openingOf(`C:\\a\\${name}`, "win32", {}));
  expect(onWindows(["a.js", "a.jse", "a.vbs", "a.vbe", "a.wsf", "a.wsh", "a.ps1", "a.pyw"])).toEqual(Array(8).fill("as-text"));
  expect(onWindows(["setup.exe", "run.bat", "run.cmd", "help.chm", "app.pyz", "shortcut.lnk"])).toEqual(Array(6).fill("refused"));
  expect(openingOf(join(directory, "Tool.app"), "darwin")).toBe("refused");
  expect(openingOf(join(directory, "run.command"), "darwin")).toBe("refused");
  expect(openingOf(join(directory, "app.js"), "darwin")).toBe("default");
});

test("a script opens in the system's text editor: on macOS the one chosen for text, on Windows Notepad, on Linux through xdg-open unless it is executable", async () => {
  const script = join(directory, "run.sh");
  await writeFile(script, "#!/bin/sh\n");
  expect(scriptOpeningCommand(script, "", "darwin")).toEqual({ command: ["open", "-t", script], environment: {} });
  expect(scriptOpeningCommand("C:\\a\\run.sh", "", "win32")).toEqual({ command: ["notepad.exe", "C:\\a\\run.sh"], environment: {} });
  expect(scriptOpeningCommand(script, "", "linux")).toEqual({ command: ["xdg-open", script], environment: {} });
  await chmod(script, 0o755);
  expect(scriptOpeningCommand(script, "", "darwin")).toEqual({ command: ["open", "-t", script], environment: {} });
  // NTFS carries no executable bit, so there the script stays one xdg-open would only show.
  if (((await stat(script)).mode & 0o111) !== 0) expect(() => scriptOpeningCommand(script, "", "linux")).toThrow("is executable, and xdg-open could run it");
});

test("a program Settings name opens scripts, executable ones too, run as it was found with the script's path an argument of its own", async () => {
  const script = join(directory, "run.sh");
  await writeFile(script, "#!/bin/sh\n");
  await chmod(script, 0o755);
  const finding = (programs: Record<string, string>) => (name: string) => programs[name] ?? null;
  for (const platform of ["darwin", "linux"] as const) {
    expect(scriptOpeningCommand(script, "code", platform, finding({ code: "/usr/local/bin/code" }))).toEqual({ command: ["/usr/local/bin/code", script], environment: {} });
  }
  expect(() => scriptOpeningCommand(script, "subl", "darwin", finding({}))).toThrow("Mirador cannot find subl");
});

test("on Windows a script's name never reaches a cmd.exe command line: Notepad or a named .exe gets it as an argument, and a .cmd or .bat program is refused", () => {
  const file = 'C:\\a\\x&calc^%PATH%".sh';
  const notepad = scriptOpeningCommand(file, "", "win32");
  const editor = scriptOpeningCommand(file, "code", "win32", () => "C:\\VS Code\\Code.exe");
  expect(notepad).toEqual({ command: ["notepad.exe", file], environment: {} });
  expect(editor).toEqual({ command: ["C:\\VS Code\\Code.exe", file], environment: {} });
  for (const { command } of [notepad, editor]) expect(command.slice(0, -1).some((part) => /cmd(\.exe)?$|\.bat$/i.test(part))).toBe(false);
  for (const batch of ["C:\\VS Code\\bin\\code.cmd", "C:\\tools\\editor.bat", "C:\\tools\\EDIT.CMD"]) {
    expect(() => scriptOpeningCommand(file, "code", "win32", () => batch)).toThrow("runs through cmd.exe");
  }
});

test("a file looks like text when its start has no zero byte, as nearly every other kind of file has one there", async () => {
  const fileOf = async (name: string, content: string | Uint8Array) => {
    await writeFile(join(directory, name), content);
    return join(directory, name);
  };
  expect(await looksLikeText(await fileOf("beads.jsonl", '{"id":1,"title":"Grüße"}\n'))).toBe(true);
  expect(await looksLikeText(await fileOf("empty.log", ""))).toBe(true);
  expect(await looksLikeText(await fileOf("photo.raw", new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08])))).toBe(false);
  expect(await looksLikeText(await fileOf("long.log", `${"x".repeat(9000)}\0`))).toBe(true);
});
