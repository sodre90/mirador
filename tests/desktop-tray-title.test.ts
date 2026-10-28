import { expect, test } from "bun:test";
import { colourTrayImage, firstTrayTitle, trayDot, trayTitle } from "../desktop/src/core/tray-menu.ts";

test("the tray shows the number of conversations waiting for you, and nothing when none waits", () => {
  expect(trayTitle(3)).toBe("3");
  expect(trayTitle(0)).toBe("");
});

test("Linux panels name the tray icon after the app instead of the process running it, while macOS keeps the title for the count", () => {
  expect(firstTrayTitle("linux", "Mirador")).toBe("Mirador");
  expect(firstTrayTitle("darwin", "Mirador")).toBe("");
});

test("the tray dot is red for what needs you, green for done, and none for an unread mark or nothing waiting", () => {
  expect(trayDot("decision")).toBe("needs-you");
  expect(trayDot("failed")).toBe("needs-you");
  expect(trayDot("done")).toBe("done");
  expect(trayDot("unread")).toBeNull();
  expect(trayDot(null)).toBeNull();
});

test("the tray icon carries the dot's colour, and is the plain app icon without a dot", () => {
  expect(colourTrayImage("needs-you")).toBe("views://assets/tray-icon-needs-you.png");
  expect(colourTrayImage("done")).toBe("views://assets/tray-icon-done.png");
  expect(colourTrayImage(null)).toBe("views://assets/app-icon.png");
});
