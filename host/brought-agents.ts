import {
  BROUGHT_TASK_MOST_CHARACTERS,
  isOthersTasks,
  MOST_BROUGHT_TASKS_A_MINUTE,
  MOST_BROUGHT_TASKS_QUEUED,
  type BroughtAgentHere,
  type BroughtTaskWaiting,
  type OthersTasks,
} from "../shared/brought-agents.ts";
import { HostProblemError, type HostProblem } from "../shared/host-problems.ts";
import { replyOf } from "../shared/last-words.ts";
import { isRoomId, MOST_ROOMS_READ } from "../shared/machines.ts";
import type { Conversation, Launch, StoredEvent } from "../shared/model.ts";
import { LONGEST_PERSON_NAME, personName } from "../shared/people.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { broughtTaskPrompt, isRoomAuthorRole, MOST_AGENTS_BROUGHT, ROOM_MESSAGE_MOST_CHARACTERS, type BroughtAnswerEnd, type FramedAuthor } from "../shared/rooms.ts";
import { shownAsWritten } from "../shared/written-text.ts";
import type { Hub } from "./hub.ts";
import { SenderLimit } from "./join-requests.ts";
import type { BroughtTask, Store } from "./store.ts";
import type { SystemNotifications } from "./system-notifications.ts";

/** How long a room's machine has to let an agent in, after which your Mirador gives up on it. */
export const LETTING_IN_MS = 15_000;

/** An answered task is kept this long after its answer, so that one a room's machine sends again is answered again rather than run again. */
export const ANSWERS_KEPT_MS = 24 * 60 * 60_000;

/** What a room's machine may say kept an agent out, which your Mirador passes on; anything else it says counts as not letting it in. */
const REFUSALS_PASSED_ON = ["room-bringing-not-yours", "room-agents-brought-too-many", "room-agent-name-taken", "room-bringing-too-fast"] as const;

/** The machines this computer's owner joined as a person in their rooms, as this host talks to them. */
export interface RoomMachines {
  /** Whether the message went out, on an open socket to the machine. */
  send(machineId: string, message: ClientMessage): boolean;
}

/** The conversations of this computer the agents its owner brought work in. */
export interface BroughtSessions {
  createBroughtIntoRoom(workspaceId: string, launch: Launch, title: string): Conversation;
  send(conversationId: string, text: string, imageIds: string[], options: { fromScript: true; fromMirador: true; afterTurn: true; broughtTaskId: string }): Promise<void>;
  heldTasksChanged(conversationId: string): void;
  dropQueuedBroughtTasks(conversationId: string, taskIds: string[]): void;
}

type Said = Record<string, unknown>;

const saidOf = (value: unknown): Said => (typeof value === "object" && value !== null ? (value as Said) : {});

const agentsListedIn = (room: unknown) => {
  const { agents } = saidOf(room);
  return Array.isArray(agents) ? agents.map(saidOf) : [];
};

/** Why the room's machine says it kept the agent out, when it is one your Mirador knows; otherwise only that it did. */
export function refusalIn(problem: unknown): HostProblem {
  const said = saidOf(problem).code;
  return { code: REFUSALS_PASSED_ON.find((code) => code === said) ?? "room-agent-not-let-in" };
}

/** Who the room's machine says gave a task: a role there is, and a name cleaned as a person's; null for anything else. */
export function taskAuthorIn(name: unknown, role: unknown): FramedAuthor | null {
  if (typeof name !== "string" || !isRoomAuthorRole(role)) return null;
  const shown = personName(shownAsWritten(name.slice(0, LONGEST_PERSON_NAME * 4)));
  return shown ? { role, name: shown } : null;
}

const answerOf = (events: StoredEvent[]) => {
  const { text, ended } = replyOf(events);
  return { text: (text ?? "").slice(0, ROOM_MESSAGE_MOST_CHARACTERS), ended: ended === "finished" ? null : ended };
};

/**
 * The agents this computer's owner brought from their own profiles into rooms of machines they joined as a person, and
 * the tasks those rooms give them. A room's machine is someone else's, so nothing it says is taken as it comes: it
 * names the agent and the task only by ids of its own form, its task's text and author are cleaned and cut, it may send
 * only so many a minute and have only so many waiting, and a task can only become a prompt, written in this host's own
 * words before the room's, in the one conversation of that agent, or a card waiting for the owner's OK there; never a
 * choice of folder, profile, model or permission mode, which are the owner's.
 */
export class BroughtAgents {
  private readonly lettingIn = new Map<string, { settle: (problem: HostProblem | null) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly tasksArriving: SenderLimit;
  /** Who this computer's owner is on each machine, as the machine last said. */
  private readonly you = new Map<string, string>();
  /** The task each conversation's turn under way works on. */
  private readonly turnsOnTasks = new Map<string, string>();
  private holding: ReadonlySet<string>;

  constructor(
    private readonly store: Store,
    private readonly hub: Pick<Hub, "broadcast">,
    private readonly machines: RoomMachines,
    private readonly sessions: BroughtSessions,
    private readonly notifications: Pick<SystemNotifications, "notify">,
    private readonly now: () => number = Date.now,
    private readonly lettingInMs = LETTING_IN_MS,
  ) {
    this.tasksArriving = new SenderLimit(now, MOST_BROUGHT_TASKS_A_MINUTE);
    store.forgetBroughtTasksAnsweredBefore(now() - ANSWERS_KEPT_MS);
    store.forgetBroughtAgentsNotLetIn();
    this.holding = this.conversationsHolding();
  }

  list(): { agents: BroughtAgentHere[]; tasks: BroughtTaskWaiting[] } {
    return { agents: this.store.listBroughtAgents().filter(({ agentId }) => agentId !== null), tasks: this.tasksWaiting() };
  }

  /** The conversations with a task that waits for the owner's OK, which wait for them as for a permission. */
  conversationsHoldingTasks(): ReadonlySet<string> {
    return this.holding;
  }

  /** A task queued in its agent's conversation goes to the agent only while it is sent and unanswered, of an agent still in its room. */
  stillToRun(taskId: string) {
    return this.store.findBroughtTaskById(taskId)?.state === "sent";
  }

  /** Asks the room's machine to let an agent of the profile in, under the profile's name; settles once it answers, or gives up. */
  bring(machineId: string, roomId: string, profileId: string, workspaceId: string, othersTasks: OthersTasks): Promise<void> {
    const machine = this.store.findMachine(machineId);
    const joined = machine?.asPerson === true && machine.joined && this.store.machineRooms(machineId).some(({ id }) => id === roomId);
    const profile = this.store.findProfile(profileId);
    if (!joined || !profile || !this.store.findWorkspace(workspaceId) || !isOthersTasks(othersTasks)) throw new Error("An agent is brought into a room you joined, from one of your profiles, to work in one of your workspaces.");
    if (this.store.findWorkspace(workspaceId)?.sandbox.on) throw new HostProblemError({ code: "brought-agent-in-sandboxed-workspace" });
    if (this.broughtInto(machineId, roomId).length >= MOST_AGENTS_BROUGHT) throw new HostProblemError({ code: "room-agents-brought-too-many" });
    const name = personName(shownAsWritten(profile.name)) || profile.harness;
    const brought: BroughtAgentHere = { id: crypto.randomUUID(), machineId, roomId, agentId: null, profileId, workspaceId, othersTasks, conversationId: null };
    this.store.insertBroughtAgentHere(brought);
    if (!this.machines.send(machineId, { type: "room.bring-agent", requestId: brought.id, roomId, name, harness: profile.harness })) {
      this.store.deleteBroughtAgentHere(brought.id);
      throw new HostProblemError({ code: "room-machine-not-answering" });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settleLettingIn(brought.id, { code: "room-machine-not-answering" }), this.lettingInMs);
      this.lettingIn.set(brought.id, { settle: (problem) => (problem ? reject(new HostProblemError(problem)) : resolve()), timer });
    });
  }

  takeOut(broughtId: string) {
    const brought = this.store.findBroughtAgentHere(broughtId);
    if (!brought) throw new HostProblemError({ code: "brought-agent-gone" });
    if (brought.agentId) this.machines.send(brought.machineId, { type: "room.take-agent-out", roomId: brought.roomId, agentId: brought.agentId });
    this.forget(brought);
  }

  /** The owner's OK for a task someone else gave their agent, which then goes to it, or not, which the room is told. */
  answer(taskId: string, answer: "allow" | "deny") {
    const task = this.store.findBroughtTaskById(taskId);
    if (task?.state !== "waiting") throw new HostProblemError({ code: "brought-task-not-waiting" });
    if (answer === "allow") this.run(task);
    else if (answer === "deny") this.finish(task, "", "refused");
    else throw new Error("A task is allowed or denied.");
    this.changed();
  }

  /** The socket to the machine opened: it is told this host takes the tasks of the owner's agents there. */
  connected(machineId: string) {
    this.machines.send(machineId, { type: "room.brought-agents-here" });
  }

  /** What a machine joined as a person said: whether it let an agent in, a task for one, and its rooms with the agents still in them. */
  heard(machineId: string, message: ServerMessage) {
    const said = saidOf(message);
    switch (message.type) {
      case "snapshot":
        if (typeof said.you === "string") this.you.set(machineId, said.you);
        return this.followRooms(machineId, Array.isArray(said.rooms) ? said.rooms : []);
      case "room.upserted":
        return this.followRoom(machineId, said.room);
      case "room.deleted":
        return this.broughtInto(machineId, said.roomId).forEach((brought) => this.forget(brought));
      case "room.agent-brought":
        return this.agentLetIn(machineId, said);
      case "room.brought-task":
        return this.taskArrived(machineId, said);
    }
  }

  turnStarted(conversationId: string, turnSeq: number) {
    const task = this.taskStarting(conversationId, turnSeq);
    if (!task) return;
    this.turnsOnTasks.set(conversationId, task.id);
    this.tellStarted(task);
  }

  /** The turn on a task ended: its final answer goes to the room, or how it ended without one. */
  turnEnded(conversationId: string, turnSeq: number) {
    this.turnsOnTasks.delete(conversationId);
    const task = this.taskStarting(conversationId, turnSeq);
    if (!task) return;
    const { text, ended } = answerOf(this.store.listEventsFrom(conversationId, turnSeq));
    this.finish(task, text, ended);
  }

  private taskStarting(conversationId: string, turnSeq: number) {
    if (!this.store.listBroughtAgents().some((brought) => brought.conversationId === conversationId)) return undefined;
    const [first] = this.store.listEventsFrom(conversationId, turnSeq);
    const taskId = first?.seq === turnSeq && first.event.type === "user-message" ? first.event.broughtTaskId : undefined;
    return taskId === undefined ? undefined : this.store.findBroughtTaskById(taskId);
  }

  private agentLetIn(machineId: string, said: Said) {
    const { requestId, roomId, agentId, problem } = said;
    const brought = typeof requestId === "string" ? this.store.findBroughtAgentHere(requestId) : undefined;
    const waited = brought?.machineId === machineId && brought.roomId === roomId && brought.agentId === null && this.lettingIn.has(brought.id);
    if (!brought) return isRoomId(roomId) && isRoomId(agentId) && this.machines.send(machineId, { type: "room.take-agent-out", roomId, agentId });
    if (!waited) return;
    if (!isRoomId(agentId) || problem !== null) return this.settleLettingIn(brought.id, refusalIn(problem));
    this.store.setBroughtAgentId(brought.id, agentId);
    this.conversationOf({ ...brought, agentId });
    this.settleLettingIn(brought.id, null);
    this.publish();
  }

  /** Done waiting for the room's machine to let the agent in: one it did not is forgotten. */
  private settleLettingIn(broughtId: string, problem: HostProblem | null) {
    const waiting = this.lettingIn.get(broughtId);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    this.lettingIn.delete(broughtId);
    if (problem && this.store.findBroughtAgentHere(broughtId)?.agentId === null) this.store.deleteBroughtAgentHere(broughtId);
    waiting.settle(problem);
  }

  private taskArrived(machineId: string, said: Said) {
    const { roomId, agentId, taskId, text, byName, byRole, fromYou } = said;
    if (!isRoomId(roomId) || !isRoomId(agentId) || !isRoomId(taskId)) return;
    const known = this.store.findBroughtTask(machineId, taskId);
    if (known) return this.sentAgain(known);
    const brought = this.broughtInto(machineId, roomId).find((each) => each.agentId === agentId);
    const by = taskAuthorIn(byName, byRole);
    const takesIt = brought && by && typeof text === "string" && typeof fromYou === "boolean";
    if (!takesIt || this.store.broughtTasksQueued(brought.id).length >= MOST_BROUGHT_TASKS_QUEUED || !this.tasksArriving.allows(machineId)) {
      this.machines.send(machineId, { type: "room.brought-task-answered", roomId, agentId, taskId, text: "", ended: "refused" });
      return;
    }
    const task: BroughtTask = {
      id: crypto.randomUUID(),
      machineId,
      taskId,
      broughtId: brought.id,
      state: "waiting",
      byName: by.name,
      byRole: by.role,
      text: shownAsWritten(text.slice(0, BROUGHT_TASK_MOST_CHARACTERS)),
      at: this.now(),
      answer: null,
      ended: null,
    };
    this.store.insertBroughtTask(task);
    if (fromYou || brought.othersTasks === "any-time") this.run(task);
    else this.hold(task, brought);
    this.changed();
  }

  /** A task the room's machine sent before, again, e.g. once this host is back: its answer goes again, or that its turn is under way. */
  private sentAgain(task: BroughtTask) {
    if (task.state === "answered") return this.sendAnswer(task);
    const conversationId = this.store.findBroughtAgentHere(task.broughtId)?.conversationId;
    if (task.state === "sent" && conversationId && this.turnsOnTasks.get(conversationId) === task.id) this.tellStarted(task);
  }

  private hold(task: BroughtTask, brought: BroughtAgentHere) {
    const conversationId = this.conversationOf(brought);
    if (!conversationId) return this.finish(task, "", "failed");
    this.notifications.notify(conversationId, { kind: "permission", tool: `a task from ${task.byName}` });
  }

  private run(task: BroughtTask) {
    const brought = this.store.findBroughtAgentHere(task.broughtId);
    const conversationId = brought && this.conversationOf(brought);
    if (!brought || !conversationId) return this.finish(task, "", "failed");
    this.store.setBroughtTaskState(task.id, "sent");
    const prompt = broughtTaskPrompt({ ...this.placeOf(brought), by: { role: task.byRole, name: task.byName }, text: task.text });
    this.sessions.send(conversationId, prompt, [], { fromScript: true, fromMirador: true, afterTurn: true, broughtTaskId: task.id }).catch(() => this.finish(task, "", "failed"));
  }

  /** The task's answer, kept and sent to the room's machine once; one already answered, or of an agent taken out, is left. */
  private finish(task: BroughtTask, text: string, ended: BroughtAnswerEnd | null) {
    const current = this.store.findBroughtTaskById(task.id);
    if (!current || current.state === "answered") return;
    this.store.answerBroughtTask(task.id, text, ended, this.now());
    this.sendAnswer({ ...current, answer: text, ended });
    this.changed();
  }

  private sendAnswer(task: BroughtTask) {
    const brought = this.store.findBroughtAgentHere(task.broughtId);
    if (!brought?.agentId) return;
    this.machines.send(brought.machineId, { type: "room.brought-task-answered", roomId: brought.roomId, agentId: brought.agentId, taskId: task.taskId, text: task.answer ?? "", ended: task.ended });
  }

  private tellStarted(task: BroughtTask) {
    const brought = this.store.findBroughtAgentHere(task.broughtId);
    if (brought?.agentId) this.machines.send(brought.machineId, { type: "room.brought-task-started", roomId: brought.roomId, agentId: brought.agentId, taskId: task.taskId });
  }

  /** The agent's conversation, made anew when there is none; null once its profile or workspace is gone. */
  private conversationOf(brought: BroughtAgentHere): string | null {
    if (brought.conversationId && this.store.hasConversation(brought.conversationId)) return brought.conversationId;
    const profile = this.store.findProfile(brought.profileId);
    if (!profile || !this.store.findWorkspace(brought.workspaceId)) return null;
    const { roomName, machineName } = this.placeOf(brought);
    const { id } = this.sessions.createBroughtIntoRoom(brought.workspaceId, { harness: profile.harness, profileId: profile.id }, `${roomName} · ${machineName}`);
    this.store.setBroughtAgentConversation(brought.id, id);
    this.publish();
    return id;
  }

  /** The room and its machine by this host's own record of them. */
  private placeOf({ machineId, roomId }: BroughtAgentHere) {
    return { roomName: this.store.machineRooms(machineId).find(({ id }) => id === roomId)?.name ?? roomId, machineName: this.store.findMachine(machineId)?.name ?? "" };
  }

  private broughtInto(machineId: string, roomId: unknown) {
    return this.store.listBroughtAgents().filter((brought) => brought.machineId === machineId && brought.roomId === roomId);
  }

  /** The machine's rooms as it lists them, as many as this host reads: an agent no longer in its room is forgotten here, and one the owner brought that this host does not know is taken out. */
  private followRooms(machineId: string, listed: unknown[]) {
    const rooms = listed.slice(0, MOST_ROOMS_READ);
    const roomIds = new Set(rooms.map((room) => saidOf(room).id));
    this.store
      .listBroughtAgents()
      .filter((brought) => brought.machineId === machineId && brought.agentId !== null && !roomIds.has(brought.roomId))
      .forEach((brought) => this.forget(brought));
    rooms.forEach((room) => this.followRoom(machineId, room));
  }

  private followRoom(machineId: string, room: unknown) {
    const roomId = saidOf(room).id;
    if (!isRoomId(roomId)) return;
    const listed = agentsListedIn(room);
    const here = this.broughtInto(machineId, roomId);
    here.filter(({ agentId }) => agentId !== null && !listed.some(({ profileId }) => profileId === agentId)).forEach((brought) => this.forget(brought));
    const you = this.you.get(machineId);
    const lettingInThere = this.store.listBroughtAgents().some((brought) => brought.machineId === machineId && brought.agentId === null);
    if (!you || lettingInThere) return;
    listed
      .filter(({ profileId, brought }) => isRoomId(profileId) && saidOf(brought).personId === you && !here.some(({ agentId }) => agentId === profileId))
      .forEach(({ profileId }) => this.machines.send(machineId, { type: "room.take-agent-out", roomId, agentId: profileId as string }));
  }

  /** The agent is no longer here, nor are its tasks: those queued in its conversation go from there too. */
  private forget(brought: BroughtAgentHere) {
    const unanswered = this.store.broughtTasksQueued(brought.id).map(({ id }) => id);
    this.store.deleteBroughtAgentHere(brought.id);
    if (brought.conversationId) this.sessions.dropQueuedBroughtTasks(brought.conversationId, unanswered);
    this.settleLettingIn(brought.id, { code: "brought-agent-gone" });
    this.changed();
  }

  private tasksWaiting(): BroughtTaskWaiting[] {
    return this.store.broughtTasksWaiting().flatMap((task) => {
      const brought = this.store.findBroughtAgentHere(task.broughtId);
      if (!brought) return [];
      const { id, byName, byRole, text, at } = task;
      return [{ id, broughtId: brought.id, conversationId: brought.conversationId, ...this.placeOf(brought), byName, byRole, text, at }];
    });
  }

  private conversationsHolding() {
    return new Set(this.tasksWaiting().flatMap(({ conversationId }) => conversationId ?? []));
  }

  /** The owner's pages hear of the agents and the tasks waiting, and a conversation that starts or stops holding one waits for them, or not. */
  private changed() {
    const before = this.holding;
    this.holding = this.conversationsHolding();
    [...new Set([...before, ...this.holding])].filter((id) => before.has(id) !== this.holding.has(id)).forEach((id) => this.sessions.heldTasksChanged(id));
    this.publish();
  }

  private publish() {
    this.hub.broadcast({ type: "brought-agents.listed", ...this.list() });
  }
}
