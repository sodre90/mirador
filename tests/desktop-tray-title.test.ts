import { expect, test } from "bun:test";
import { colourTrayImage, firstTrayTitle, trayDot, trayTitle, waitingBadge } from "../desktop/src/core/tray-menu.ts";

test("the Dock badge shows the number of conversations waiting for you, and nothing when none waits", () => {
  expect(waitingBadge(3)).toBe("3");
  expect(waitingBadge(0)).toBe("");
});

test("the macOS menu bar title puts the waiting dot before the count, and only the count for unread marks", () => {
  expect(trayTitle({ count: 2, mostUrgent: "decision" })).toBe("🔴 2");
  expect(trayTitle({ count: 1, mostUrgent: "failed" })).toBe("🔴 1");
  expect(trayTitle({ count: 3, mostUrgent: "done" })).toBe("🟢 3");
  expect(trayTitle({ count: 1, mostUrgent: "unread" })).toBe("1");
  expect(trayTitle({ count: 0, mostUrgent: null })).toBe("");
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
  expect(colourTrayImage("needs-you", "linux")).toBe("views://assets/tray-icon-needs-you.png");
  expect(colourTrayImage("done", "linux")).toBe("views://assets/tray-icon-done.png");
  expect(colourTrayImage(null, "linux")).toBe("views://assets/app-icon.png");
});

test("Windows gets the tray icons as .ico, the only image its tray loads from a file", () => {
  expect(colourTrayImage("needs-you", "win32")).toBe("views://assets/tray-icon-needs-you.ico");
  expect(colourTrayImage("done", "win32")).toBe("views://assets/tray-icon-done.ico");
  expect(colourTrayImage(null, "win32")).toBe("views://assets/app-icon.ico");
});
