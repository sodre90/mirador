import { describe, expect, test } from "bun:test";
import type { Conversation, StoredEvent } from "../shared/model.ts";
import {
  answerForMainChat,
  askedOutsideQuotes,
  conversationAsText,
  isSideChatBrief,
  quoted,
  sideChatBrief,
  sideChatIsReadOnly,
  sideChatModeOf,
  sideChatQuestionIn,
} from "../shared/side-chats.ts";
import { adjacentConversation, conversationsIn, numberedConversation, showsInSidebar } from "../web/navigation.ts";
import { commandFor, type KeyPress } from "../web/shortcuts.ts";
import { askInSideChat, closeSideChat, firstMessage, selectingBeside, showSideChat, sideChatShownBeside as shownBeside, toggleSideChat } from "../web/side-chats.ts";
import { initialState, reducer, selectedOpen, type AppState } from "../web/state.ts";

const userSaid = (seq: number, text: string): StoredEvent => ({ seq, at: seq, event: { type: "user-message", text } });
const agentSaid = (seq: number, text: string): StoredEvent => ({
  seq,
  at: seq,
  event: { type: "acp", update: { sessionUpdate: "agent_message_chunk", messageId: `m${seq}`, content: { type: "text", text } } },
});

describe("/btw", () => {
  test("asks what follows it, and a bare /btw asks nothing yet", () => {
    expect(sideChatQuestionIn("/btw why does the build retry?")).toBe("why does the build retry?");
    expect(sideChatQuestionIn("  /btw  what about\nthe second line?  ")).toBe("what about\nthe second line?");
    expect(sideChatQuestionIn("/btw")).toBe("");
    expect(sideChatQuestionIn("/btwx no")).toBeNull();
    expect(sideChatQuestionIn("so /btw is here")).toBeNull();
  });
});

describe("the side chat's first message", () => {
  test("quotes each selection line by line, the question after them, and is titled by the question", () => {
    const message = firstMessage(["first line\n\nthird line", "another"], "  what does this mean? ");
    expect(message).toBe("> first line\n>\n> third line\n\n> another\n\nwhat does this mean?");
    expect(askedOutsideQuotes(message)).toBe("what does this mean?");
    expect(askedOutsideQuotes(quoted("only a quote"))).toBe("> only a quote");
  });

  test("goes to the main chat as a quote, with a line the agent reads to know where it came from", () => {
    expect(answerForMainChat("It retries\ntwice.")).toBe("From a side chat:\n\n> It retries\n> twice.\n\n");
  });
});

describe("what a side chat's agent hears first", () => {
  test("a copied session needs no conversation, a new one gets it as text, and the fake agent can tell the brief apart", () => {
    const copy = sideChatBrief(null);
    expect(copy).toContain("copy of the main conversation");
    expect(copy).not.toContain("<conversation>");
    const handedOver = sideChatBrief("User: hi");
    expect(handedOver).toContain("<conversation>\nUser: hi\n</conversation>");
    expect(isSideChatBrief(copy) && isSideChatBrief(handedOver)).toBe(true);
    expect(isSideChatBrief("SAY hello")).toBe(false);
  });

  test("the conversation as text keeps the newest messages when it is too long", () => {
    const events = [userSaid(1, "first question"), agentSaid(2, "first answer"), userSaid(3, "second question"), agentSaid(4, "second answer")];
    expect(conversationAsText(events)).toBe("User: first question\n\nAssistant: first answer\n\nUser: second question\n\nAssistant: second answer");
    expect(conversationAsText(events, 50)).toBe("(earlier messages left out)\n\nUser: second question\n\nAssistant: second answer");
  });
});

describe("read-only", () => {
  test("is a mode of each agent that has one, and is promised only where the agent enforces it", () => {
    expect([sideChatModeOf("claude"), sideChatModeOf("codex"), sideChatModeOf("antigravity"), sideChatModeOf("opencode"), sideChatModeOf("pi")]).toEqual([
      "plan",
      "read-only",
      "plan",
      "plan",
      null,
    ]);
    expect(sideChatIsReadOnly("claude")).toBe(true);
    expect(sideChatIsReadOnly("opencode")).toBe(false);
    expect(sideChatIsReadOnly("pi")).toBe(false);
  });
});

describe("the sidebar", () => {
  const conversation = (id: string, details: Partial<Conversation> = {}) => ({ id, workspaceId: "w", title: id, position: 0, createdAt: 0, updatedAt: 0, ...details }) as Conversation;
  const conversations = [conversation("main", { position: 0 }), conversation("other", { position: 1 }), conversation("aside", { position: 2, sideChatOf: "main" })];
  const state = { workspaces: [{ id: "w" }] as AppState["workspaces"], conversations, selectedConversationId: "main" };

  test("lists a side chat under its conversation, folded until opened", () => {
    expect(conversationsIn(state, "w").map(({ id }) => id)).toEqual(["main", "aside", "other"]);
    expect(showsInSidebar(conversations[2]!, conversations, new Set())).toBe(false);
    expect(showsInSidebar(conversations[2]!, conversations, new Set(["main"]))).toBe(true);
  });

  test("leaves side chats out of the conversations ⌥↑↓ and ⌥1–9 go to", () => {
    expect(adjacentConversation(state, 1)).toBe("other");
    expect(adjacentConversation({ ...state, selectedConversationId: "other" }, 1)).toBe("main");
    expect(numberedConversation(state, 2)).toBe("other");
  });
});

describe("the page", () => {
  const history = (conversationId: string) => ({ type: "conversation.history" as const, conversationId, events: [userSaid(1, "hello")], canvas: [] });

  test("keeps the history of the side chats it shows, and brings it along when one is opened as a conversation", () => {
    let state = reducer(initialState, { type: "select", conversationId: "main" });
    state = reducer(state, { type: "keep-side-chats", conversationIds: ["aside"] });
    expect(reducer(state, { type: "keep-side-chats", conversationIds: ["aside"] })).toBe(state);
    state = reducer(state, { type: "server", message: history("aside") });
    expect(state.sideChats).toMatchObject([{ conversationId: "aside", loaded: true }]);
    state = reducer(state, { type: "select", conversationId: "aside" });
    expect(selectedOpen(state)).toMatchObject({ conversationId: "aside", loaded: true, events: [userSaid(1, "hello")] });
  });

  test("selecting a side chat, from anywhere, shows it beside its conversation", () => {
    const conversations = [{ id: "main" }, { id: "aside", sideChatOf: "main" }] as Conversation[];
    expect(selectingBeside({ type: "select", conversationId: "aside" }, conversations)).toEqual({ type: "select", conversationId: "main" });
    expect(shownBeside("main")).toEqual({ sideChatId: "aside" });
    expect(selectingBeside({ type: "select", conversationId: "main" }, conversations)).toEqual({ type: "select", conversationId: "main" });
    closeSideChat("main");
  });

  test("the toggle opens a new side chat or puts the column away, and selected text goes in as a quote", () => {
    toggleSideChat("main");
    expect(shownBeside("main")).toEqual({ draft: true, quotes: [] });
    toggleSideChat("main", "some text");
    toggleSideChat("main", "more text");
    expect(shownBeside("main")).toEqual({ draft: true, quotes: ["some text", "more text"] });
    toggleSideChat("main");
    expect(shownBeside("main")).toBeUndefined();
    showSideChat("main", "aside");
    askInSideChat("main");
    expect(shownBeside("main"), "asking again with no text starts another side chat").toEqual({ draft: true, quotes: [] });
    closeSideChat("main");
  });
});

describe("⌥B", () => {
  const press = (code: string, modifiers: Partial<KeyPress> = {}): KeyPress => ({ key: "", code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers });

  test("opens the side chat, except in a terminal, where shells take it to go back a word", () => {
    expect(commandFor(press("KeyB", { altKey: true }), "typing", true)).toEqual({ type: "side-chat" });
    expect(commandFor(press("KeyB", { altKey: true }), "terminal", true)).toBeNull();
    expect(commandFor(press("KeyB", { altKey: true, shiftKey: true }), "typing", true)).toBeNull();
  });
});
