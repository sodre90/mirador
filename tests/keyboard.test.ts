import { NO_SANDBOX } from "../shared/sandbox.ts";
import { describe, expect, test } from "bun:test";
import type { Conversation, Workspace } from "../shared/model.ts";
import {
  adjacentConversation,
  adjacentWorkspaceConversation,
  apartFromMore,
  apartFromOlder,
  conversationsIn,
  currentWorkspace,
  deletableAround,
  nextWaitingConversation,
  numberedConversation,
  rowsTopToBottom,
  stillDeletable,
  type NavigationState,
} from "../web/navigation.ts";
import { matchesQuery } from "../web/Palette.tsx";
import { commandFor, dictates, findsInCanvasPage, findsTemplate, repeatsWhenHeld, shortcutKeys, type KeyPress } from "../web/shortcuts.ts";
import { terminalKeyAction } from "../web/terminal-keys.ts";

const press = (code: string, modifiers: Partial<KeyPress> = {}, key = ""): KeyPress => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("commandFor", () => {
  test("uses Cmd on macOS and Ctrl elsewhere for the palette and the canvas", () => {
    expect(commandFor(press("KeyK", { metaKey: true }), "typing", true)).toEqual({ type: "palette" });
    expect(commandFor(press("KeyK", { ctrlKey: true }), "typing", true)).toBeNull();
    expect(commandFor(press("KeyK", { ctrlKey: true }), "typing", false)).toEqual({ type: "palette" });
    expect(commandFor(press("Backslash", { metaKey: true }), "typing", true)).toEqual({ type: "toggle-canvas" });
  });

  test("Cmd+Shift+S (Ctrl+Shift+S elsewhere) toggles the sidebar, while typing and in a terminal too; plain Cmd+S does not", () => {
    expect(commandFor(press("KeyS", { metaKey: true, shiftKey: true }), "typing", true)).toEqual({ type: "toggle-sidebar" });
    expect(commandFor(press("KeyS", { metaKey: true, shiftKey: true }), "terminal", true)).toEqual({ type: "toggle-sidebar" });
    expect(commandFor(press("KeyS", { ctrlKey: true, shiftKey: true }), "terminal", false)).toEqual({ type: "toggle-sidebar" });
    expect(commandFor(press("KeyS", { metaKey: true }), "not-typing", true)).toBeNull();
  });

  test("Option bindings match the physical key, so the character Option types (∆, ¡, †) does not matter", () => {
    expect(commandFor(press("ArrowDown", { altKey: true }), "typing", true)).toEqual({ type: "adjacent-conversation", step: 1 });
    expect(commandFor(press("ArrowUp", { altKey: true, shiftKey: true }), "typing", true)).toEqual({ type: "adjacent-workspace", step: -1 });
    expect(commandFor(press("Digit3", { altKey: true }, "£"), "typing", true)).toEqual({ type: "numbered-conversation", number: 3 });
    expect(commandFor(press("KeyT", { altKey: true }, "†"), "typing", true)).toEqual({ type: "new-conversation" });
    expect(commandFor(press("KeyT", { altKey: true, shiftKey: true }, "ˇ"), "typing", true)).toEqual({ type: "new-workspace" });
    expect(commandFor(press("Digit0", { altKey: true }), "typing", true)).toBeNull();
    expect(commandFor(press("KeyT", { altKey: true, metaKey: true }), "typing", true)).toBeNull();
  });

  test("moving focus between panes leaves Cmd+Shift+arrows to text selection while the user is typing", () => {
    const focusCanvas = press("ArrowRight", { metaKey: true, shiftKey: true });
    expect(commandFor(focusCanvas, "empty-field", true)).toEqual({ type: "focus", pane: "canvas" });
    expect(commandFor(focusCanvas, "not-typing", true)).toEqual({ type: "focus", pane: "canvas" });
    expect(commandFor(focusCanvas, "typing", true)).toBeNull();
  });

  test("Cmd+Shift+Y goes to the next conversation waiting for you, also from a message being written or a terminal", () => {
    const nextWaiting = { type: "next-waiting" } as const;
    expect(commandFor(press("KeyY", { metaKey: true, shiftKey: true }), "typing", true)).toEqual(nextWaiting);
    expect(commandFor(press("KeyY", { metaKey: true, shiftKey: true }), "terminal", true)).toEqual(nextWaiting);
    expect(commandFor(press("KeyY", { ctrlKey: true, shiftKey: true }), "not-typing", false)).toEqual(nextWaiting);
    expect(commandFor(press("KeyY", { metaKey: true }), "not-typing", true)).toBeNull();
    expect(shortcutKeys(true).nextWaiting).toBe("⌘⇧Y");
  });

  test("Cmd+Shift+U marks the open conversation unread, except in a Linux terminal, where Ctrl+Shift+U enters a Unicode character", () => {
    const markUnread = { type: "mark-unread" } as const;
    expect(commandFor(press("KeyU", { metaKey: true, shiftKey: true }), "typing", true)).toEqual(markUnread);
    expect(commandFor(press("KeyU", { metaKey: true, shiftKey: true }), "terminal", true)).toEqual(markUnread);
    expect(commandFor(press("KeyU", { ctrlKey: true, shiftKey: true }), "not-typing", false)).toEqual(markUnread);
    expect(commandFor(press("KeyU", { ctrlKey: true, shiftKey: true }), "terminal", false)).toBeNull();
    expect(commandFor(press("KeyU", { metaKey: true }), "not-typing", true)).toBeNull();
    expect(shortcutKeys(true).markUnread).toBe("⌘⇧U");
  });

  test("Ctrl+` shows and hides the terminal on every system, and Cmd+Shift+Down focuses it", () => {
    const toggleTerminal = press("Backquote", { ctrlKey: true });
    expect(commandFor(toggleTerminal, "typing", true)).toEqual({ type: "toggle-terminal" });
    expect(commandFor(toggleTerminal, "terminal", false)).toEqual({ type: "toggle-terminal" });
    expect(commandFor(press("Backquote", { metaKey: true }), "not-typing", true)).toBeNull();
    expect(commandFor(press("ArrowDown", { metaKey: true, shiftKey: true }), "empty-field", true)).toEqual({ type: "focus", pane: "terminals" });
    expect(commandFor(press("ArrowDown", { ctrlKey: true, shiftKey: true }), "typing", false)).toBeNull();
    expect(shortcutKeys(true).toggleTerminal).toBe("⌃`");
    expect(shortcutKeys(false).focusTerminal).toBe("Ctrl+Shift+↓");
  });

  test("on macOS a terminal keeps ⌘K for itself, but focus can still move out of it", () => {
    expect(commandFor(press("KeyK", { metaKey: true }), "terminal", true)).toBeNull();
    expect(commandFor(press("KeyK", { ctrlKey: true }), "terminal", false)).toEqual({ type: "palette" });
    expect(commandFor(press("ArrowLeft", { metaKey: true, shiftKey: true }), "terminal", true)).toEqual({ type: "focus", pane: "chat" });
  });

  test("Cmd+R reloads the page and Cmd+Shift+R restarts the host, but a Linux terminal keeps Ctrl+R for its history search", () => {
    expect(commandFor(press("KeyR", { metaKey: true }), "typing", true)).toEqual({ type: "reload-page" });
    expect(commandFor(press("KeyR", { metaKey: true, shiftKey: true }), "terminal", true)).toEqual({ type: "restart-host" });
    expect(commandFor(press("KeyR", { ctrlKey: true }), "not-typing", false)).toEqual({ type: "reload-page" });
    expect(commandFor(press("KeyR", { ctrlKey: true }), "terminal", false)).toBeNull();
    expect(commandFor(press("KeyR", { ctrlKey: true, shiftKey: true }), "terminal", false)).toBeNull();
    expect(commandFor(press("KeyR", { metaKey: true, altKey: true }), "not-typing", true)).toBeNull();
  });

  test("Cmd+F finds in the conversation, also while typing, but a terminal keeps Ctrl+F for moving the cursor", () => {
    expect(commandFor(press("KeyF", { metaKey: true }), "typing", true)).toEqual({ type: "find" });
    expect(commandFor(press("KeyF", { ctrlKey: true }), "not-typing", false)).toEqual({ type: "find" });
    expect(commandFor(press("KeyF", { ctrlKey: true }), "terminal", false)).toBeNull();
  });

  test("Cmd+Shift+F searches every workspace, from anywhere but a Linux terminal, which finds in itself with Ctrl+Shift+F", () => {
    expect(commandFor(press("KeyF", { metaKey: true, shiftKey: true }), "typing", true)).toEqual({ type: "search" });
    expect(commandFor(press("KeyF", { metaKey: true, shiftKey: true }), "terminal", true)).toEqual({ type: "search" });
    expect(commandFor(press("KeyF", { ctrlKey: true, shiftKey: true }), "typing", false)).toEqual({ type: "search" });
    expect(commandFor(press("KeyF", { ctrlKey: true, shiftKey: true }), "terminal", false)).toBeNull();
  });

  test("? opens the help only outside text fields", () => {
    const questionMark = press("Slash", { shiftKey: true }, "?");
    expect(commandFor(questionMark, "not-typing", true)).toEqual({ type: "help" });
    expect(commandFor(questionMark, "empty-field", true)).toBeNull();
    expect(commandFor(questionMark, "typing", true)).toBeNull();
  });

  test("Cmd/Ctrl + and - step font size, 0 resets", () => {
    expect(commandFor(press("Equal", { metaKey: true }), "typing", true)).toEqual({ type: "bigger-font" });
    expect(commandFor(press("NumpadAdd", { metaKey: true }), "typing", true)).toEqual({ type: "bigger-font" });
    expect(commandFor(press("Minus", { metaKey: true }), "typing", true)).toEqual({ type: "smaller-font" });
    expect(commandFor(press("NumpadSubtract", { metaKey: true }), "typing", true)).toEqual({ type: "smaller-font" });
    expect(commandFor(press("Digit0", { metaKey: true }), "typing", true)).toEqual({ type: "reset-font" });
    expect(commandFor(press("Numpad0", { metaKey: true }), "typing", true)).toEqual({ type: "reset-font" });

    expect(commandFor(press("Equal", { ctrlKey: true }), "terminal", false)).toEqual({ type: "bigger-font" });
    expect(commandFor(press("Minus", { ctrlKey: true }), "terminal", false)).toEqual({ type: "smaller-font" });
    expect(commandFor(press("Digit0", { ctrlKey: true }), "terminal", false)).toEqual({ type: "reset-font" });

    // Ctrl+Shift+Minus (Ctrl+_) is readline undo in bash/zsh; font-shrink must not intercept it
    expect(commandFor(press("Minus", { ctrlKey: true, shiftKey: true }), "terminal", false)).toBeNull();
    expect(commandFor(press("Minus", { metaKey: true, shiftKey: true }), "terminal", true)).toBeNull();
  });
});

describe("repeatsWhenHeld", () => {
  const held = (code: string, modifiers: Partial<KeyPress>, mac = true) => repeatsWhenHeld(commandFor(press(code, modifiers), "not-typing", mac)!);

  test("keys that step, through conversations, workspaces, your messages and the text size, keep running while held", () => {
    expect(held("ArrowDown", { altKey: true })).toBe(true);
    expect(held("ArrowUp", { altKey: true, shiftKey: true })).toBe(true);
    expect(held("ArrowUp", { metaKey: true })).toBe(true);
    expect(held("Equal", { metaKey: true })).toBe(true);
    expect(held("Minus", { metaKey: true })).toBe(true);
  });

  test("keys that create, open, toggle, restart or reset run once for a press", () => {
    expect(held("KeyT", { altKey: true })).toBe(false);
    expect(held("KeyT", { altKey: true, shiftKey: true })).toBe(false);
    expect(held("KeyR", { metaKey: true, shiftKey: true })).toBe(false);
    expect(held("KeyR", { metaKey: true })).toBe(false);
    expect(held("KeyK", { metaKey: true })).toBe(false);
    expect(held("KeyS", { metaKey: true, shiftKey: true })).toBe(false);
    expect(held("Backslash", { metaKey: true })).toBe(false);
    expect(held("Digit2", { altKey: true })).toBe(false);
    expect(held("KeyY", { metaKey: true, shiftKey: true })).toBe(false);
    expect(held("Digit0", { metaKey: true })).toBe(false);
  });
});

describe("findsTemplate", () => {
  test("is ⌘J on macOS and Ctrl+J elsewhere, with no other modifier", () => {
    expect(findsTemplate(press("KeyJ", { metaKey: true }), true)).toBe(true);
    expect(findsTemplate(press("KeyJ", { ctrlKey: true }), false)).toBe(true);
    expect(findsTemplate(press("KeyJ", { ctrlKey: true }), true)).toBe(false);
    expect(findsTemplate(press("KeyJ", { metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(findsTemplate(press("KeyJ", {}), true)).toBe(false);
  });
});

describe("dictates", () => {
  test("is ⌘⇧Space on macOS and Ctrl+Shift+Space elsewhere, which no command takes", () => {
    expect(dictates(press("Space", { metaKey: true, shiftKey: true }), true)).toBe(true);
    expect(dictates(press("Space", { ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(dictates(press("Space", { ctrlKey: true, shiftKey: true }), true)).toBe(false);
    expect(dictates(press("Space", { metaKey: true }), true)).toBe(false);
    expect(dictates(press("Space", { metaKey: true, shiftKey: true, altKey: true }), true)).toBe(false);
    expect(commandFor(press("Space", { metaKey: true, shiftKey: true }), "typing", true)).toBeNull();
    expect(commandFor(press("Space", { ctrlKey: true, shiftKey: true }), "not-typing", false)).toBeNull();
    expect(shortcutKeys(true).dictate).toBe("⌘⇧Space");
    expect(shortcutKeys(false).dictate).toBe("Ctrl+Shift+Space");
  });
});

describe("shortcutKeys", () => {
  test("the keys a button's hint shows are written for the platform", () => {
    expect(shortcutKeys(true)).toMatchObject({ newWorkspace: "⌥⇧T", newConversation: "⌥T", toggleCanvas: "⌘\\", sendTheOtherWay: "⌥Enter", templates: "⌘J" });
    expect(shortcutKeys(false)).toMatchObject({ newWorkspace: "Alt+Shift+T", newConversation: "Alt+T", toggleCanvas: "Ctrl+\\", sendTheOtherWay: "Alt+Enter", templates: "Ctrl+J" });
  });
});

describe("terminalKeyAction", () => {
  test("gives Cmd and Option the meaning they have in a macOS terminal", () => {
    expect(terminalKeyAction(press("KeyK", { metaKey: true }), true)).toEqual({ type: "clear" });
    expect(terminalKeyAction(press("ArrowLeft", { metaKey: true }), true)).toEqual({ type: "send", data: "\x01" });
    expect(terminalKeyAction(press("ArrowRight", { metaKey: true }), true)).toEqual({ type: "send", data: "\x05" });
    expect(terminalKeyAction(press("Backspace", { metaKey: true }), true)).toEqual({ type: "send", data: "\x15" });
    expect(terminalKeyAction(press("ArrowLeft", { altKey: true }), true)).toEqual({ type: "send", data: "\x1bb" });
    expect(terminalKeyAction(press("ArrowRight", { altKey: true }), true)).toEqual({ type: "send", data: "\x1bf" });
  });

  test("takes the pane keys cmux and iTerm2 share on macOS", () => {
    const paneCommand = (code: string, modifiers: Partial<KeyPress>) => {
      const action = terminalKeyAction(press(code, modifiers), true);
      return action?.type === "pane" ? action.command : action;
    };
    const command = { metaKey: true };
    expect(paneCommand("KeyD", command)).toEqual({ type: "split", axis: "columns" });
    expect(paneCommand("KeyD", { ...command, shiftKey: true })).toEqual({ type: "split", axis: "rows" });
    expect(paneCommand("KeyT", command)).toEqual({ type: "new-tab" });
    expect(paneCommand("KeyW", command)).toEqual({ type: "close" });
    expect(paneCommand("ArrowUp", { ...command, altKey: true })).toEqual({ type: "focus-toward", direction: "up" });
    expect(paneCommand("ArrowLeft", { ...command, altKey: true })).toEqual({ type: "focus-toward", direction: "left" });
    expect(paneCommand("BracketLeft", command)).toEqual({ type: "focus-step", step: -1 });
    expect(paneCommand("BracketRight", command)).toEqual({ type: "focus-step", step: 1 });
    expect(paneCommand("BracketLeft", { ...command, shiftKey: true })).toEqual({ type: "tab-step", step: -1 });
    expect(paneCommand("BracketRight", { ...command, shiftKey: true })).toEqual({ type: "tab-step", step: 1 });
    expect(paneCommand("Digit3", command)).toEqual({ type: "tab-number", number: 3 });
    expect(paneCommand("Digit3", { ctrlKey: true })).toEqual({ type: "tab-number", number: 3 });
    expect(paneCommand("Enter", { ...command, shiftKey: true })).toEqual({ type: "zoom" });
  });

  test("leaves the pane keys to the shell elsewhere, and keeps the page's own ⌘⇧← and ⌘⇧→", () => {
    expect(terminalKeyAction(press("KeyD", { metaKey: true }), false)).toBeNull();
    expect(terminalKeyAction(press("Digit3", { ctrlKey: true }), false)).toBeNull();
    expect(terminalKeyAction(press("Digit3", { ctrlKey: true, metaKey: true }), true)).toBeNull();
    expect(terminalKeyAction(press("Digit0", { metaKey: true }), true)).toBeNull();
    expect(terminalKeyAction(press("ArrowRight", { metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(terminalKeyAction(press("KeyD", { ctrlKey: true }), true)).toBeNull();
  });

  test("finds with ⌘F on macOS and Ctrl+Shift+F elsewhere, leaving Ctrl+F to the shell", () => {
    expect(terminalKeyAction(press("KeyF", { metaKey: true }), true)).toEqual({ type: "find" });
    expect(terminalKeyAction(press("KeyF", { ctrlKey: true, shiftKey: true }), false)).toEqual({ type: "find" });
    expect(terminalKeyAction(press("KeyF", { ctrlKey: true }), false)).toBeNull();
    expect(terminalKeyAction(press("KeyF", { ctrlKey: true }), true)).toBeNull();
  });

  test("elsewhere, copies with Ctrl+Shift+C and leaves Ctrl+Shift+V to the browser's paste, as in a Linux terminal", () => {
    expect(terminalKeyAction(press("KeyC", { ctrlKey: true, shiftKey: true }), false)).toEqual({ type: "copy" });
    expect(terminalKeyAction(press("KeyV", { ctrlKey: true, shiftKey: true }), false)).toEqual({ type: "browser-paste" });
  });

  test("leaves every other key to xterm.js", () => {
    expect(terminalKeyAction(press("KeyK", { metaKey: true }), false)).toBeNull();
    expect(terminalKeyAction(press("KeyK", { ctrlKey: true }), false)).toBeNull();
    expect(terminalKeyAction(press("KeyC", { ctrlKey: true }), false)).toBeNull();
    expect(terminalKeyAction(press("KeyV", { ctrlKey: true }), false)).toBeNull();
    expect(terminalKeyAction(press("KeyK", { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(terminalKeyAction(press("KeyC", { ctrlKey: true, shiftKey: true }), true)).toBeNull();
    expect(terminalKeyAction(press("KeyC", { metaKey: true }), true)).toBeNull();
    expect(terminalKeyAction(press("ArrowLeft", { metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(terminalKeyAction(press("Backspace", { altKey: true }), true)).toBeNull();
    expect(terminalKeyAction(press("ArrowUp", { altKey: true }), true)).toBeNull();
  });
});

const workspace = (id: string): Workspace => ({ id, name: id, path: `/p/${id}`, defaultLaunch: { harness: "claude", profileId: null }, color: null, position: 0, groupId: null, newConversationsIn: "folder", worktreeSetup: "", sandbox: NO_SANDBOX, sideChatAccess: null, createdAt: 0 });

const conversation = (id: string, workspaceId: string, createdAt: number, position = 0): Conversation => ({
  id,
  workspaceId,
  harness: "claude",
  profileId: null,
  title: id,
  titleSetByUser: false,
  acpSessionId: null,
  askMode: "wait",
  bypassPermissions: false,
  status: "idle",
  statusDetail: null,
  openInTerminal: null,
    contextUsage: null,
    queuedMessages: [],
    usageLimit: null,
    jobWaits: [],
    asyncTasks: [],
    waitingFor: null,
    pendingRequest: null,
    lastWords: null,
    activity: null,
  configOptions: [],
  position,
  createdAt,
  updatedAt: createdAt,
});

describe("navigation", () => {
  const base: NavigationState = {
    workspaces: [workspace("a"), workspace("empty"), workspace("b")],
    conversations: [conversation("a-old", "a", 1), conversation("a-new", "a", 2), conversation("b-only", "b", 3)],
    selectedConversationId: null,
  };
  const selecting = (selectedConversationId: string | null) => ({ ...base, selectedConversationId });

  test("lists a workspace's conversations oldest first, like the sidebar", () => {
    expect(conversationsIn(base, "a").map(({ id }) => id)).toEqual(["a-old", "a-new"]);
  });

  test("steps through conversations in sidebar order and wraps around", () => {
    expect(adjacentConversation(selecting("a-old"), 1)).toBe("a-new");
    expect(adjacentConversation(selecting("a-new"), 1)).toBe("b-only");
    expect(adjacentConversation(selecting("b-only"), 1)).toBe("a-old");
    expect(adjacentConversation(selecting("a-old"), -1)).toBe("b-only");
    expect(adjacentConversation(selecting(null), -1)).toBe("b-only");
  });

  test("steps through workspaces, skipping empty ones, and lands on the newest conversation", () => {
    expect(adjacentWorkspaceConversation(selecting("a-old"), 1)).toBe("b-only");
    expect(adjacentWorkspaceConversation(selecting("b-only"), 1)).toBe("a-new");
    expect(adjacentWorkspaceConversation(selecting("b-only"), -1)).toBe("a-new");
  });

  test("numbers conversations within the current workspace, the first workspace when nothing is selected", () => {
    expect(currentWorkspace(selecting(null))?.id).toBe("a");
    expect(numberedConversation(selecting(null), 2)).toBe("a-new");
    expect(numberedConversation(selecting("b-only"), 1)).toBe("b-only");
    expect(numberedConversation(selecting("b-only"), 2)).toBeNull();
  });

  test("lists the conversations where the user put them, and the shortcuts follow; another workspace still opens on its newest", () => {
    const reordered = { ...base, conversations: [conversation("a-old", "a", 1, 1), conversation("a-new", "a", 2, 0), conversation("b-only", "b", 3)] };
    expect(conversationsIn(reordered, "a").map(({ id }) => id)).toEqual(["a-new", "a-old"]);
    expect(numberedConversation(reordered, 1)).toBe("a-new");
    expect(adjacentConversation({ ...reordered, selectedConversationId: "a-new" }, 1)).toBe("a-old");
    expect(adjacentWorkspaceConversation({ ...reordered, selectedConversationId: "b-only" }, 1)).toBe("a-new");
  });

  test("lists a conversation a plugin's tool started right under its caller, and leaves it out once its task is dismissed", () => {
    const startedBy = (dismissed: boolean) => ({ conversationId: "a-old", plugin: "delegate", reply: null, dismissed });
    const delegated = (id: string, dismissed: boolean) => ({ ...conversation(id, "a", 4, 4), startedBy: startedBy(dismissed) });
    const withDelegated = { ...base, conversations: [...base.conversations, delegated("a-task", false), delegated("a-done", true)] };
    expect(conversationsIn(withDelegated, "a").map(({ id }) => id)).toEqual(["a-old", "a-task", "a-new"]);
  });

  test("goes to the conversation that most needs the user, then on to the next one waiting, and round again", () => {
    const waitingFor = (id: string, waits: Conversation["waitingFor"]) => ({ ...base.conversations.find((each) => each.id === id)!, waitingFor: waits });
    const waiting = { ...base, conversations: [waitingFor("a-old", "finished"), waitingFor("a-new", null), waitingFor("b-only", "question")] };
    const from = (selectedConversationId: string | null) => nextWaitingConversation({ ...waiting, selectedConversationId });
    expect(from("a-new")).toBe("b-only");
    expect(from(null)).toBe("b-only");
    expect(from("b-only")).toBe("a-old");
    expect(from("a-old")).toBe("b-only");
  });

  test("stays where it is when nothing else waits for the user", () => {
    const onlyOpenOneWaits = { ...base, conversations: base.conversations.map((each) => ({ ...each, waitingFor: each.id === "a-new" ? ("permission" as const) : null })) };
    expect(nextWaitingConversation(selecting("a-new"))).toBeNull();
    expect(nextWaitingConversation({ ...onlyOpenOneWaits, selectedConversationId: "a-new" })).toBeNull();
    expect(nextWaitingConversation({ ...onlyOpenOneWaits, selectedConversationId: "a-old" })).toBe("a-new");
  });

  describe("conversations nobody touched for as long as the setting says", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = 100 * DAY;
    const madeDaysAgo = (id: string, days: number, more: Partial<Conversation> = {}) => ({ ...conversation(id, "a", now - days * DAY), ...more });
    const idsOf = ({ current, older }: ReturnType<typeof apartFromOlder>) => ({ current: current.map(({ id }) => id), older: older.map(({ id }) => id) });

    test("fold under Older, counted from the last message or reply, else from when they were made", () => {
      const listed = [madeDaysAgo("stale", 30), madeDaysAgo("fresh", 2), madeDaysAgo("written-in", 30, { lastMessageAt: now - DAY }), madeDaysAgo("answered", 30, { lastReplyAt: now - 6 * DAY })];
      expect(idsOf(apartFromOlder(listed, now, "1-week"))).toEqual({ current: ["fresh", "written-in", "answered"], older: ["stale"] });
    });

    test("fold after as long as the setting says, and not at all when it is off", () => {
      const listed = [madeDaysAgo("two-days", 2), madeDaysAgo("ten-days", 10), madeDaysAgo("twenty-days", 20), madeDaysAgo("forty-days", 40)];
      expect(idsOf(apartFromOlder(listed, now, "1-day")).older).toEqual(["two-days", "ten-days", "twenty-days", "forty-days"]);
      expect(idsOf(apartFromOlder(listed, now, "3-days")).older).toEqual(["ten-days", "twenty-days", "forty-days"]);
      expect(idsOf(apartFromOlder(listed, now, "2-weeks")).older).toEqual(["twenty-days", "forty-days"]);
      expect(idsOf(apartFromOlder(listed, now, "1-month")).older).toEqual(["forty-days"]);
      expect(idsOf(apartFromOlder(listed, now, "off"))).toEqual({ current: ["two-days", "ten-days", "twenty-days", "forty-days"], older: [] });
    });

    test("stay in the list while there is something to come back to them for", () => {
      const listed = [
        madeDaysAgo("favourite", 30, { favourite: true }),
        madeDaysAgo("waiting", 30, { waitingFor: "finished" }),
        madeDaysAgo("working", 30, { status: "running" }),
        madeDaysAgo("reminded", 30, { reminder: { at: now + DAY, mode: "keep" } }),
        madeDaysAgo("in-terminal", 30, { openInTerminal: "idle" }),
        madeDaysAgo("stale", 30),
      ];
      expect(idsOf(apartFromOlder(listed, now, "1-week")).older).toEqual(["stale"]);
    });

    test("keep the tasks listed under them, and stay in the list while one of those is in use", () => {
      const under = (id: string, callerId: string, more: Partial<Conversation> = {}) => madeDaysAgo(id, 30, { startedBy: { conversationId: callerId, plugin: "delegate", reply: null, dismissed: false }, ...more });
      const listed = [madeDaysAgo("resting", 30), under("resting-task", "resting"), madeDaysAgo("delegating", 30), under("busy-task", "delegating", { status: "running" })];
      expect(idsOf(apartFromOlder(listed, now, "1-week"))).toEqual({ current: ["delegating", "busy-task"], older: ["resting", "resting-task"] });
    });

    test("are stepped past and not numbered, as the sidebar doesn't list them", () => {
      const folding: NavigationState = { ...base, now, conversations: [madeDaysAgo("stale", 30), madeDaysAgo("fresh", 1), madeDaysAgo("fresher", 0)] };
      expect(adjacentConversation({ ...folding, selectedConversationId: "fresh" }, 1)).toBe("fresher");
      expect(adjacentConversation({ ...folding, selectedConversationId: "fresher" }, 1)).toBe("fresh");
      expect(numberedConversation({ ...folding, selectedConversationId: "fresh" }, 1)).toBe("fresh");
      expect(adjacentConversation({ ...folding, now: undefined, selectedConversationId: "fresher" }, 1)).toBe("stale");
    });
  });

  describe("conversations past as many as the setting lists", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = 100 * DAY;
    const activeDaysAgo = (id: string, days: number, more: Partial<Conversation> = {}) => ({ ...conversation(id, "a", now - days * DAY), ...more });
    const idsOf = ({ listed, more }: ReturnType<typeof apartFromMore>) => ({ listed: listed.map(({ id }) => id), more: more.map(({ id }) => id) });

    test("fold under More, the least recently active first, while the list keeps its own order", () => {
      const current = [
        activeDaysAgo("three", 3),
        activeDaysAgo("zero", 0),
        activeDaysAgo("six", 6),
        activeDaysAgo("written-in", 6, { lastMessageAt: now - DAY / 2 }),
        activeDaysAgo("five", 5),
        activeDaysAgo("answered", 6, { lastReplyAt: now - 2 * DAY }),
        activeDaysAgo("four", 4),
      ];
      expect(idsOf(apartFromMore(current, "5"))).toEqual({ listed: ["three", "zero", "written-in", "answered", "four"], more: ["six", "five"] });
      expect(idsOf(apartFromMore(current, "8"))).toEqual({ listed: current.map(({ id }) => id), more: [] });
      expect(idsOf(apartFromMore(current, "all")).more).toEqual([]);
    });

    test("stay in the list while there is something to come back to them for, and take its places first", () => {
      const holding = [
        activeDaysAgo("favourite", 6, { favourite: true }),
        activeDaysAgo("waiting", 6, { waitingFor: "finished" }),
        activeDaysAgo("working", 6, { status: "running" }),
        activeDaysAgo("reminded", 6, { reminder: { at: now + DAY, mode: "keep" } }),
        activeDaysAgo("waiting-for-a-job", 6, { jobWaits: [{ id: "job", job: { kind: "process", pid: 1 }, sshHost: null, message: "Carry on", resume: true, since: now - DAY }] }),
        activeDaysAgo("in-terminal", 6, { openInTerminal: "idle" }),
      ];
      const current = [...holding, activeDaysAgo("fresh", 0)];
      expect(idsOf(apartFromMore(current, "5"))).toEqual({ listed: holding.map(({ id }) => id), more: ["fresh"] });
      expect(idsOf(apartFromMore(current, "8")).more).toEqual([]);
    });

    test("go with the conversation they are listed under, which is as recent as the latest of them", () => {
      const under = (id: string, callerId: string, more: Partial<Conversation> = {}) => activeDaysAgo(id, 6, { startedBy: { conversationId: callerId, plugin: "delegate", reply: null, dismissed: false }, ...more });
      const current = [
        activeDaysAgo("delegating", 6),
        under("recent-task", "delegating", { lastReplyAt: now }),
        activeDaysAgo("one", 1),
        activeDaysAgo("two", 2),
        activeDaysAgo("three", 3),
        activeDaysAgo("resting", 5),
        under("resting-task", "resting"),
        activeDaysAgo("four", 4),
      ];
      expect(idsOf(apartFromMore(current, "5"))).toEqual({ listed: ["delegating", "recent-task", "one", "two", "three", "four"], more: ["resting", "resting-task"] });
    });

    test("are stepped past and not numbered, as the sidebar doesn't list them", () => {
      const ids = ["zero", "one", "two", "three", "four", "five"];
      const capped: NavigationState = { ...base, now, conversationsShown: "5", conversations: ids.map((id, days) => activeDaysAgo(id, days)) };
      expect(numberedConversation(capped, 1)).toBe("four");
      expect(numberedConversation(capped, 6)).toBeNull();
      expect(adjacentConversation({ ...capped, selectedConversationId: "four" }, -1)).toBe("zero");
      expect(numberedConversation({ ...capped, conversationsShown: "all" }, 1)).toBe("five");
    });
  });

  describe("deleting from a row's menu, as a browser tab's menu closes other tabs or those to its right", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = 100 * DAY;
    const activeDaysAgo = (id: string, days: number, more: Partial<Conversation> = {}) => ({ ...conversation(id, "a", now - days * DAY), ...more });
    const ids = (some: Conversation[]) => some.map(({ id }) => id);
    const rowsOf = (conversations: Conversation[]) => rowsTopToBottom(conversations, now, "1-week", "5");

    test("go through the rows top to bottom, those under More and Older too, and leave out those listed under another", () => {
      const task = activeDaysAgo("task", 0, { startedBy: { conversationId: "one", plugin: "delegate", reply: null, dismissed: false } });
      const listed = [activeDaysAgo("one", 1), task, ...["two", "three", "four", "five"].map((id, days) => activeDaysAgo(id, days + 2))];
      const conversations = [activeDaysAgo("stale", 30), activeDaysAgo("past-five", 6), ...listed];
      const rows = rowsOf(conversations);
      expect(ids(rows)).toEqual(["one", "two", "three", "four", "five", "past-five", "stale"]);
      expect(ids(deletableAround(rows, conversations, "four")!.below.going)).toEqual(["five", "past-five", "stale"]);
      expect(ids(deletableAround(rows, conversations, "four")!.others.going)).toEqual(["one", "two", "three", "five", "past-five", "stale"]);
      expect(deletableAround(rows, conversations, "task")).toBeNull();
    });

    test("leave those working, waiting for you, waiting on a job or in a terminal, as the host does", () => {
      const jobWait = { id: "job", job: { kind: "process" as const, pid: 1 }, sshHost: null, message: "Carry on", resume: true, since: now };
      const conversations = [
        activeDaysAgo("top", 0),
        activeDaysAgo("working", 1, { status: "running" }),
        activeDaysAgo("waiting", 1, { waitingFor: "finished" }),
        activeDaysAgo("on-a-job", 1, { jobWaits: [jobWait] }),
        activeDaysAgo("in-terminal", 1, { openInTerminal: "idle" }),
        activeDaysAgo("resting", 2),
      ];
      const rows = rowsOf(conversations);
      expect(ids(deletableAround(rows, conversations, "top")!.below.going)).toEqual(["resting"]);
      expect(ids(deletableAround(rows, conversations, "resting")!.others.going)).toEqual(["top"]);
      expect(deletableAround(rows, conversations, "resting")!.below).toEqual({ going: [], staying: 0 });
      expect(deletableAround(rows, conversations, "top")!.below.staying).toBe(4);
    });

    test("are taken again as they are now while the prompt asks: one gone is left out, one now busy stays", () => {
      const conversations = [activeDaysAgo("resting", 1), activeDaysAgo("now-working", 1, { status: "running" })];
      const now = stillDeletable(["resting", "now-working", "gone"], 2, conversations);
      expect(ids(now.going)).toEqual(["resting"]);
      expect(now.staying).toBe(3);
    });

    test("leave a resting conversation whose task or side chat is busy, even one listed elsewhere, as deleting it would take them", () => {
      const startedBy = (callerId: string) => ({ startedBy: { conversationId: callerId, plugin: "delegate", reply: null, dismissed: false } });
      const conversations = [
        activeDaysAgo("top", 0),
        activeDaysAgo("delegating", 1),
        activeDaysAgo("task", 1, { ...startedBy("delegating"), status: "running" }),
        activeDaysAgo("asked-about", 2),
        activeDaysAgo("side-chat", 2, { sideChatOf: "asked-about", waitingFor: "finished" }),
        activeDaysAgo("resting", 3),
        activeDaysAgo("resting-task", 3, startedBy("resting")),
      ];
      const nested = { ...conversation("nested", "elsewhere", now), ...startedBy("resting-task"), status: "running" as const };
      expect(ids(deletableAround(rowsOf(conversations), conversations, "top")!.below.going)).toEqual(["resting"]);
      expect(ids(deletableAround(rowsOf(conversations), [...conversations, nested], "top")!.below.going)).toEqual([]);
    });
  });

  test("has nowhere to go without conversations", () => {
    const empty = { workspaces: [workspace("a")], conversations: [], selectedConversationId: null };
    expect(adjacentConversation(empty, 1)).toBeNull();
    expect(adjacentWorkspaceConversation(empty, 1)).toBeNull();
    expect(numberedConversation(empty, 1)).toBeNull();
  });
});

describe("matchesQuery", () => {
  const entry = { label: "Refactor the login flow", detail: "billing-service" };

  test("needs every word somewhere in the label or detail, in any order and any case", () => {
    expect(matchesQuery("", entry)).toBe(true);
    expect(matchesQuery("login", entry)).toBe(true);
    expect(matchesQuery("BILLING refac", entry)).toBe(true);
    expect(matchesQuery("login checkout", entry)).toBe(false);
  });
});

describe("findsInCanvasPage", () => {
  test("takes ⌘F from a canvas frame and from the panel holding a shown page", () => {
    expect(findsInCanvasPage(true, false)).toBe(true);
    expect(findsInCanvasPage(false, true)).toBe(true);
  });

  test("leaves ⌘F to the conversation where the canvas has no page to find on", () => {
    expect(findsInCanvasPage(false, false)).toBe(false);
  });
});
