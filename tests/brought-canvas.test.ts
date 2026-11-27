import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BROUGHT_ASSETS_ORIGIN_TOKEN,
  broughtAskAnswerIn,
  broughtCanvasAskIn,
  broughtCanvasShowIn,
  MOST_BROUGHT_CANVAS_HTML_CHARACTERS,
  replaceAssetsOrigins,
  rewriteAskAssets,
} from "../shared/brought-canvas.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { agentStandIn } from "../shared/rooms.ts";
import { admittedFromPerson, type PersonInRooms } from "../host/person-admission.ts";
import { personView } from "../host/person-view.ts";
import { RoomQuestions } from "../host/room-questions.ts";
import { RoomService, type RoomSessions } from "../host/rooms.ts";
import { Store } from "../host/store.ts";

const unusedSessions: RoomSessions = {
  startInRoom: () => {
    throw new Error("not used");
  },
  send: async () => {},
  deleteWithAllItHolds: () => {},
  waitingPermissions: () => [],
  answerPermission: () => {},
  followRoomPreset: async () => {},
  followRoomAgentModel: async () => {},
  takeQueuedRoomPrompts: () => [],
  startAfreshInRoom: () => {},
};

function makeRoomHost() {
  const dir = mkdtempSync(join(tmpdir(), "brought-canvas-"));
  const store = new Store(join(dir, "state.sqlite"));
  const ownerId = store.ownerId();
  store.setPersonProfile(ownerId, { name: "Ann", color: null });
  const mia = { id: crypto.randomUUID(), name: "Mia", color: null };
  store.insertPerson(mia);
  const ws = store.insertWorkspace({
    id: crypto.randomUUID(),
    name: "proj",
    path: dir,
    defaultLaunch: { harness: "opencode", profileId: null },
    createdAt: 1,
  });
  const sentToRoom: { roomId: string; message: ServerMessage }[] = [];
  const sentToAgents: { personId: string; message: ServerMessage }[] = [];
  let carries = true;
  const hub: any = {
    broadcast: () => {},
    publishToRoom: (roomId: string, message: ServerMessage) => sentToRoom.push({ roomId, message }),
    publishWhere: () => {},
    carriesAgentsOf: (personId: string) => carries && personId === mia.id,
    sendToAgentsOf: (personId: string, message: ServerMessage) => {
      if (!carries || personId !== mia.id) return false;
      sentToAgents.push({ personId, message });
      return true;
    },
  };
  const rooms = new RoomService(
    store,
    hub,
    unusedSessions,
    { notify: () => {}, roomTaskHeld: () => {} },
    dir,
    () => ({}),
    undefined,
    undefined,
    undefined,
    undefined,
    "http://127.0.0.1:4601",
  );
  const room = rooms.create("Garden", ws.id, [], "read-freely");
  rooms.setPersonRole(room.id, mia.id, "member");
  const questions = new RoomQuestions(
    store,
    hub,
    { answer: () => {} },
    undefined,
    (roomId, agentId, itemId, chosen, answers, authorId, answerer) => rooms.deliverBroughtAskAnswer(roomId, agentId, itemId, chosen, answers, authorId, answerer),
  );
  rooms.hearBroughtQuestionsWith((roomId, item) => {
    const found = store.findRoom(roomId);
    if (found) questions.changed(found, item);
  });
  const agentId = rooms.bringAgent(room.id, mia.id, "Coder", "pi");
  const asked = rooms.write(room.id, ownerId, `@Coder (Mia) draw a robot`, [agentId], null);
  const [task] = store.roomBroughtTasksOfAgent(room.id, agentId);
  return { store, rooms, questions, ownerId, mia, room, agentId, asked, task: task!, sentToRoom, sentToAgents, setCarries: (v: boolean) => (carries = v) };
}

describe("brought-canvas validation and asset rewriting", () => {
  test("rewrites bringer origins to placeholder and back to room host origin", () => {
    const html = `<script src="http://127.0.0.1:9901/d3.min.js"></script><script src="https://laptop:9902/mermaid.min.js"></script>`;
    const wire = replaceAssetsOrigins(html, ["http://127.0.0.1:9901", "https://laptop:9902"], BROUGHT_ASSETS_ORIGIN_TOKEN);
    expect(wire).toContain(`${BROUGHT_ASSETS_ORIGIN_TOKEN}/d3.min.js`);
    expect(wire).toContain(`${BROUGHT_ASSETS_ORIGIN_TOKEN}/mermaid.min.js`);
    const onRoom = replaceAssetsOrigins(wire, [BROUGHT_ASSETS_ORIGIN_TOKEN], "http://127.0.0.1:4601");
    expect(onRoom).toBe(`<script src="http://127.0.0.1:4601/d3.min.js"></script><script src="http://127.0.0.1:4601/mermaid.min.js"></script>`);
  });

  test("validates show and ask payloads and rejects oversize or multi-select asks", () => {
    expect(broughtCanvasShowIn({ title: "Robot", html: "<svg/>" })).toEqual({ title: "Robot", html: "<svg/>" });
    expect(broughtCanvasShowIn({ title: " ", html: "<svg/>" })).toBeNull();
    expect(broughtCanvasShowIn({ title: "Big", html: "x".repeat(MOST_BROUGHT_CANVAS_HTML_CHARACTERS + 1) })).toBeNull();

    const single = broughtCanvasAskIn({ question: "Color?", options: [{ label: "Red" }, { label: "Blue" }] });
    expect(single?.title).toBe("Color?");
    expect(single?.allowOther).toBe(true);
    expect(broughtCanvasAskIn({ question: "Color?", multiple: true, options: [{ label: "Red" }, { label: "Blue" }] })).toBeNull();
    expect(broughtCanvasAskIn({ question: "Color?", options: [{ label: "Only one" }] })).toBeNull();

    const rewritten = rewriteAskAssets(
      broughtCanvasAskIn({
        question: "Chart?",
        html: `<script src="http://127.0.0.1:5001/d3.min.js"></script>`,
        options: [{ label: "A", html: `<script src="http://127.0.0.1:5001/mermaid.min.js"></script>` }, { label: "B" }],
      })!,
      ["http://127.0.0.1:5001"],
      BROUGHT_ASSETS_ORIGIN_TOKEN,
    );
    expect(rewritten.html).toContain(BROUGHT_ASSETS_ORIGIN_TOKEN);
    expect(rewritten.options?.[0]?.html).toContain(BROUGHT_ASSETS_ORIGIN_TOKEN);
  });

  test("validates incoming brought ask answers and admission checks", () => {
    expect(
      broughtAskAnswerIn({
        label: "Green",
        answerer: { author: { role: "member", name: "Mia" }, ownWords: [false] },
        followUpTaskId: "task-123",
      }),
    ).toEqual({
      label: "Green",
      answerer: { author: { role: "member", name: "Mia" }, ownWords: [false] },
      followUpTaskId: "task-123",
    });
    expect(broughtAskAnswerIn({ label: "" })).toBeNull();

    const member: PersonInRooms = { roleIn: () => "member", conversationBehind: () => null };
    const guest: PersonInRooms = { roleIn: () => "guest", conversationBehind: () => null };
    const showMsg: ClientMessage = { type: "room.brought-canvas-show", roomId: "r1", agentId: "a1", taskId: "t1", itemId: "i1", title: "Robot", html: "<svg/>" };
    expect(admittedFromPerson(showMsg, member)).toEqual(showMsg);
    expect(() => admittedFromPerson(showMsg, guest)).toThrow();
  });
});

describe("room host brought-agent canvas show, ask, voting, and teardown", () => {
  test("brought agent show appears on room canvas with rewritten assets and is visible through personView", () => {
    const { store, rooms, mia, room, agentId, task, sentToRoom } = makeRoomHost();
    rooms.broughtCanvasShow(mia.id, room.id, agentId, task.id, "page-1", "Friendly robot", `<script src="${BROUGHT_ASSETS_ORIGIN_TOKEN}/d3.min.js"></script><p>hi</p>`);

    const items = rooms.canvas(room.id);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("show");
    expect(items[0]?.conversationId).toBe(agentStandIn(room.id, agentId));
    expect((items[0] as any).html).toContain("http://127.0.0.1:4601/d3.min.js");
    expect(sentToRoom.some(({ message }) => message.type === "canvas.upserted" && message.item.id === "page-1")).toBe(true);

    const view = personView(store);
    const fakeSocket: any = { personId: mia.id, isOwner: false, carriesAgents: false, roomsShown: new Set([room.id]), agentConversationsShown: new Map(), subscriptions: new Set(), lowDataSubscriptions: new Set(), roomSubscriptions: new Set([room.id]), canvasAssetsOrigin: "http://127.0.0.1:4601" };
    const seen = view({ type: "canvas.upserted", item: items[0]! }, fakeSocket);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ type: "canvas.upserted", item: items[0]! });
  });

  test("brought agent ask supports room voting, confirmation, and delivers the answer back to the bringer", () => {
    const { rooms, questions, ownerId, mia, room, agentId, task, sentToAgents } = makeRoomHost();
    rooms.broughtCanvasAsk(mia.id, room.id, agentId, task.id, "ask-1", {
      title: "Which colour?",
      question: "Which colour?",
      options: [{ label: "Blue" }, { label: "Green" }],
      allowOther: true,
    });

    questions.vote(room.id, "ask-1", 0, 1, mia.id);
    questions.vote(room.id, "ask-1", 0, 0, ownerId);
    expect(questions.votesIn(room.id)).toHaveLength(1);
    expect(questions.votesIn(room.id)[0]?.ballots).toHaveLength(2);

    questions.confirm(room.id, "ask-1", [{ option: 0 }], ownerId);
    const updated = rooms.canvas(room.id).find(({ id }) => id === "ask-1");
    expect(updated?.status).toBe("answered");
    expect(sentToAgents.some(({ message }) => message.type === "room.brought-ask-answered" && message.itemId === "ask-1" && message.answer.label === "Blue")).toBe(true);
  });

  test("taking a brought agent out cancels its waiting room questions", () => {
    const { rooms, mia, ownerId, room, agentId, task } = makeRoomHost();
    rooms.broughtCanvasAsk(mia.id, room.id, agentId, task.id, "ask-2", {
      title: "Continue?",
      question: "Continue?",
      options: [{ label: "Yes" }, { label: "No" }],
      allowOther: true,
    });

    rooms.takeAgentOut(room.id, agentId, ownerId);
    const cancelled = rooms.canvas(room.id).find(({ id }) => id === "ask-2");
    expect(cancelled?.status).toBe("cancelled");
  });

  test("rejects colliding itemIds so a brought agent cannot overwrite an existing canvas item", () => {
    const { rooms, mia, room, agentId, task } = makeRoomHost();
    rooms.broughtCanvasShow(mia.id, room.id, agentId, task.id, "same-id", "Original", "<p>first</p>");
    rooms.broughtCanvasShow(mia.id, room.id, agentId, task.id, "same-id", "Tampered", "<p>second</p>");
    const items = rooms.canvas(room.id);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Original");
  });
});
