import { describe, expect, test } from "bun:test";
import { desktopWords } from "../desktop/src/core/desktop-words.ts";
import { navigationRules, webUrl } from "../desktop/src/core/navigation.ts";
import { MIRADOR_VERSION } from "../shared/version.ts";
import { clickedTrayItem, menuLabel, nativeTrayMenu, restartDetail, trayMenu, type TrayItem, type TrayState } from "../desktop/src/core/tray-menu.ts";
import type { WaitingConversation, WaitingTone } from "../shared/waiting.ts";

const state: TrayState = { status: "owned", hostRunsInBackground: false, openAtLogin: true, newerVersion: null, updatesItself: false, update: null, waiting: [] };

const waitingConversation = (index: number, tone: WaitingTone = "decision"): WaitingConversation => ({
  conversationId: `c${index}`,
  title: `Conversation ${index}`,
  workspace: "mirador",
  tone,
});
const release = { kind: "release", version: "9.9.9", url: "https://github.com/sodre90/mirador/releases/tag/v9.9.9" } as const;
const item = (items: TrayItem[], label: string) => items.find((candidate) => candidate.type === "normal" && candidate.label.startsWith(label));

describe("tray menu", () => {
  test("lists the actions in order with the checkboxes reflecting the settings", () => {
    const items = trayMenu(state);
    expect(items.map((entry) => (entry.type === "normal" ? entry.label : "-"))).toEqual([
      "Host: running, started by this app",
      `Mirador ${MIRADOR_VERSION}`,
      "Open",
      "-",
      "Restart host",
      "Run host in the background",
      "Open at login",
      "-",
      "Quit",
    ]);
    expect(item(items, "Run host in the background")).toMatchObject({ checked: false, action: "toggle-background" });
    expect(item(items, "Open at login")).toMatchObject({ checked: true, action: "toggle-open-at-login" });
  });

  test("shows the status line and the version as information, not actions", () => {
    expect(trayMenu(state)[0]).toMatchObject({ enabled: false });
    expect((trayMenu(state)[0] as { action?: string }).action).toBeUndefined();
    expect(trayMenu(state)[1]).toMatchObject({ label: `Mirador ${MIRADOR_VERSION}`, enabled: false });
  });

  test("disables and explains restarting a host the app did not start", () => {
    expect(item(trayMenu({ ...state, status: "external" }), "Restart host")).toMatchObject({ label: "Restart host (not started by this app)", enabled: false });
  });

  test("enables restarting for owned, background and stopped hosts", () => {
    for (const status of ["owned", "background", "stopped"] as const) {
      expect(item(trayMenu({ ...state, status }), "Restart host")).toMatchObject({ label: "Restart host", enabled: true });
    }
  });

  test("offers a newer release's download page under the version, and tells new commits on a checkout's upstream", () => {
    const withRelease = trayMenu({ ...state, newerVersion: release });
    expect(withRelease[2]).toEqual({ type: "normal", label: "Mirador 9.9.9 is out: download", action: "download-newer-version" });
    const withCommits = trayMenu({ ...state, newerVersion: { kind: "checkout", commits: 1, upstream: "origin/main", upstreamCommit: "abc" } });
    expect(withCommits[2]).toEqual({ type: "normal", label: "1 new commit on origin/main", enabled: false });
    expect(trayMenu(state)[2]).toMatchObject({ label: "Open" });
  });

  test("an app that updates itself downloads a newer release when asked, rather than opening its download page", () => {
    expect(trayMenu({ ...state, updatesItself: true, newerVersion: release })[2]).toEqual({ type: "normal", label: "Mirador 9.9.9 is out: download", action: "check-for-update" });
  });

  test("an update the app is downloading is told in place of the release's download page", () => {
    const update = { version: "9.9.9", hash: "abc", stage: "downloading" } as const;
    expect(trayMenu({ ...state, updatesItself: true, newerVersion: release, update }).slice(2, 4)).toEqual([
      { type: "normal", label: "Downloading Mirador 9.9.9...", enabled: false },
      { type: "normal", label: "Open", action: "open" },
    ]);
  });

  test("an update the app downloaded offers a restart into it, in place of the release's download page", () => {
    const update = { version: "9.9.9", hash: "abc", stage: "ready" } as const;
    expect(trayMenu({ ...state, updatesItself: true, newerVersion: release, update }).slice(2, 4)).toEqual([
      { type: "normal", label: "Restart to update to Mirador 9.9.9", action: "install-update" },
      { type: "normal", label: "Open", action: "open" },
    ]);
  });

  test("an update the app cannot install where it is says what to do instead, above the release's download page", () => {
    const update = { version: "9.9.9", hash: "abc", stage: "blocked", blockedBy: "move Mirador to Applications to update it" } as const;
    expect(trayMenu({ ...state, updatesItself: true, update })[2]).toEqual({ type: "normal", label: "Mirador 9.9.9 is out: move Mirador to Applications to update it", enabled: false });
    expect(trayMenu({ ...state, updatesItself: true, newerVersion: release, update })[3]).toEqual({ type: "normal", label: "Mirador 9.9.9 is out: download", action: "download-newer-version" });
  });

  test("an app update and new commits on the host's checkout are both told", () => {
    const update = { version: "9.9.9", hash: "abc", stage: "ready" } as const;
    const labels = trayMenu({ ...state, update, newerVersion: { kind: "checkout", commits: 2, upstream: "origin/main", upstreamCommit: "abc" } }).map((entry) =>
      entry.type === "normal" ? entry.label : "-",
    );
    expect(labels.slice(2, 4)).toEqual(["Restart to update to Mirador 9.9.9", "2 new commits on origin/main"]);
  });

  test("shows the background checkbox ticked when the setting is on", () => {
    expect(item(trayMenu({ ...state, hostRunsInBackground: true }), "Run host in the background")).toMatchObject({ checked: true });
  });

  test("speaks the language the page told the app", () => {
    const labelsIn = (language: TrayState["language"]) =>
      trayMenu({ ...state, language, waiting: [waitingConversation(1)] }).flatMap((entry) => (entry.type === "normal" ? [entry.label] : []));
    expect(labelsIn("hu")).toEqual(expect.arrayContaining(["Rád várnak", "Rád vár: Conversation 1 · mirador", "Host: fut, ez az alkalmazás indította", "Megnyitás", "Kilépés"]));
    expect(labelsIn("es")).toEqual(expect.arrayContaining(["Esperándote: Conversation 1 · mirador", "Reiniciar el host", "Abrir al iniciar sesión", "Salir"]));
    expect(restartDetail("Mirador", 2, desktopWords("es"))).toBe("Mirador se cierra y se vuelve a abrir. Se detendrán 2 turnos en curso.");
  });

  test("explains the restart and names running turns that will stop", () => {
    expect(restartDetail("Mirador", 0)).toBe("Mirador closes and opens again.");
    expect(restartDetail("Mirador", 1)).toBe("Mirador closes and opens again. 1 running turn will stop.");
    expect(restartDetail("Mirador", 2)).toBe("Mirador closes and opens again. 2 running turns will stop.");
  });
});

describe("conversations waiting for you in the tray menu", () => {
  const labels = (items: TrayItem[]) => items.map((item) => (item.type === "normal" ? item.label : "—"));

  test("are not listed while none waits", () => {
    expect(labels(trayMenu(state))).not.toContain("Waiting for you");
  });

  test("lead the menu, each opening its conversation and saying why it waits", () => {
    const items = trayMenu({ ...state, waiting: [waitingConversation(1), waitingConversation(2, "failed"), waitingConversation(3, "done")] });
    expect(labels(items).slice(0, 5)).toEqual([
      "Waiting for you",
      "Needs you: Conversation 1 · mirador",
      "Failed: Conversation 2 · mirador",
      "Done: Conversation 3 · mirador",
      "—",
    ]);
    expect(items[0]).toMatchObject({ enabled: false });
    expect(items[1]).toEqual({ type: "normal", label: "Needs you: Conversation 1 · mirador", action: "open-conversation", data: { conversationId: "c1" } });
    expect(labels(items)[5]).toBe("Host: running, started by this app");
  });

  test("show the first ten, and Open for the rest", () => {
    const items = trayMenu({ ...state, waiting: Array.from({ length: 12 }, (_, index) => waitingConversation(index + 1)) });
    expect(items.filter((item) => item.type === "normal" && item.action === "open-conversation")).toHaveLength(10);
    expect(items[11]).toEqual({ type: "normal", label: "2 more…", action: "open" });
  });

  test("leave out the workspace when it has no name", () => {
    expect(labels(trayMenu({ ...state, waiting: [{ ...waitingConversation(1, "unread"), workspace: "" }] }))[1]).toBe("Unread: Conversation 1");
  });
});

describe("a click on a waiting conversation in the tray", () => {
  test("carries the conversation's id in the native menu item's action, which Electrobun keeps across clicks", () => {
    const items = nativeTrayMenu(trayMenu({ ...state, waiting: [waitingConversation(7)] }));
    expect(items[1]).toEqual({ type: "normal", label: "Needs you: Conversation 7 · mirador", action: "open-conversation:c7" });
    expect(items.every((item) => !("data" in item))).toBe(true);
  });

  test("comes back as Open conversation with that id, and every other action as it was", () => {
    expect(clickedTrayItem("open-conversation:c7")).toEqual({ action: "open-conversation", conversationId: "c7" });
    expect(clickedTrayItem("quit")).toEqual({ action: "quit" });
  });

  test("is ignored without an id, as is anything that is no tray action", () => {
    expect(clickedTrayItem("open-conversation:")).toBeNull();
    expect(clickedTrayItem("open-conversation")).toBeNull();
    expect(clickedTrayItem("format-disk")).toBeNull();
    expect(clickedTrayItem(undefined)).toBeNull();
  });
});

describe("a tray menu label made from a title", () => {
  test("keeps no quote, backslash or bracket, which the Linux tray's menu parser can't read", () => {
    expect(menuLabel('Fix "the" {tray} [menu] C:\\path', "linux")).toBe("Fix 'the' (tray) (menu) C:'path");
  });

  test("is one line, cut short with an ellipsis", () => {
    expect(menuLabel("  Fix\nthe   tray  ", "darwin")).toBe("Fix the tray");
    const long = menuLabel("A".repeat(80), "darwin");
    expect(long).toHaveLength(48);
    expect(long.endsWith("…")).toBe(true);
  });

  test("is cut between characters, never inside an emoji", () => {
    const label = menuLabel(`${"A".repeat(46)}🔴 and more`, "darwin");
    expect(label).toBe(`${"A".repeat(46)}🔴…`);
  });

  test("doubles & on Windows, where a single one marks a shortcut key", () => {
    expect(menuLabel("Tom & Jerry", "win32")).toBe("Tom && Jerry");
    expect(menuLabel("Tom & Jerry", "linux")).toBe("Tom & Jerry");
  });
});

describe("navigation", () => {
  test("blocks everything but the app's own origins and inline documents", () => {
    expect(navigationRules(["http://127.0.0.1:4600", "http://127.0.0.1:4601"])).toEqual(["^*", "http://127.0.0.1:4600/*", "http://127.0.0.1:4601/*", "about:*"]);
  });

  test("tells web links from everything else the page might ask the browser to open", () => {
    expect(webUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(webUrl("http://example.com/")).toBe("http://example.com/");
    for (const url of ["file:///etc/passwd", "slack://open", "javascript:alert(1)", "not a url", undefined, null]) {
      expect(webUrl(url)).toBeNull();
    }
  });
});
