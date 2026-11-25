import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub, socketData, type BrowserSocket } from "../host/hub.ts";
import { admittedFromPerson } from "../host/person-admission.ts";
import { personView } from "../host/person-view.ts";
import { RoomWorkspaceCalls } from "../host/room-workspace/calls.ts";
import { RoomService, type RoomSessions } from "../host/rooms.ts";
import { NO_SANDBOX_CONTROL, type BroughtCallInSandbox } from "../host/sandbox/sandbox-control.ts";
import { Store, type RoomBroughtTask } from "../host/store.ts";
import { HostProblemError } from "../shared/host-problems.ts";
import type { Conversation, Profile } from "../shared/model.ts";
import type { PermissionPreset } from "../shared/room-permissions.ts";
import { ownerKey, type SandboxSetting } from "../shared/sandbox.ts";
import { MOST_WORKSPACE_CALLS_A_MINUTE, MOST_WORKSPACE_CALLS_AT_ONCE, MOST_WORKSPACE_CALLS_KEPT, WORKSPACE_TASK_MS, type WorkspaceCall } from "../shared/room-workspace.ts";
import type { RoomRole } from "../shared/rooms.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { commandHere } from "./in-vm-here.ts";
import { RUNS_SANDBOXES } from "./sandbox-computer.ts";

const profile = (id: string, name: string): Profile => ({ id, name, harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });

const refusal = (act: () => unknown) => {
  try {
    act();
  } catch (error) {
    return error instanceof HostProblemError ? error.problem.code : (error as Error).message;
  }
  return null;
};

const folders: string[] = [];
afterEach(() => folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true })));

const folderNamed = (name: string) => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), name)));
  folders.push(folder);
  return folder;
};

const until = async <T>(read: () => T | undefined | false | null): Promise<T> => {
  for (const started = Date.now(); Date.now() - started < 10_000; await Bun.sleep(5)) {
    const found = read();
    if (found) return found;
  }
  throw new Error("It never came.");
};

/** Ann's room with Builder, Mia and Bob as members, Cleo as a collaborator and Pat as an approver; Mia's and Bob's Miradors take their agents' tasks. */
function roomOfAnn({ permissions = "never-asks" as PermissionPreset, peoplesTasksWait = true, dataInWorkspace = false } = {}) {
  const store = new Store(":memory:");
  const ownerId = store.ownerId();
  const path = folderNamed("room-calls-");
  writeFileSync(join(path, "a.txt"), "one\n");
  const miradorsData = dataInWorkspace ? join(path, ".mirador") : folderNamed("room-calls-data-");
  mkdirSync(miradorsData, { recursive: true });
  store.setPersonProfile(ownerId, { name: "Ann", color: null });
  store.saveProfile(profile("p1", "Builder"));
  store.insertWorkspace({ id: "w1", name: "project", path, defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1 });
  store.insertWorkspace({ id: "w2", name: "other", path: folderNamed("room-calls-other-"), defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1 });
  const people: [string, string, RoomRole][] = [["m1", "Mia", "member"], ["b1", "Bob", "member"], ["c1", "Cleo", "collaborator"], ["a1", "Pat", "approver"], ["g1", "Gil", "guest"]];
  people.forEach(([id, name]) => store.insertPerson({ id, name, color: null }));
  const hub = new Hub();
  hub.showsPeople(personView(store));
  const socketOf = (personId: string, isOwner = false) => {
    const heard: ServerMessage[] = [];
    const socket = { data: socketData("page", { deviceId: isOwner ? null : `d-${personId}`, personId, isOwner }), send: (payload: string) => heard.push(JSON.parse(payload)) };
    hub.add(socket as unknown as BrowserSocket);
    return { data: socket.data, heard };
  };
  const owner = socketOf(ownerId, true);
  const mia = socketOf("m1");
  const bob = socketOf("b1");
  const pages = { cleo: socketOf("c1"), pat: socketOf("a1"), gil: socketOf("g1"), miasPage: socketOf("m1") };
  const sent: string[] = [];
  const conversationIn = (roomId: string, workspaceId: string, title: string): Conversation => ({ id: crypto.randomUUID(), workspaceId, harness: "claude", profileId: "p1", title, titleSetByUser: true, acpSessionId: null, askMode: "next-message", bypassPermissions: false, status: "idle", statusDetail: null, openInTerminal: null, contextUsage: null, queuedMessages: [], usageLimit: null, jobWaits: [], asyncTasks: [], waitingFor: null, pendingRequest: null, lastWords: null, activity: null, configOptions: [], roomId, createdAt: 1, updatedAt: 1, position: 0 });
  const sessions: RoomSessions = {
    startInRoom: (roomId, workspaceId, _launch, title) => store.insertConversation(conversationIn(roomId, workspaceId, title)),
    send: async (_conversationId, text) => void sent.push(text),
    takeQueuedRoomPrompts: () => [],
    deleteWithAllItHolds: (conversationId) => store.deleteConversation(conversationId),
    waitingPermissions: () => [],
    answerPermission: () => {},
    followRoomPreset: async () => {},
    followRoomAgentModel: async () => {},
    startAfreshInRoom: () => {},
  };
  const held: string[] = [];
  const rooms = new RoomService(store, hub, sessions, { notify: () => {}, roomTaskHeld: (_room, reason) => void held.push(reason.kind === "permission" ? (reason.tool ?? "") : "") }, miradorsData, () => ({ PATH: process.env.PATH ?? "", HOME: path }));
  const room = rooms.create("Launch", "w1", ["p1"], permissions);
  people.forEach(([id, , role]) => rooms.setPersonRole(room.id, id, role));
  rooms.setPeoplesTasksWait(room.id, peoplesTasksWait);
  Object.values(pages).concat(owner).forEach(({ data }) => data.roomSubscriptions.add(room.id));
  rooms.broughtAgentsHere(mia.data);
  rooms.broughtAgentsHere(bob.data);
  const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude", true);
  const tasksTo = (socket: { heard: ServerMessage[] }) => socket.heard.flatMap((message) => (message.type === "room.brought-task" ? [message] : []));
  const answersTo = (socket: { heard: ServerMessage[] }) => socket.heard.flatMap((message) => (message.type === "room.workspace-answered" ? [message] : []));
  const ownerTasks = (text = "Please fix it") => {
    rooms.write(room.id, ownerId, text, [agentId], null);
    return tasksTo(mia).at(-1)!.taskId;
  };
  let calls = 0;
  const call = (taskId: string, asked: WorkspaceCall, { personId = "m1", agent = agentId, callId = `call-${(calls += 1)}` } = {}) => {
    void rooms.workspaceCalled({ personId, roomId: room.id, agentId: agent, taskId, callId, call: asked });
    return callId;
  };
  const answerTo = (callId: string, socket = mia) => until(() => answersTo(socket).find((answer) => answer.callId === callId)?.result);
  const waiting = () => rooms.workspaceWaiting(room.id).flatMap((each) => (each.asks === "call" ? [each] : []));
  const waits = () => until(() => waiting().at(-1));
  const shown = () => rooms.workspaceCallsIn(room.id);
  return { store, hub, rooms, room, ownerId, owner, mia, bob, pages, path, agentId, tasksTo, answersTo, ownerTasks, call, answerTo, waiting, waits, shown, held, sent, miradorsData, inWorkspace: (...parts: string[]) => join(path, ...parts) };
}

const read: WorkspaceCall = { kind: "read", path: "a.txt", fromLine: 1 };
const run = (command: string): WorkspaceCall => ({ kind: "run", command });
const edit: WorkspaceCall = { kind: "edit", path: "a.txt", old: "one", new: "two" };

describe("letting a brought agent into the room's workspace", () => {
  test("one brought for it is asked about, and the owner and approvers alone are told and answer", () => {
    const { rooms, room, agentId, ownerId, held, store } = roomOfAnn();
    expect(rooms.workspaceWaiting(room.id)).toEqual([{ asks: "access", roomId: room.id, agentId, at: 0, approvers: [ownerId, "a1"], sandboxNetwork: null }]);
    expect(rooms.countWaiting(room.id)).toBe(1);
    expect(held).toEqual(["the room's workspace, for Mia's Coder"]);
    for (const personId of ["m1", "b1", "c1", "g1", "x1"]) expect(refusal(() => rooms.answerWorkspace(room.id, agentId, "allow", personId))).toBe("room-approval-not-yours");
    rooms.answerWorkspace(room.id, agentId, "allow", "a1");
    expect(store.findRoom(room.id)!.agents.find(({ profileId }) => profileId === agentId)!.brought!.workspace).toBe("allowed");
    expect(rooms.countWaiting(room.id)).toBe(0);
  });

  test("one brought to work on its bringer's machine is never let in", async () => {
    const { rooms, room, ownerId, mia, tasksTo, call, answerTo } = roomOfAnn();
    const elsewhere = rooms.bringAgent(room.id, "m1", "Other", "claude");
    expect(refusal(() => rooms.answerWorkspace(room.id, elsewhere, "allow", ownerId))).toBe("brought-agent-gone");
    rooms.write(room.id, ownerId, "go", [elsewhere], null);
    expect(await answerTo(call(tasksTo(mia).at(-1)!.taskId, read, { agent: elsewhere }))).toEqual({ done: false, text: expect.stringContaining("not let you work in its workspace") });
  });

  test("nothing is done before it is let in, nor once it is declined, whatever it has under way", async () => {
    const { rooms, room, agentId, ownerId, ownerTasks, call, answerTo, waits, shown, inWorkspace } = roomOfAnn();
    const taskId = ownerTasks();
    expect((await answerTo(call(taskId, read))).text).toContain("not let you work in its workspace");
    rooms.answerWorkspace(room.id, agentId, "allow", ownerId);
    const waitingCall = call(taskId, run("touch ran"));
    const { callId } = await waits();
    rooms.answerWorkspace(room.id, agentId, "decline", ownerId);
    expect(await answerTo(waitingCall)).toEqual({ done: false, text: "It was stopped." });
    expect(refusal(() => rooms.answerWorkspaceCall(room.id, callId, "allow", ownerId))).toBe("permission-no-longer-pending");
    expect((await answerTo(call(taskId, read))).text).toContain("not let you work in its workspace");
    expect(shown().map(({ state }) => state)).toEqual(["stopped"]);
    expect(existsSync(inWorkspace("ran"))).toBe(false);
  });

  test("the agents of someone who approves no longer are asked about again, and what they let through for themselves opens nothing", async () => {
    const { rooms, room, ownerId, store, hub, call, waits, tasksTo, agentId } = roomOfAnn();
    const heard: ServerMessage[] = [];
    const pat = { data: socketData("page", { deviceId: "d-pat", personId: "a1", isOwner: false }), send: (payload: string) => heard.push(JSON.parse(payload)) };
    hub.add(pat as unknown as BrowserSocket);
    rooms.broughtAgentsHere(pat.data);
    const patsAgent = rooms.bringAgent(room.id, "a1", "Fixer", "claude", true);
    const accessOf = (id: string) => store.findRoom(room.id)!.agents.find(({ profileId }) => profileId === id)!.brought!.workspace;
    rooms.answerWorkspace(room.id, patsAgent, "allow", "a1");
    rooms.answerWorkspace(room.id, agentId, "allow", ownerId);
    rooms.write(room.id, "a1", "go", [patsAgent], null);
    const { taskId } = tasksTo({ heard }).at(-1)!;
    const asPats = { personId: "a1", agent: patsAgent };
    const waitingCall = call(taskId, run("touch ran"), asPats);
    await waits();
    const answered = (callId: string) => until(() => heard.flatMap((message) => (message.type === "room.workspace-answered" && message.callId === callId ? [message.result] : [])).at(0));

    rooms.setPersonRole(room.id, "a1", "member");
    expect((await answered(waitingCall)).text).toBe("It was stopped.");
    expect([accessOf(patsAgent), accessOf(agentId)]).toEqual(["asked", "allowed"]);
    expect((await answered(call(taskId, read, asPats))).text).toContain("not let you work in its workspace");
    expect(rooms.workspaceWaiting(room.id)).toEqual([{ asks: "access", roomId: room.id, agentId: patsAgent, at: 0, approvers: [ownerId], sandboxNetwork: null }]);
    rooms.answerWorkspace(room.id, patsAgent, "allow", ownerId);
    expect((await answered(call(taskId, read, asPats))).text).toContain("Nobody who approves in the room let this task through");
    rooms.setPersonRole(room.id, "a1", "collaborator");
    expect(accessOf(patsAgent)).toBe("allowed");
  });

  test("it is asked about again once the room moves to another workspace", async () => {
    const { rooms, room, agentId, ownerId, store, ownerTasks, call, answerTo, waits } = roomOfAnn();
    rooms.answerWorkspace(room.id, agentId, "allow", ownerId);
    const taskId = ownerTasks();
    const waitingCall = call(taskId, run("touch ran"));
    await waits();
    rooms.setWorkspace(room.id, "w2");
    expect((await answerTo(waitingCall)).text).toBe("It was stopped.");
    expect(store.findRoom(room.id)!.agents.find(({ profileId }) => profileId === agentId)!.brought!.workspace).toBe("asked");
    expect((await answerTo(call(taskId, read))).text).toContain("not let you work in its workspace");
  });

  test("a change worked out in the workspace the room just left is never asked about in the next, even by one let in there at once", async () => {
    const { rooms, room, agentId, ownerId, ownerTasks, call, answerTo, waiting } = roomOfAnn();
    rooms.answerWorkspace(room.id, agentId, "allow", ownerId);
    const changed = call(ownerTasks(), edit);
    rooms.setWorkspace(room.id, "w2");
    rooms.answerWorkspace(room.id, agentId, "allow", ownerId);
    expect((await answerTo(changed)).text).toBe("It was stopped.");
    expect(waiting()).toEqual([]);
  });
});

describe("a brought agent in a sandboxed room", () => {
  const freely: SandboxSetting = { on: true, workFreely: true, allowsSharedKernel: false, network: "closed" };
  const asking: SandboxSetting = { on: true, workFreely: false, allowsSharedKernel: false, network: "closed" };

  /** The room's sandbox does its calls on this computer; what it was asked to start and stop. */
  async function sandboxedRoom(sandbox: SandboxSetting, vmStarts = Promise.resolve()) {
    const machine = roomOfAnn();
    const { rooms, room, agentId, ownerId, store } = machine;
    store.saveProfile(profile("p0", "Another"));
    store.saveProfile({ ...profile("p1", "Builder"), environment: "ANTHROPIC_API_KEY=sk-ant-builder" });
    const started: BroughtCallInSandbox[] = [];
    const stopped: string[] = [];
    const looked: string[] = [];
    const networkTold: string[] = [];
    rooms.keepsSandboxesWith({
      ...NO_SANDBOX_CONTROL,
      availability: () => ({ available: true, kind: "apple-container" }),
      launchForBrought: async (call) => {
        started.push(call);
        await vmStarts;
        return { command: commandHere(call.command), environment: {} };
      },
      stopBrought: async (owner, agent) => void stopped.push(`${ownerKey(owner)} ${agent}`),
      turnEnded: async (owner) => void looked.push(ownerKey(owner)),
      networkChanged: (owner) => void networkTold.push(`${ownerKey(owner)} ${store.findRoom(owner.id)!.sandbox.network}`),
    });
    await rooms.setSandbox(room.id, sandbox);
    rooms.answerWorkspace(room.id, agentId, "allow", ownerId);
    stopped.splice(0);
    networkTold.splice(0);
    return { ...machine, started, stopped, looked, networkTold, its: `room:${room.id} ${agentId}` };
  }

  test("has its calls done in its own VM of the sandbox, and nothing on this computer where the sandbox can't run", async () => {
    const { rooms, room, agentId, path, ownerTasks, call, answerTo, started, inWorkspace } = await sandboxedRoom(freely);
    const taskId = ownerTasks();
    expect(await answerTo(call(taskId, read))).toEqual({ done: true, text: "Lines 1 to 2 of 2:\none\n" });
    expect(started.map(({ owner, agentId: agent, allowsSharedKernel, workingDirectory, profiles }) => ({ owner, agent, allowsSharedKernel, workingDirectory, profiles: profiles.map(({ id }) => id) }))).toEqual([
      { owner: { kind: "room", id: room.id }, agent: agentId, allowsSharedKernel: false, workingDirectory: path, profiles: ["p1", "p0"] },
    ]);
    rooms.keepsSandboxesWith(NO_SANDBOX_CONTROL);
    expect(await answerTo(call(taskId, run("touch ran")))).toEqual({ done: false, text: "The room's sandbox can't run now (unavailable)." });
    expect(existsSync(inWorkspace("ran"))).toBe(false);
  });

  test.skipIf(!RUNS_SANDBOXES)("works there without asking where agents work freely in it", async () => {
    const { ownerTasks, call, answerTo, waiting, shown, inWorkspace } = await sandboxedRoom(freely);
    const taskId = ownerTasks();
    expect(await answerTo(call(taskId, edit))).toEqual({ done: true, text: "Changed a.txt." });
    expect(await answerTo(call(taskId, run("cat a.txt")))).toEqual({ done: true, text: "It exited with 0.\ntwo" });
    expect(readFileSync(inWorkspace("a.txt"), "utf8")).toBe("two\n");
    expect(waiting()).toEqual([]);
    expect(shown().map(({ state, answeredBy }) => [state, answeredBy])).toEqual([["done", null], ["done", null]]);
  });

  test.skipIf(!RUNS_SANDBOXES)("asks before each change and command where they don't, saying they are done in the sandbox", async () => {
    const { rooms, room, ownerId, ownerTasks, call, answerTo, waits, inWorkspace } = await sandboxedRoom(asking);
    const taskId = ownerTasks();
    for (const asked of [edit, run("touch ran")]) {
      const callId = call(taskId, asked);
      const waiting = await waits();
      expect(waiting.sandboxNetwork).toBe("closed");
      rooms.answerWorkspaceCall(room.id, waiting.callId, "allow", ownerId);
      expect((await answerTo(callId)).done).toBe(true);
    }
    expect(existsSync(inWorkspace("ran"))).toBe(true);
  });

  test.skipIf(!RUNS_SANDBOXES)("says what its sandbox reaches where it asks, as the owner changes that, which ends nothing of it", async () => {
    const { rooms, room, agentId, ownerId, store, ownerTasks, call, answerTo, waiting, waits, stopped, networkTold, inWorkspace } = await sandboxedRoom(asking);
    const callId = call(ownerTasks(), run("touch ran"));
    const { callId: shownId } = await waits();
    rooms.setSandboxNetwork(room.id, "internet");
    expect(waiting().map(({ sandboxNetwork }) => sandboxNetwork)).toEqual(["internet"]);
    rooms.setSandboxNetwork(room.id, "closed");
    expect(waiting().map(({ sandboxNetwork }) => sandboxNetwork)).toEqual(["closed"]);
    rooms.answerWorkspaceCall(room.id, shownId, "allow", ownerId);
    expect((await answerTo(callId)).done).toBe(true);
    expect(existsSync(inWorkspace("ran"))).toBe(true);
    expect(store.findRoom(room.id)!.agents.find(({ profileId }) => profileId === agentId)!.brought!.workspace).toBe("allowed");
    expect(stopped).toEqual([]);
    expect(networkTold).toEqual([`room:${room.id} internet`, `room:${room.id} closed`]);
    rooms.setSandboxNetwork(room.id, "everything");
    await rooms.setSandbox(room.id, { ...freely, network: "everything" });
    rooms.setWorkspace(room.id, "w2");
    expect(rooms.workspaceWaiting(room.id).map(({ asks, sandboxNetwork }) => [asks, sandboxNetwork])).toEqual([["access", "everything"]]);
  });

  test("a call asked for in the sandbox is never done on this computer, and leaving the sandbox asks for the agent again", async () => {
    const { rooms, room, agentId, ownerId, store, ownerTasks, call, answerTo, waits, stopped, its, inWorkspace } = await sandboxedRoom(asking);
    const callId = call(ownerTasks(), run("touch ran"));
    const { callId: shownId } = await waits();
    await rooms.setSandbox(room.id, { ...asking, on: false });
    expect(await answerTo(callId)).toEqual({ done: false, text: "It was stopped." });
    expect(refusal(() => rooms.answerWorkspaceCall(room.id, shownId, "allow", ownerId))).toBe("permission-no-longer-pending");
    expect(store.findRoom(room.id)!.agents.find(({ profileId }) => profileId === agentId)!.brought!.workspace).toBe("asked");
    expect(stopped).toEqual([its]);
    expect(existsSync(inWorkspace("ran"))).toBe(false);
  });

  test("its calls end, and its VM stops, once agents no longer work freely there, and go on when they may", async () => {
    const { rooms, room, ownerTasks, call, answerTo, shown, stopped, its } = await sandboxedRoom(freely);
    const taskId = ownerTasks();
    const callId = call(taskId, run("sleep 30"));
    await until(() => shown().some(({ state }) => state === "running"));
    await rooms.setSandbox(room.id, asking);
    expect((await answerTo(callId)).text).toBe("It was stopped.");
    expect(stopped).toEqual([its]);
    await rooms.setSandbox(room.id, freely);
    expect(stopped).toEqual([its]);
  });

  test("its VM stops once it may work there no longer, whether it is declined, taken out or its room moves", async () => {
    const declined = await sandboxedRoom(freely);
    declined.rooms.answerWorkspace(declined.room.id, declined.agentId, "decline", declined.ownerId);
    expect(declined.stopped).toEqual([declined.its]);
    const takenOut = await sandboxedRoom(freely);
    takenOut.rooms.takeAgentOut(takenOut.room.id, takenOut.agentId, takenOut.ownerId);
    expect(takenOut.stopped).toEqual([takenOut.its]);
    const moved = await sandboxedRoom(freely);
    moved.rooms.setWorkspace(moved.room.id, "w2");
    expect(moved.stopped).toEqual([moved.its]);
  });

  test("the sandbox's held files are looked at once more as it answers its task", async () => {
    const { rooms, room, agentId, ownerTasks, looked } = await sandboxedRoom(freely);
    const taskId = ownerTasks();
    rooms.broughtTaskAnswered("m1", room.id, agentId, taskId, "Done", null);
    expect(looked).toEqual([`room:${room.id}`]);
  });

  test("calls asked for at once count while what they change is worked out, and end with the task", async () => {
    const vm = Promise.withResolvers<void>();
    const { rooms, room, agentId, ownerTasks, call, answerTo } = await sandboxedRoom(asking, vm.promise);
    const taskId = ownerTasks();
    const asked = Array.from({ length: MOST_WORKSPACE_CALLS_AT_ONCE }, () => call(taskId, edit));
    expect((await answerTo(call(taskId, edit))).text).toContain(`Only ${MOST_WORKSPACE_CALLS_AT_ONCE} calls`);
    rooms.broughtTaskAnswered("m1", room.id, agentId, taskId, "Done", null);
    vm.resolve();
    for (const callId of asked) expect((await answerTo(callId)).text).toBe("It was stopped.");
    expect(rooms.workspaceCallsIn(room.id)).toEqual([]);
  });
});

describe("the task a call is made for", () => {
  const allowed = (given: Parameters<typeof roomOfAnn>[0] = {}) => {
    const machine = roomOfAnn(given);
    machine.rooms.answerWorkspace(machine.room.id, machine.agentId, "allow", machine.ownerId);
    return machine;
  };

  test("the owner's or an approver's own opens the workspace to it", async () => {
    const { rooms, room, agentId, mia, tasksTo, ownerTasks, call, answerTo } = allowed();
    expect(await answerTo(call(ownerTasks(), read))).toEqual({ done: true, text: "Lines 1 to 2 of 2:\none\n" });
    rooms.write(room.id, "a1", "And this", [agentId], null);
    expect((await answerTo(call(tasksTo(mia).at(-1)!.taskId, read))).done).toBe(true);
  });

  test("a member's waits for an approver even where people's tasks start by themselves, their own bringer's too, and opens it once allowed", async () => {
    const { rooms, room, agentId, mia, tasksTo, call, answerTo, ownerId } = allowed({ peoplesTasksWait: false });
    for (const personId of ["b1", "m1"]) {
      const before = tasksTo(mia).length;
      const message = rooms.write(room.id, personId, "Run something", [agentId], null);
      expect(message.taskHeld).toBe("waiting");
      expect(tasksTo(mia)).toHaveLength(before);
      rooms.answerTask(room.id, message.id, "allow", ownerId);
      expect((await answerTo(call(tasksTo(mia).at(-1)!.taskId, read))).done).toBe(true);
    }
  });

  test("a follow-up of a member in its thread waits as well, and the owner's opens the workspace", async () => {
    const { rooms, room, ownerId, mia, tasksTo, ownerTasks, call, answerTo } = allowed({ peoplesTasksWait: false });
    ownerTasks();
    const thread = rooms.timeline(room.id).threads.at(-1)!;
    expect(rooms.write(room.id, "m1", "more", [], thread.id).taskHeld).toBe("waiting");
    rooms.write(room.id, ownerId, "go ahead", [], thread.id);
    expect((await answerTo(call(tasksTo(mia).at(-1)!.taskId, read))).done).toBe(true);
  });

  test("a task that waited from before it was let in, and one sent without anyone allowing it, opens nothing", async () => {
    const { rooms, room, agentId, ownerId, mia, tasksTo, call, answerTo } = roomOfAnn({ peoplesTasksWait: false });
    rooms.write(room.id, "b1", "Run something", [agentId], null);
    const unasked = tasksTo(mia).at(-1)!.taskId;
    rooms.answerWorkspace(room.id, agentId, "allow", ownerId);
    expect((await answerTo(call(unasked, read))).text).toContain("Nobody who approves in the room let this task through");
  });

  test("another brought agent's tag of it waits, its bringer's own or an approver's agent included, and opens it only once allowed", async () => {
    const { rooms, room, agentId, ownerId, mia, tasksTo, call, answerTo } = allowed({ peoplesTasksWait: false });
    const other = rooms.bringAgent(room.id, "m1", "Scout", "claude");
    rooms.write(room.id, ownerId, "look around", [other], null);
    const scouts = tasksTo(mia).at(-1)!;
    rooms.broughtTaskAnswered("m1", room.id, other, scouts.taskId, "@Mia's Coder run it", null);
    const answer = rooms.timeline(room.id).messages.at(-1)!;
    expect([answer.tags, answer.taskHeld]).toEqual([[agentId], "waiting"]);
    expect(tasksTo(mia).at(-1)!.taskId).toBe(scouts.taskId);
    rooms.answerTask(room.id, answer.id, "allow", ownerId);
    expect((await answerTo(call(tasksTo(mia).at(-1)!.taskId, read))).done).toBe(true);
  });

  test("the room's own agent's tag reaches it without opening anything", async () => {
    const { rooms, room, store, agentId, ownerId, mia, tasksTo, call, answerTo } = allowed({ peoplesTasksWait: false });
    const builders = rooms.write(room.id, ownerId, "Builder, look", ["p1"], null);
    const conversationId = store.findRoom(room.id)!.agents.find(({ profileId }) => profileId === "p1")!.conversationId!;
    const seq = store.appendEvent(conversationId, { type: "user-message", text: "x", roomMessageId: builders.id } as never).seq;
    store.appendEvent(conversationId, { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "over to Coder" } } } as never);
    store.appendEvent(conversationId, { type: "turn-end", stopReason: "end_turn" } as never);
    rooms.nameTagsForAnswer(conversationId, ["Mia's Coder"]);
    rooms.turnEnded(conversationId, seq);
    const taskId = tasksTo(mia).at(-1)!.taskId;
    expect(tasksTo(mia).at(-1)!.agentId).toBe(agentId);
    expect((await answerTo(call(taskId, read))).text).toContain("Nobody who approves in the room let this task through");
  });

  test("another agent's, another person's, a made up and an answered task open nothing", async () => {
    const { rooms, room, agentId, ownerId, mia, bob, tasksTo, ownerTasks, call, answerTo } = allowed();
    const bobs = rooms.bringAgent(room.id, "b1", "Runner", "claude", true);
    rooms.answerWorkspace(room.id, bobs, "allow", ownerId);
    rooms.write(room.id, ownerId, "Runner, go", [bobs], null);
    const bobsTask = tasksTo(bob).at(-1)!.taskId;
    const taskId = ownerTasks();
    for (const unknown of [bobsTask, crypto.randomUUID()]) expect((await answerTo(call(unknown, read))).text).toContain("knows no such task");
    const second = rooms.bringAgent(room.id, "m1", "Second", "claude", true);
    rooms.answerWorkspace(room.id, second, "allow", ownerId);
    rooms.write(room.id, ownerId, "Both, go", [agentId, second], null);
    const secondsTask = tasksTo(mia).find((task) => task.agentId === second)!.taskId;
    expect((await answerTo(call(secondsTask, read))).text).toContain("knows no such task");
    expect((await answerTo(call(secondsTask, read, { agent: second }))).done).toBe(true);
    expect((await answerTo(call(taskId, read, { personId: "b1", agent: agentId }), bob)).text).toBe("You are no longer in the room.");
    rooms.broughtTaskAnswered("m1", room.id, agentId, taskId, "done", null);
    expect((await answerTo(call(taskId, read))).text).toContain("knows no such task");
  });

  test("its time is this machine's, from when it was let through", async () => {
    const { store, room, rooms, agentId, ownerId, call, answerTo } = allowed();
    const message = rooms.write(room.id, ownerId, "go", [agentId], null);
    const task = (id: string, sentAt: number): RoomBroughtTask => ({ id, roomId: room.id, agentId, messageId: message.id, prompt: "x", byName: "Ann", byRole: "owner", fromBringer: false, letThrough: true, sentAt });
    store.insertRoomBroughtTask(task("late", Date.now() - WORKSPACE_TASK_MS));
    store.insertRoomBroughtTask(task("almost", Date.now() - WORKSPACE_TASK_MS + 5_000));
    expect((await answerTo(call("late", read))).text).toBe("The time for this task in the room's workspace is over.");
    expect((await answerTo(call("almost", read))).done).toBe(true);
  });

  test("a call still waiting when its time is over no longer can be allowed, and a command still running is stopped", async () => {
    const { store, room, rooms, agentId, ownerId, call, answerTo, waits, waiting, inWorkspace } = allowed();
    const message = rooms.write(room.id, ownerId, "go", [agentId], null);
    store.insertRoomBroughtTask({ id: "ending", roomId: room.id, agentId, messageId: message.id, prompt: "x", byName: "Ann", byRole: "owner", fromBringer: false, letThrough: true, sentAt: Date.now() - WORKSPACE_TASK_MS + 800 });
    const running = call("ending", run("sleep 20; touch survived"));
    rooms.answerWorkspaceCall(room.id, (await waits()).callId, "allow", ownerId);
    const left = call("ending", run("touch late"));
    await waits();
    expect((await answerTo(left)).text).toBe("The time for this task in the room's workspace is over.");
    expect(await answerTo(running)).toEqual({ done: false, text: "It was stopped." });
    expect(waiting()).toEqual([]);
    expect([existsSync(inWorkspace("late")), existsSync(inWorkspace("survived"))]).toEqual([false, false]);
  });

  test("a call allowed late, as the machine wakes from a sleep its time ended in, is not done", async () => {
    const { store, room, rooms, agentId, ownerId, call, answerTo, waits, inWorkspace } = allowed();
    const message = rooms.write(room.id, ownerId, "go", [agentId], null);
    store.insertRoomBroughtTask({ id: "ending", roomId: room.id, agentId, messageId: message.id, prompt: "x", byName: "Ann", byRole: "owner", fromBringer: false, letThrough: true, sentAt: Date.now() - WORKSPACE_TASK_MS + 600 });
    const left = call("ending", run("touch late"));
    const { callId } = await waits();
    Bun.sleepSync(700);
    rooms.answerWorkspaceCall(room.id, callId, "allow", ownerId);
    expect((await answerTo(left)).text).toBe("The time for this task in the room's workspace is over.");
    expect(existsSync(inWorkspace("late"))).toBe(false);
  });
});

describe("what an approver is asked", () => {
  const allowed = (given: Parameters<typeof roomOfAnn>[0] = {}) => {
    const machine = roomOfAnn(given);
    machine.rooms.answerWorkspace(machine.room.id, machine.agentId, "allow", machine.ownerId);
    return { ...machine, taskId: machine.ownerTasks() };
  };

  test.each(["never-asks", "work-freely", "read-freely", "ask-everything"] as PermissionPreset[])("every edit and command under %s, one by one, showing all of it", async (permissions) => {
    const { rooms, room, ownerId, taskId, call, answerTo, waits, waiting, inWorkspace, agentId } = allowed({ permissions });
    const edited = call(taskId, edit);
    const asked = await waits();
    expect(asked).toMatchObject({ kind: "edit", about: "a.txt", agentId, approvers: [ownerId, "a1"], task: { text: "Please fix it" } });
    expect(asked.shown).toContain("-one\n+two");
    expect(readFileSync(inWorkspace("a.txt"), "utf8")).toBe("one\n");
    rooms.answerWorkspaceCall(room.id, asked.callId, "allow", "a1");
    expect((await answerTo(edited)).text).toBe("Changed a.txt.");
    const ran = call(taskId, run("cat a.txt\u200b; echo \u202etxt"));
    const askedToRun = await waits();
    expect(askedToRun.shown).toBe("cat a.txt\\u{200b}; echo \\u{202e}txt");
    expect(waiting()).toHaveLength(1);
    rooms.answerWorkspaceCall(room.id, askedToRun.callId, "deny", ownerId);
    expect(await answerTo(ran)).toEqual({ done: false, text: "Whoever approves in the room said no." });
  });

  test("a change with characters that don't show, spelled out", async () => {
    const { taskId, call, waits, shown } = allowed();
    call(taskId, { kind: "write", path: "new.txt", content: "if (isAdmin\u202e) {\u200b}\n" });
    expect((await waits()).shown).toContain("+if (isAdmin\\u{202e}) {\\u{200b}}");
    expect(shown().at(-1)!.diff).toContain("+if (isAdmin\\u{202e}) {\\u{200b}}");
  });

  test("shows what came of a call with nothing hidden in it, and gives the agent the text as it is", async () => {
    const { rooms, room, ownerId, taskId, call, answerTo, waits, shown } = allowed();
    const callId = call(taskId, run("printf 'a\\342\\200\\256b\\033[2K'"));
    rooms.answerWorkspaceCall(room.id, (await waits()).callId, "allow", ownerId);
    expect((await answerTo(callId)).text).toContain("a\u202eb\u001b[2K");
    expect(shown().at(-1)!.result).toContain("a\\u{202e}b\\u{1b}[2K");
  });

  test("a command padded to put what it does out of sight, with the padding counted", async () => {
    const { taskId, call, waits } = allowed();
    call(taskId, run(`ls${"\n".repeat(100)}rm -rf x`));
    expect((await waits()).shown).toBe("ls\n\n\n\\u{a}{97}\nrm -rf x");
  });

  test("all of a change, of which the room then keeps only some", async () => {
    const { taskId, call, waits, shown, rooms, room, ownerId, answerTo } = allowed();
    const content = "\u200b".repeat(9_000);
    const called = call(taskId, { kind: "write", path: "new.txt", content });
    const asked = await waits();
    expect(asked.shown).toContain("\\u{200b}".repeat(9_000));
    rooms.answerWorkspaceCall(room.id, asked.callId, "allow", ownerId);
    await answerTo(called);
    const kept = shown().at(-1)!;
    expect([kept.diff!.length < 6_100, kept.diff!.startsWith("--- /dev/null\n+++ new.txt"), kept.diff!.includes("\n…\n")]).toEqual([true, true, true]);
  });

  test("reads only under ask everything", async () => {
    const { taskId, call, answerTo } = allowed({ permissions: "read-freely" });
    expect((await answerTo(call(taskId, read))).done).toBe(true);
    const strict = allowed({ permissions: "ask-everything" });
    const asked = strict.call(strict.taskId, read);
    strict.rooms.answerWorkspaceCall(strict.room.id, (await strict.waits()).callId, "allow", strict.ownerId);
    expect((await strict.answerTo(asked)).done).toBe(true);
  });

  test("under ask everything, edits and writes never read the workspace or reveal matches before an approver allows them", async () => {
    const { rooms, room, ownerId, taskId, call, answerTo, waits, inWorkspace } = allowed({ permissions: "ask-everything" });
    writeFileSync(inWorkspace("secret.txt"), "API_KEY=alpha\n");
    for (const probe of [
      { kind: "edit", path: "secret.txt", old: "API_KEY=alpha", new: "x" },
      { kind: "edit", path: "secret.txt", old: "NOT_THERE", new: "x" },
      { kind: "edit", path: "missing.txt", old: "anything", new: "x" },
      { kind: "write", path: "secret.txt", content: "API_KEY=alpha\n" },
    ] as WorkspaceCall[]) {
      const callId = call(taskId, probe);
      const asked = await waits();
      rooms.answerWorkspaceCall(room.id, asked.callId, "deny", ownerId);
      expect(await answerTo(callId)).toEqual({ done: false, text: "Whoever approves in the room said no." });
    }
    const allowedMiss = call(taskId, { kind: "edit", path: "secret.txt", old: "NOT_THERE", new: "x" });
    rooms.answerWorkspaceCall(room.id, (await waits()).callId, "allow", ownerId);
    expect((await answerTo(allowedMiss)).text).toContain("not in secret.txt");
  });

  test("nobody but the owner and approvers answers, and a call is answered once, by the room it is of", async () => {
    const { rooms, room, ownerId, taskId, call, answerTo, waits, inWorkspace } = allowed();
    const ran = call(taskId, run("echo ran >> ran.txt"));
    const { callId } = await waits();
    for (const personId of ["m1", "b1", "c1", "g1", "x1"]) expect(refusal(() => rooms.answerWorkspaceCall(room.id, callId, "allow", personId))).toBe("room-approval-not-yours");
    const other = rooms.create("Other", "w1", ["p1"], "read-freely");
    expect(refusal(() => rooms.answerWorkspaceCall(other.id, callId, "allow", ownerId))).toBe("permission-no-longer-pending");
    rooms.answerWorkspaceCall(room.id, callId, "allow", ownerId);
    expect(refusal(() => rooms.answerWorkspaceCall(room.id, callId, "allow", "a1"))).toBe("permission-no-longer-pending");
    expect((await answerTo(ran)).text).toBe("It exited with 0.");
    expect(readFileSync(inWorkspace("ran.txt"), "utf8")).toBe("ran\n");
  });

  test("a file changed while the edit waited is left as it is", async () => {
    const { rooms, room, ownerId, taskId, call, answerTo, waits, inWorkspace } = allowed();
    const edited = call(taskId, edit);
    const { callId } = await waits();
    writeFileSync(inWorkspace("a.txt"), "one, by Ann\n");
    rooms.answerWorkspaceCall(room.id, callId, "allow", ownerId);
    expect((await answerTo(edited)).text).toContain("was changed meanwhile");
    expect(readFileSync(inWorkspace("a.txt"), "utf8")).toBe("one, by Ann\n");
  });

  test("an edit that can't be made asks nobody", async () => {
    const { taskId, call, answerTo, waiting } = allowed();
    for (const path of ["../x", ".git/hooks/pre-commit", ".claude/settings.json"]) expect((await answerTo(call(taskId, { kind: "write", path, content: "x" }))).done).toBe(false);
    expect(waiting()).toEqual([]);
  });

  test("the bringer who became an approver answers for their own agent, and the room shows who did", async () => {
    const { rooms, room, taskId, call, answerTo, waits, shown } = allowed();
    rooms.setPersonRole(room.id, "m1", "approver");
    const ran = call(taskId, run("echo hi"));
    rooms.answerWorkspaceCall(room.id, (await waits()).callId, "allow", "m1");
    expect((await answerTo(ran)).text).toBe("It exited with 0.\nhi");
    expect(shown().at(-1)).toMatchObject({ state: "done", answeredBy: "m1" });
  });
});

describe("a hostile Mirador", () => {
  const allowed = (given: Parameters<typeof roomOfAnn>[0] = {}) => {
    const machine = roomOfAnn(given);
    machine.rooms.answerWorkspace(machine.room.id, machine.agentId, "allow", machine.ownerId);
    return { ...machine, taskId: machine.ownerTasks() };
  };

  test("has no more than a few calls wait or run at once, however close together they come", async () => {
    const { taskId, call, waiting, answersTo, mia } = allowed();
    Array.from({ length: 12 }, () => call(taskId, edit));
    await until(() => answersTo(mia).length === 12 - MOST_WORKSPACE_CALLS_AT_ONCE && waiting().length === MOST_WORKSPACE_CALLS_AT_ONCE);
    expect(answersTo(mia).every(({ result }) => !result.done && result.text.includes("wait or run at a time"))).toBe(true);
  });

  test("makes only so many calls a minute, its agents together", async () => {
    const { taskId, call, answerTo, answersTo, mia } = allowed();
    for (let made = 0; made < MOST_WORKSPACE_CALLS_A_MINUTE; made += 1) await answerTo(call(taskId, read));
    expect((await answerTo(call(taskId, read))).text).toContain("too many calls");
    expect(answersTo(mia).filter(({ result }) => result.done)).toHaveLength(MOST_WORKSPACE_CALLS_A_MINUTE);
  });

  test("has a call it sends twice done once", async () => {
    const { rooms, room, ownerId, taskId, call, answerTo, waits, waiting, inWorkspace } = allowed();
    call(taskId, run("echo ran >> ran.txt"), { callId: "same" });
    await waits();
    call(taskId, run("echo again >> ran.txt"), { callId: "same" });
    expect(waiting()).toHaveLength(1);
    rooms.answerWorkspaceCall(room.id, waiting()[0]!.callId, "allow", ownerId);
    await answerTo("same");
    expect(readFileSync(inWorkspace("ran.txt"), "utf8")).toBe("ran\n");
  });

  test("stops only its own calls", async () => {
    const { rooms, room, agentId, taskId, call, answerTo, waits, waiting } = allowed();
    const callId = call(taskId, run("echo hi"));
    await waits();
    rooms.workspaceCallStopped({ personId: "b1", roomId: room.id, agentId, callId });
    expect(waiting()).toHaveLength(1);
    rooms.workspaceCallStopped({ personId: "m1", roomId: room.id, agentId, callId });
    expect((await answerTo(callId)).text).toBe("It was stopped.");
    expect(waiting()).toEqual([]);
  });

  test("that stops a change as it is made is told it was made", async () => {
    const { rooms, room, agentId, ownerId, taskId, call, answerTo, waits, shown } = allowed();
    const callId = call(taskId, edit);
    rooms.answerWorkspaceCall(room.id, (await waits()).callId, "allow", ownerId);
    rooms.workspaceCallStopped({ personId: "m1", roomId: room.id, agentId, callId });
    expect((await answerTo(callId)).done).toBe(true);
    expect(shown().at(-1)).toMatchObject({ state: "done" });
  });

  test("hears nothing more of a command once its agent is taken out, and the command is stopped", async () => {
    const { rooms, room, agentId, ownerId, taskId, call, answerTo, waits, shown, inWorkspace } = allowed();
    const callId = call(taskId, run("echo secret; sleep 20; touch survived"));
    rooms.answerWorkspaceCall(room.id, (await waits()).callId, "allow", ownerId);
    await Bun.sleep(300);
    rooms.takeAgentOut(room.id, agentId, ownerId);
    expect(await answerTo(callId)).toEqual({ done: false, text: "It was stopped." });
    expect(shown().at(-1)).toMatchObject({ state: "stopped", result: expect.stringContaining("secret") });
    expect(existsSync(inWorkspace("survived"))).toBe(false);
  });

  test("ends its calls by going, by answering the task, by its bringer made a guest, and with the room", async () => {
    const ways: ((machine: ReturnType<typeof allowed>) => void)[] = [
      ({ rooms, mia, hub }) => {
        hub.remove(mia as unknown as BrowserSocket);
        mia.data.carriesAgents = false;
        rooms.bringerLeft("m1");
      },
      ({ rooms, room, agentId, taskId }) => rooms.broughtTaskAnswered("m1", room.id, agentId, taskId, "done", null),
      ({ rooms, room }) => rooms.setPersonRole(room.id, "m1", "guest"),
      ({ rooms, room }) => rooms.removePerson(room.id, "m1"),
      ({ rooms, room }) => rooms.setMembersBringAgents(room.id, false),
      ({ rooms, room }) => rooms.delete(room.id),
      ({ rooms }) => rooms.shutdown(),
    ];
    for (const end of ways) {
      const machine = allowed();
      machine.call(machine.taskId, run("touch ran"));
      const { callId } = await machine.waits();
      end(machine);
      expect(machine.waiting()).toEqual([]);
      expect(refusal(() => machine.rooms.answerWorkspaceCall(machine.room.id, callId, "allow", machine.ownerId))).not.toBeNull();
      expect(existsSync(machine.inWorkspace("ran"))).toBe(false);
    }
  });

  test("reads nothing of Mirador's data through a room whose workspace holds it", async () => {
    const { miradorsData, taskId, call, answerTo, inWorkspace } = allowed({ dataInWorkspace: true });
    writeFileSync(join(miradorsData, "token"), "secret");
    expect(miradorsData.startsWith(inWorkspace())).toBe(true);
    expect((await answerTo(call(taskId, { kind: "read", path: ".mirador/token", fromLine: 1 }))).text).toContain("Mirador's own data");
  });
});

describe("what the room shows of the calls", () => {
  test("to the owner and those who read the agents' work, and never to others in the room; the answer goes to the bringer's Mirador alone", async () => {
    const { rooms, room, agentId, ownerId, owner, pages, mia, bob, ownerTasks, call, answerTo } = roomOfAnn();
    rooms.answerWorkspace(room.id, agentId, "allow", ownerId);
    await answerTo(call(ownerTasks(), read));
    const shownTo = ({ heard }: { heard: ServerMessage[] }) => heard.filter(({ type }) => type === "room.workspace-call-shown").length;
    expect(shownTo(owner)).toBe(3);
    expect([shownTo(pages.cleo), shownTo(pages.pat)]).toEqual([3, 3]);
    expect([shownTo(pages.gil), shownTo(pages.miasPage), shownTo(bob)]).toEqual([0, 0, 0]);
    const toldAnswer = ({ heard }: { heard: ServerMessage[] }) => heard.some(({ type }) => type === "room.workspace-answered");
    expect(toldAnswer(mia)).toBe(true);
    expect([owner, pages.miasPage, pages.cleo, pages.pat, pages.gil, bob].map(toldAnswer)).toEqual([false, false, false, false, false, false]);
  });

  test("what waits for an approver goes to them alone", async () => {
    const { rooms, room, agentId, ownerId, pages, ownerTasks, call, waits } = roomOfAnn();
    rooms.answerWorkspace(room.id, agentId, "allow", ownerId);
    call(ownerTasks(), run("echo hi"));
    await waits();
    const waitingFor = ({ heard }: { heard: ServerMessage[] }) => heard.flatMap((message) => (message.type === "room.approvals" ? [message.workspace.length] : [])).at(-1);
    expect(waitingFor(pages.pat)).toBe(1);
    expect([waitingFor(pages.cleo), waitingFor(pages.gil), waitingFor(pages.miasPage)]).toEqual([0, 0, 0]);
  });

  test("the latest of its calls, its reads never in place of what it changed and ran", () => {
    const { store, room, agentId, shown } = roomOfAnn();
    const keep = (id: string, kind: WorkspaceCall["kind"], at: number) =>
      store.insertWorkspaceCall({ id, roomId: room.id, agentId, threadId: "t1", at, kind, about: "a", state: "done", diff: null, result: null, answeredBy: null });
    keep("changed", "edit", 0);
    Array.from({ length: MOST_WORKSPACE_CALLS_KEPT + 5 }, (_, index) => keep(`read-${index}`, "read", index + 1));
    expect(shown()).toHaveLength(MOST_WORKSPACE_CALLS_KEPT + 1);
    expect(shown()[0]!.id).toBe("changed");
    expect(shown()[1]!.id).toBe("read-5");
    Array.from({ length: MOST_WORKSPACE_CALLS_KEPT }, (_, index) => keep(`run-${index}`, "run", 1_000 + index));
    expect(shown().some(({ id }) => id === "changed")).toBe(false);
    expect(shown()).toHaveLength(2 * MOST_WORKSPACE_CALLS_KEPT);
  });

  test("a call the host stopped on shows as stopped", async () => {
    const { store, rooms, room, agentId, ownerId, ownerTasks, call, waits } = roomOfAnn();
    rooms.answerWorkspace(room.id, agentId, "allow", ownerId);
    call(ownerTasks(), run("echo hi"));
    await waits();
    expect(rooms.workspaceCallsIn(room.id).map(({ state }) => state)).toEqual(["waiting"]);
    new RoomWorkspaceCalls(store, new Hub(), { threadOf: () => undefined, waitingChanged: () => {}, callWaits: () => {}, placeOf: () => null });
    expect(rooms.workspaceCallsIn(room.id).map(({ state }) => state)).toEqual(["stopped"]);
  });
});

describe("what a person's Mirador may send of it", () => {
  const roles: Record<string, RoomRole> = { r1: "member", r2: "guest", r3: "approver", r4: "collaborator" };
  const person = { personId: "m1", roleIn: (roomId: string) => roles[roomId] ?? null, conversationBehind: () => null };
  const admitted = (sent: Record<string, unknown>) => refusal(() => admittedFromPerson(sent, person));
  const named = { type: "room.workspace-call", roomId: "r1", agentId: "a1", taskId: "t1", callId: "c1" };

  test("a call of a form the host knows, no larger than it may be, in a room they may ask agents in", () => {
    expect(admitted({ ...named, call: read })).toBeNull();
    expect(admitted({ ...named, call: run("ls") })).toBeNull();
    const refusedOnes: unknown[] = [null, "ls", [], {}, { kind: "delete", path: "a" }, { kind: "run" }, { kind: "run", command: " " }, { kind: "run", command: "x".repeat(8_001) }, { kind: "run", command: "ls", cwd: "/" }, { kind: "read", path: "a" }, { kind: "read", path: "a", fromLine: 0 }, { kind: "read", path: "x".repeat(1_001), fromLine: 1 }, { kind: "edit", path: "a", old: "", new: "b" }, { kind: "write", path: "a", content: "x".repeat(40_001) }, { kind: "write", path: ["a"], content: "x" }];
    refusedOnes.forEach((call) => expect(admitted({ ...named, call })).not.toBeNull());
    for (const id of ["agentId", "taskId", "callId"]) expect(admitted({ ...named, call: read, [id]: "not an id" })).not.toBeNull();
    expect(admitted({ ...named, roomId: "r2", call: read })).not.toBeNull();
    expect(admitted({ ...named, roomId: "r9", call: read })).toBe("room-gone");
  });

  test("nothing besides a call's own fields goes through", () => {
    expect(admittedFromPerson({ ...named, call: read, personId: "someone", extra: 1 }, person)).toEqual({ ...named, call: read } as never);
  });

  test("an answer only as an approver", () => {
    for (const type of [{ type: "room.answer-workspace", agentId: "a1", answer: "allow" }, { type: "room.answer-workspace-call", callId: "c1", answer: "allow" }]) {
      for (const roomId of ["r1", "r2", "r4"]) expect(admitted({ ...type, roomId })).toBe("room-approval-not-yours");
      expect(admitted({ ...type, roomId: "r3" })).toBeNull();
      expect(admitted({ ...type, roomId: "r3", answer: "allow-for-task" })).not.toBeNull();
    }
  });
});
