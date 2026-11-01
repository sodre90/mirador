import { describe, expect, test } from "bun:test";
import { MIRADOR_VERSION } from "../shared/version.ts";
import {
  closeWhatHasFocusScript,
  conversationRoute,
  desktopUpdate,
  giveNonceScript,
  pageMayRun,
  pageRequest,
  showMenuScript,
  showRouteScript,
  showUpdateScript,
  windowMenu,
} from "../desktop/src/core/window-menu.ts";

const state = { status: "owned", hostRunsInBackground: true, openAtLogin: false, newerVersion: null, updatesItself: false, update: null, waiting: [] } as const;

describe("menu in the window", () => {
  test("is the tray's menu without Open", () => {
    const labels = windowMenu(state).map((item) => (item.type === "normal" ? item.label : "—"));
    expect(labels).toEqual([
      "Host: running, started by this app",
      `Mirador ${MIRADOR_VERSION}`,
      "—",
      "Restart host",
      "Run host in the background",
      "Open at login",
      "—",
      "Quit",
    ]);
    expect(windowMenu(state).find((item) => item.type === "normal" && item.action === "toggle-background")).toMatchObject({ checked: true });
  });

  test("leaves out the conversations waiting for you, which the sidebar beside it shows", () => {
    const waiting = [{ conversationId: "c1", title: "Fix the tray menu", workspace: "mirador", tone: "decision" }] as const;
    expect(windowMenu({ ...state, waiting: [...waiting] })).toEqual(windowMenu(state));
  });

  test("has the tray's newer release, which the Linux sidebar's menu then offers too", () => {
    const newerVersion = { kind: "release", version: "9.9.9", url: "https://github.com/sodre90/mirador/releases/tag/v9.9.9" } as const;
    expect(windowMenu({ ...state, newerVersion })[2]).toMatchObject({ label: "Mirador 9.9.9 is out: download", action: "download-newer-version" });
    expect(pageRequest({ type: "desktop-action", nonce: "n-1", action: "download-newer-version" }, "n-1")).toEqual({ type: "action", action: "download-newer-version" });
  });

  test("reaches the page as an event carrying the nonce and the items", () => {
    const script = showMenuScript({ nonce: "n-1", items: [{ type: "normal", label: 'Say "hi" </script>' }] });
    expect(script).toBe(
      'window.dispatchEvent(new CustomEvent("mirador:desktop-menu", { detail: {"nonce":"n-1","items":[{"type":"normal","label":"Say \\"hi\\" </script>"}]} }))',
    );
  });

  test("tells the page how far the app is with updating itself", () => {
    expect(showUpdateScript({ stage: "ready", version: "0.4.1" })).toBe('window.dispatchEvent(new CustomEvent("mirador:desktop-update", { detail: {"stage":"ready","version":"0.4.1"} }))');
  });

  test("tells the page what a build that updates itself has in hand, and that any other build leaves updating to the user", () => {
    const build = { version: "0.4.1", hash: "abc" };
    expect(desktopUpdate(false, null)).toEqual({ stage: "manual" });
    expect(desktopUpdate(true, null)).toEqual({ stage: "idle" });
    expect(desktopUpdate(true, { ...build, stage: "downloading" })).toEqual({ stage: "downloading", version: "0.4.1" });
    expect(desktopUpdate(true, { ...build, stage: "ready" })).toEqual({ stage: "ready", version: "0.4.1" });
    expect(desktopUpdate(true, { ...build, stage: "blocked", blockedBy: "Mirador could not install it" })).toEqual({ stage: "blocked", version: "0.4.1", blockedBy: "Mirador could not install it" });
  });

  test("acts only on an action that carries the nonce, while anyone may ask for the menu", () => {
    expect(pageRequest({ type: "desktop-menu-request" }, "n-1")).toEqual({ type: "menu" });
    expect(pageRequest({ type: "desktop-action", nonce: "n-1", action: "quit" }, "n-1")).toEqual({ type: "action", action: "quit" });
    expect(pageRequest({ type: "desktop-action", nonce: "n-1", action: "install-update" }, "n-1")).toEqual({ type: "action", action: "install-update" });
    expect(pageRequest({ type: "desktop-action", nonce: "n-1", action: "check-for-update" }, "n-1")).toEqual({ type: "action", action: "check-for-update" });
    expect(pageRequest({ type: "desktop-action", nonce: "guess", action: "quit" }, "n-1")).toBeNull();
    expect(pageRequest({ type: "desktop-action", action: "quit" }, "n-1")).toBeNull();
    expect(pageRequest({ type: "desktop-action", nonce: "n-1", action: "rm -rf" }, "n-1")).toBeNull();
    expect(pageRequest("quit", "n-1")).toBeNull();
    expect(pageRequest(null, "n-1")).toBeNull();
  });

  test("runs any tray action the page asks for where the window shows the menu, and elsewhere only the update banner's", () => {
    expect(pageMayRun("quit", true)).toBe(true);
    expect(pageMayRun("install-update", true)).toBe(true);
    expect(pageMayRun("install-update", false)).toBe(true);
    expect(pageMayRun("check-for-update", false)).toBe(true);
    for (const action of ["quit", "restart-host", "toggle-background", "toggle-open-at-login", "open", "download-newer-version"] as const) {
      expect(pageMayRun(action, false)).toBe(false);
    }
  });

  test("anyone may ask for the nonce, which the app gives only to its window's own page", () => {
    expect(pageRequest({ type: "desktop-nonce-request" }, "n-1")).toEqual({ type: "nonce" });
    expect(giveNonceScript("n-1")).toBe('window.dispatchEvent(new CustomEvent("mirador:desktop-nonce", { detail: "n-1" }))');
  });

  test("asks the page to close what has focus, and closes the window only when the page asks with the nonce", () => {
    expect(closeWhatHasFocusScript).toBe('window.dispatchEvent(new CustomEvent("mirador:desktop-close"))');
    expect(pageRequest({ type: "desktop-close-window", nonce: "n-1" }, "n-1")).toEqual({ type: "close-window" });
    expect(pageRequest({ type: "desktop-close-window", nonce: "guess" }, "n-1")).toBeNull();
    expect(pageRequest({ type: "desktop-close-window" }, "n-1")).toBeNull();
  });

  test("opens an item in a window of its own, and names that window, only when asked with the nonce", () => {
    const opening = { type: "desktop-open-item-window", nonce: "n-1", conversationId: "c-1", itemId: "i-1", title: "Review" };
    expect(pageRequest(opening, "n-1")).toEqual({ type: "open-item-window", route: { conversationId: "c-1", itemId: "i-1" }, title: "Review" });
    expect(pageRequest({ ...opening, title: undefined }, "n-1")).toBeNull();
    expect(pageRequest({ ...opening, nonce: "guess" }, "n-1")).toBeNull();
    expect(pageRequest({ ...opening, itemId: "" }, "n-1")).toBeNull();
    expect(pageRequest({ ...opening, conversationId: 7 }, "n-1")).toBeNull();
    expect(pageRequest({ type: "desktop-window-title", nonce: "n-1", title: "Mirador: Review" }, "n-1")).toEqual({ type: "window-title", title: "Mirador: Review" });
    expect(pageRequest({ type: "desktop-window-title", nonce: "guess", title: "Mirador: Review" }, "n-1")).toBeNull();
    expect(pageRequest({ type: "desktop-window-title", nonce: "n-1" }, "n-1")).toBeNull();
  });

  test("opens a plugin's own window only when asked with the nonce, for a plugin's name", () => {
    expect(pageRequest({ type: "desktop-open-plugin-window", nonce: "n-1", plugin: "mirador-pet" }, "n-1")).toEqual({ type: "open-plugin-window", plugin: "mirador-pet" });
    expect(pageRequest({ type: "desktop-open-plugin-window", nonce: "guess", plugin: "mirador-pet" }, "n-1")).toBeNull();
    for (const plugin of ["../etc", "Pet", "", 7]) expect(pageRequest({ type: "desktop-open-plugin-window", nonce: "n-1", plugin }, "n-1")).toBeNull();
  });

  test("opens a link only when the request carries the nonce and the link is a web address", () => {
    const link = { type: "desktop-open-link", nonce: "n-1", url: "https://example.com/a" };
    expect(pageRequest(link, "n-1")).toEqual({ type: "open-link", url: "https://example.com/a" });
    expect(pageRequest({ ...link, nonce: "guess" }, "n-1")).toBeNull();
    expect(pageRequest({ type: "desktop-open-link", url: link.url }, "n-1")).toBeNull();
    for (const url of ["file:///etc/passwd", "slack://open", "javascript:alert(1)", "not a url", 7, null]) {
      expect(pageRequest({ ...link, url }, "n-1")).toBeNull();
    }
  });

  test("gives the window the theme only when the page asks with the nonce, and only a theme Mirador has", () => {
    for (const appearance of ["light", "dark", "system"] as const) {
      expect(pageRequest({ type: "desktop-appearance", nonce: "n-1", appearance }, "n-1")).toEqual({ type: "appearance", appearance });
    }
    expect(pageRequest({ type: "desktop-appearance", nonce: "guess", appearance: "dark" }, "n-1")).toBeNull();
    expect(pageRequest({ type: "desktop-appearance", appearance: "dark" }, "n-1")).toBeNull();
    for (const appearance of ["sepia", "", null, 1]) {
      expect(pageRequest({ type: "desktop-appearance", nonce: "n-1", appearance }, "n-1")).toBeNull();
    }
  });

  test("takes Mirador's language only from the page with the nonce, and only a language Mirador has", () => {
    expect(pageRequest({ type: "desktop-language", nonce: "n-1", language: "hu" }, "n-1")).toEqual({ type: "language", language: "hu" });
    expect(pageRequest({ type: "desktop-language", nonce: "guess", language: "es" }, "n-1")).toBeNull();
    expect(pageRequest({ type: "desktop-language", language: "es" }, "n-1")).toBeNull();
    expect(pageRequest({ type: "desktop-language", nonce: "n-1", language: "de" }, "n-1")).toBeNull();
  });
});

describe("opening a conversation from the tray", () => {
  test("goes to the page's address for it", () => {
    expect(conversationRoute("c-1")).toBe("#/c/c-1");
    expect(conversationRoute("a/b#c")).toBe("#/c/a%2Fb%23c");
  });

  test("moves an open window's page there", () => {
    expect(showRouteScript("#/c/c-1")).toBe('window.location.hash = "#/c/c-1"');
  });
});
