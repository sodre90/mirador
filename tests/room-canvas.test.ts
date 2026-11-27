import { describe, expect, test } from "bun:test";
import type { AskItem, CanvasItem, Person, Profile, ShowItem } from "../shared/model.ts";
import { nextSelectionAfterSettle, nextSelectionOnArrival, roomCanvasAuthorOf, waitingRoomAsks } from "../shared/room-canvas.ts";
import { agentStandIn, type Room } from "../shared/rooms.ts";
import { ALL_OF_CLAUDE_SETUP } from "../shared/room-agent-setup.ts";
import { NO_SANDBOX } from "../shared/sandbox.ts";

const showItem = (id: string, conversationId: string, createdAt: number): ShowItem => ({
  id,
  conversationId,
  kind: "show",
  title: `Page ${id}`,
  html: "<p>hi</p>",
  status: "shown",
  createdAt,
  updatedAt: createdAt,
});

const askItem = (id: string, conversationId: string, createdAt: number, status: AskItem["status"] = "waiting"): AskItem => ({
  id,
  conversationId,
  kind: "ask",
  title: `Question ${id}`,
  question: `Question ${id}`,
  options: [{ label: "A" }, { label: "B" }],
  allowOther: true,
  status,
  createdAt,
  updatedAt: createdAt,
});

describe("room canvas concurrent questions", () => {
  test("waitingRoomAsks returns only waiting asks, ordered oldest first", () => {
    const items: CanvasItem[] = [
      showItem("s1", "c1", 100),
      askItem("a2", "c2", 300, "waiting"),
      askItem("a0", "c1", 150, "answered"),
      askItem("a1", "c1", 200, "waiting"),
      askItem("a3", "c2", 250, "cancelled"),
    ];
    expect(waitingRoomAsks(items).map(({ id }) => id)).toEqual(["a1", "a2"]);
  });

  test("nextSelectionOnArrival does not steal focus from a waiting question in a room", () => {
    const a1 = askItem("a1", "c1", 100, "waiting");
    const a2 = askItem("a2", "c2", 200, "waiting");
    const s1 = showItem("s1", "c3", 300);

    expect(nextSelectionOnArrival("a1", [a1, a2], "a2", true)).toBe("a1");
    expect(nextSelectionOnArrival("a1", [a1, s1], "s1", true)).toBe("a1");
    expect(nextSelectionOnArrival("s1", [s1, a2], "a2", true)).toBe("a2");
    expect(nextSelectionOnArrival(null, [a1, a2], "a2", true)).toBe("a2");
    expect(nextSelectionOnArrival("a1", [a1, a2], "a2", false)).toBe("a2");
  });

  test("nextSelectionAfterSettle auto-advances to the next waiting question in a room", () => {
    const settled = askItem("a1", "c1", 100, "answered");
    const waiting1 = askItem("a2", "c2", 200, "waiting");
    const waiting2 = askItem("a3", "c3", 300, "waiting");

    expect(nextSelectionAfterSettle("a1", [settled, waiting1, waiting2], true)).toBe("a2");
    expect(nextSelectionAfterSettle("a1", [settled], true)).toBeNull();
    expect(nextSelectionAfterSettle("a1", [settled, waiting1], false)).toBeNull();
  });

  test("roomCanvasAuthorOf resolves both room agents and brought agents", () => {
    const room: Room = {
      id: "r1",
      name: "Garden",
      workspaceId: "w1",
      agents: [
        { profileId: "p1", conversationId: "c1", answering: null, model: null, effort: null, variables: {}, wholeHostEnvironment: false },
        {
          profileId: "b1",
          conversationId: null,
          answering: null,
          model: null,
          effort: null,
          variables: {},
          wholeHostEnvironment: false,
          brought: { personId: "mia", name: "Coder", harness: "pi", here: true },
        },
      ],
      permissions: "read-freely",
      people: [{ personId: "mia", role: "member" }],
      peoplesTasksWait: true,
      claudeSetup: ALL_OF_CLAUDE_SETUP,
      agentsReadGuests: true,
      membersBringAgents: true,
      sandbox: NO_SANDBOX,
      createdAt: 1,
    };
    const profiles: Profile[] = [
      {
        id: "p1",
        name: "Builder",
        harness: "claude",
        environment: "",
        prelaunch: "",
        model: null,
        mode: null,
        effort: null,
        bypassPermissions: false,
        askMode: "wait",
        color: null,
        pluginsOff: [],
        createdAt: 1,
      },
    ];
    const people: Person[] = [{ id: "mia", number: 2, name: "Mia", color: null }];
    const authorOf = roomCanvasAuthorOf(room, profiles, people, "Nameless");

    expect(authorOf(showItem("s1", "c1", 1))).toEqual({ name: "Builder", harness: "claude" });
    expect(authorOf(showItem("s2", agentStandIn("r1", "b1"), 2))).toEqual({ name: "Coder (Mia)", harness: "pi" });
    expect(authorOf(showItem("s3", "other", 3))).toBeNull();
  });
});
