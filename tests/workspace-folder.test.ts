import { expect, test } from "bun:test";
import { parentFolder, withHomeAsTilde } from "../web/workspace-folder.ts";

const home = "/Users/ada";

test("names the folder holding the workspace, with home as ~", () => {
  expect(parentFolder("/Users/ada/prj/mirador", home)).toBe("~/prj");
  expect(parentFolder("/Users/ada/prj/mirador/", home)).toBe("~/prj");
  expect(parentFolder("/Users/ada/dotfiles", home)).toBe("~");
});

test("leaves folders outside home as they are, even ones whose name starts like it", () => {
  expect(parentFolder("/Users/ada2/src/x", home)).toBe("/Users/ada2/src");
  expect(parentFolder("/Users/ada", home)).toBe("/Users");
  expect(parentFolder("/opt/tools", home)).toBe("/opt");
  expect(parentFolder("/srv", home)).toBe("/");
});

test("shows the full folder until the host has said where home is", () => {
  expect(parentFolder("/Users/ada/prj/mirador", "")).toBe("/Users/ada/prj");
});

test("shows a file under home as ~/..., and any other path as it is", () => {
  expect(withHomeAsTilde("/Users/ada/notes/todo.md", home)).toBe("~/notes/todo.md");
  expect(withHomeAsTilde("/Users/ada2/notes.md", home)).toBe("/Users/ada2/notes.md");
  expect(withHomeAsTilde("/tmp/notes.md", home)).toBe("/tmp/notes.md");
  expect(withHomeAsTilde("src/app.ts", home)).toBe("src/app.ts");
  expect(withHomeAsTilde("/Users/ada/notes/todo.md", "")).toBe("/Users/ada/notes/todo.md");
});

test("on Windows, names the folder holding the workspace with the backslash, and home as ~", () => {
  const windowsHome = "C:\\Users\\ada";
  expect(parentFolder("C:\\Users\\ada\\prj\\mirador", windowsHome)).toBe("~\\prj");
  expect(parentFolder("C:\\Users\\ada\\prj\\mirador\\", windowsHome)).toBe("~\\prj");
  expect(parentFolder("C:\\Users\\ada\\dotfiles", windowsHome)).toBe("~");
  expect(parentFolder("C:\\Users\\ada2\\src\\x", windowsHome)).toBe("C:\\Users\\ada2\\src");
  expect(parentFolder("D:\\work\\shop", windowsHome)).toBe("D:\\work");
  expect(parentFolder("D:\\shop", windowsHome)).toBe("D:\\");
  expect(parentFolder("\\\\server\\share\\shop", windowsHome)).toBe("\\\\server\\share");
});

test("on Windows, shows a file under home as ~\\..., and any other path as it is", () => {
  const windowsHome = "C:\\Users\\ada";
  expect(withHomeAsTilde("C:\\Users\\ada\\notes\\todo.md", windowsHome)).toBe("~\\notes\\todo.md");
  expect(withHomeAsTilde("C:\\Users\\ada", windowsHome)).toBe("~");
  expect(withHomeAsTilde("C:\\Users\\ada2\\notes.md", windowsHome)).toBe("C:\\Users\\ada2\\notes.md");
  expect(withHomeAsTilde("src\\app.ts", windowsHome)).toBe("src\\app.ts");
});
