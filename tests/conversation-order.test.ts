import { describe, expect, test } from "bun:test";
import { CUSTOM_ORDER, customOrderAfterDrag, inConversationOrder, isConversationOrder, landingBeforeInCustomOrder, usualDirection, type ConversationOrder } from "../shared/conversation-order.ts";
import { UNTITLED, type Conversation } from "../shared/model.ts";
import { conversationsIn, numberedConversation, turnTimesOf } from "../web/navigation.ts";

type Listed = Pick<Conversation, "id" | "title" | "titleSetByUser" | "favourite" | "lastMessageAt" | "lastReplyAt" | "position" | "createdAt">;

const listed = (id: string, details: Partial<Listed> = {}): Listed => ({ id, title: id, titleSetByUser: false, position: 0, createdAt: 0, ...details });
const idsIn = (order: ConversationOrder, ...conversations: Listed[]) => conversations.sort(inConversationOrder(order)).map(({ id }) => id);

describe("conversation order", () => {
  const chatted = [
    listed("old", { createdAt: 1, lastMessageAt: 50, lastReplyAt: 10, title: "banana" }),
    listed("middle", { createdAt: 2, lastMessageAt: 20, lastReplyAt: 60, title: "Apple" }),
    listed("new", { createdAt: 3, lastMessageAt: 30, lastReplyAt: 40, title: "cherry" }),
  ];

  test("each order puts the latest first by default", () => {
    expect(idsIn({ by: "activity", direction: "descending" }, ...chatted)).toEqual(["middle", "old", "new"]);
    expect(idsIn({ by: "message", direction: "descending" }, ...chatted)).toEqual(["old", "new", "middle"]);
    expect(idsIn({ by: "reply", direction: "descending" }, ...chatted)).toEqual(["middle", "new", "old"]);
    expect(idsIn({ by: "created", direction: "descending" }, ...chatted)).toEqual(["new", "middle", "old"]);
  });

  test("the other direction turns the order round", () => {
    expect(idsIn({ by: "activity", direction: "ascending" }, ...chatted)).toEqual(["new", "old", "middle"]);
    expect(idsIn({ by: "created", direction: "ascending" }, ...chatted)).toEqual(["old", "middle", "new"]);
  });

  test("titles go by the letter, whatever their case, and numbers by their value", () => {
    expect(idsIn({ by: "title", direction: "ascending" }, ...chatted)).toEqual(["middle", "old", "new"]);
    expect(idsIn({ by: "title", direction: "descending" }, ...chatted)).toEqual(["new", "old", "middle"]);
    expect(idsIn({ by: "title", direction: "ascending" }, listed("a", { title: "part 10" }), listed("b", { title: "part 9" }))).toEqual(["b", "a"]);
  });

  test("untitled conversations come last by title, either way round, and one the user called that does not", () => {
    const rows = [listed("untitled", { title: UNTITLED }), listed("named", { title: "Apple" }), listed("called-so", { title: UNTITLED, titleSetByUser: true })];
    expect(idsIn({ by: "title", direction: "ascending" }, ...rows)).toEqual(["named", "called-so", "untitled"]);
    expect(idsIn({ by: "title", direction: "descending" }, ...rows).at(-1)).toBe("untitled");
  });

  test("a conversation with no messages yet counts from when it was made", () => {
    const fresh = listed("fresh", { createdAt: 100 });
    const quiet = listed("quiet", { createdAt: 1, lastMessageAt: 5, lastReplyAt: 6 });
    for (const by of ["activity", "message", "reply"] as const) expect(idsIn({ by, direction: "descending" }, quiet, fresh)).toEqual(["fresh", "quiet"]);
  });

  test("favourites stay first in every order and direction, ordered among themselves", () => {
    const favourite = (id: string, createdAt: number) => listed(id, { createdAt, favourite: true, position: createdAt });
    const conversations = [listed("plain-old", { createdAt: 1, position: 1 }), favourite("star-old", 2), listed("plain-new", { createdAt: 3, position: 3 }), favourite("star-new", 4)];
    expect(idsIn({ by: "created", direction: "descending" }, ...conversations)).toEqual(["star-new", "star-old", "plain-new", "plain-old"]);
    expect(idsIn({ by: "created", direction: "ascending" }, ...conversations)).toEqual(["star-old", "star-new", "plain-old", "plain-new"]);
    expect(idsIn(CUSTOM_ORDER, ...conversations)).toEqual(["star-old", "star-new", "plain-old", "plain-new"]);
  });

  test("conversations an order cannot tell apart stay where the user put them, either way round", () => {
    const tied = [listed("second", { position: 2 }), listed("first", { position: 1 })];
    expect(idsIn({ by: "created", direction: "descending" }, ...tied)).toEqual(["first", "second"]);
    expect(idsIn({ by: "created", direction: "ascending" }, ...tied)).toEqual(["first", "second"]);
  });

  test("the custom order ignores the direction", () => {
    const placed = [listed("second", { position: 2 }), listed("first", { position: 1 })];
    expect(idsIn({ by: "custom", direction: "descending" }, ...placed)).toEqual(["first", "second"]);
  });

  test("dates start newest first, and titles and the custom order from the top", () => {
    expect(["activity", "message", "reply", "created"].map((by) => usualDirection(by as ConversationOrder["by"]))).toEqual(Array(4).fill("descending"));
    expect(usualDirection("title")).toBe("ascending");
    expect(usualDirection("custom")).toBe("ascending");
  });

  test("tells a saved order from anything else", () => {
    expect(isConversationOrder({ by: "reply", direction: "ascending" })).toBe(true);
    expect(isConversationOrder({ by: "mood", direction: "ascending" })).toBe(false);
    expect(isConversationOrder({ by: "reply", direction: "sideways" })).toBe(false);
    expect(isConversationOrder(null)).toBe(false);
  });
});

describe("dragging around favourites", () => {
  const rows = [
    { id: "star-1", favourite: true },
    { id: "star-2", favourite: true },
    { id: "a" },
    { id: "b" },
  ];

  test("a drop among its own kind lands where it was dropped", () => {
    expect(landingBeforeInCustomOrder(rows, "star-2", "star-1")).toBe("star-1");
    expect(landingBeforeInCustomOrder(rows, "b", "a")).toBe("a");
    expect(landingBeforeInCustomOrder(rows, "a", null)).toBeNull();
  });

  test("another conversation dropped among the favourites lands right below them", () => {
    expect(landingBeforeInCustomOrder(rows, "b", "star-1")).toBe("a");
    expect(landingBeforeInCustomOrder(rows, "a", "star-2")).toBe("a");
  });

  test("a favourite dropped among the others lands last among the favourites", () => {
    expect(landingBeforeInCustomOrder(rows, "star-1", "b")).toBe("a");
    expect(landingBeforeInCustomOrder(rows, "star-1", null)).toBe("a");
  });

  test("with only favourites, the end of the list is still a place", () => {
    expect(landingBeforeInCustomOrder(rows.slice(0, 2), "star-1", null)).toBeNull();
  });

  test("the border is below the tasks listed under a favourite", () => {
    const startedBy = { conversationId: "star-2", plugin: "delegate", reply: null, dismissed: false };
    const withTask = [rows[0]!, rows[1]!, { id: "task", startedBy }, rows[2]!, rows[3]!];
    expect(landingBeforeInCustomOrder(withTask, "b", "star-1")).toBe("a");
    expect(landingBeforeInCustomOrder(withTask, "b", "task")).toBe("a");
    expect(landingBeforeInCustomOrder(withTask, "star-1", "b")).toBe("a");
  });
});

describe("what a drag in the custom order does to positions", () => {
  const inPositionOrder = (...ids: string[]) => ids.map((id) => ({ id, favourite: id === id.toUpperCase() ? true : undefined }));

  test("a favourite keeps its place among the others, for when its star comes off", () => {
    expect(customOrderAfterDrag(inPositionOrder("a", "b", "c", "D"), "a", "c")).toEqual(["b", "a", "c", "D"]);
  });

  test("favourites reorder among the places they hold", () => {
    expect(customOrderAfterDrag(inPositionOrder("A", "x", "B", "y"), "B", "A")).toEqual(["B", "x", "A", "y"]);
  });

  test("a favourite dropped on the border goes last among the favourites, even when an earlier position is held by another", () => {
    expect(customOrderAfterDrag(inPositionOrder("x", "A", "B", "y"), "A", "x")).toEqual(["x", "B", "A", "y"]);
  });

  test("another conversation dropped before a favourite goes first among the others", () => {
    expect(customOrderAfterDrag(inPositionOrder("A", "x", "y"), "y", "A")).toEqual(["A", "y", "x"]);
    expect(customOrderAfterDrag(inPositionOrder("A", "x", "y"), "x", "A")).toEqual(["A", "x", "y"]);
  });

  test("the end of the list is the end of the conversation's own kind", () => {
    expect(customOrderAfterDrag(inPositionOrder("a", "b", "C"), "a", null)).toEqual(["b", "a", "C"]);
  });

  test("something that isn't among them changes nothing", () => {
    expect(customOrderAfterDrag(inPositionOrder("a", "b"), "gone", "a")).toEqual(["a", "b"]);
    expect(customOrderAfterDrag(inPositionOrder("a", "b"), "b", "gone")).toEqual(["b", "a"]);
  });
});

describe("the sidebar's list", () => {
  const conversation = (id: string, details: Partial<Conversation>) => ({ id, workspaceId: "w", title: id, position: 0, createdAt: 0, updatedAt: 0, ...details }) as Conversation;
  const conversations = [
    conversation("caller", { createdAt: 1, position: 2 }),
    conversation("task", { createdAt: 2, position: 0, startedBy: { conversationId: "caller", plugin: "delegate", reply: null, dismissed: false } }),
    conversation("recent", { createdAt: 3, position: 1 }),
    conversation("star", { createdAt: 0, position: 3, favourite: true }),
  ];

  test("follows the chosen order, a started conversation staying under its caller, and the shortcuts go with it", () => {
    const state = { workspaces: [], conversations, selectedConversationId: null, conversationOrder: { by: "created", direction: "descending" } as const };
    expect(conversationsIn(state, "w").map(({ id }) => id)).toEqual(["star", "recent", "caller", "task"]);
    expect(conversationsIn({ ...state, conversationOrder: { by: "created", direction: "ascending" } }, "w").map(({ id }) => id)).toEqual(["star", "caller", "task", "recent"]);
    expect(numberedConversation({ ...state, workspaces: [{ id: "w" } as never] }, 2)).toBe("recent");
  });

  test("sorts by the times held while the pointer is over it, and still takes a new star", () => {
    const earlier = conversation("earlier", { lastMessageAt: 10 });
    const later = conversation("later", { lastMessageAt: 20 });
    const state = { conversations: [earlier, later], conversationOrder: { by: "message", direction: "descending" } as const, heldTurnTimes: turnTimesOf([earlier, later]) };
    const earlierWritesAgain = { ...earlier, lastMessageAt: 30 };
    const idsOf = (changed: Parameters<typeof conversationsIn>[0]) => conversationsIn(changed, "w").map(({ id }) => id);
    expect(idsOf({ ...state, conversations: [earlierWritesAgain, later] })).toEqual(["later", "earlier"]);
    expect(idsOf({ ...state, conversations: [{ ...earlierWritesAgain, favourite: true }, later] })).toEqual(["earlier", "later"]);
    expect(idsOf({ ...state, conversations: [earlierWritesAgain, later], heldTurnTimes: null })).toEqual(["earlier", "later"]);
    expect(conversationsIn({ ...state, conversations: [earlierWritesAgain, later] }, "w")[1]).toBe(earlierWritesAgain);
  });

  test("keeps the custom order when none was chosen", () => {
    expect(conversationsIn({ conversations }, "w").map(({ id }) => id)).toEqual(["star", "recent", "caller", "task"]);
  });
});
