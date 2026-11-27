import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  BROUGHT_TASK_MOST_CHARACTERS,
  isOthersTasks,
  MOST_BROUGHT_TASKS_A_MINUTE,
  MOST_BROUGHT_TASKS_QUEUED,
  worksInRoomsWorkspaces,
  type BroughtAgentHere,
  type BroughtTaskWaiting,
  type OthersTasks,
} from "../shared/brought-agents.ts";
import {
  BROUGHT_ASSETS_ORIGIN_TOKEN,
  broughtAskAnswerIn,
  MOST_BROUGHT_CANVAS_HTML_CHARACTERS,
  MOST_BROUGHT_CANVAS_TITLE_CHARACTERS,
  replaceAssetsOrigins,
  rewriteAskAssets,
  type BroughtCanvasAskPayload,
} from "../shared/brought-canvas.ts";
import { HostProblemError, type HostProblem } from "../shared/host-problems.ts";
import { replyOf } from "../shared/last-words.ts";
import { isRoomId, MOST_ROOMS_READ } from "../shared/machines.ts";
import type { AskItem, Conversation, Launch, ShowItem, StoredEvent } from "../shared/model.ts";
import { authorNameIn, personName } from "../shared/people.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { endsTurn } from "../shared/reverts.ts";
import { MOST_WORKSPACE_CALLS_A_MINUTE, MOST_WORKSPACE_CALLS_AT_ONCE, WORKSPACE_TASK_MS, workspaceCallResultIn, type WorkspaceCall, type WorkspaceCallResult } from "../shared/room-workspace.ts";
import { broughtTaskPrompt, isRoomAuthorRole, MOST_AGENTS_BROUGHT, ROOM_MESSAGE_MOST_CHARACTERS, type BroughtAnswerEnd, type FramedAuthor } from "../shared/rooms.ts";
import { shownAsWritten } from "../shared/written-text.ts";
import type { CanvasService } from "./canvas/service.ts";
import type { Hub } from "./hub.ts";
import { SenderLimit } from "./join-requests.ts";
import { isInside, realOrAsIs } from "./sandbox/paths-on-disk.ts";
import type { BroughtTask, Store } from "./store.ts";
import type { SystemNotifications } from "./system-notifications.ts";

/** Where the agents that work in rooms' workspaces start: a folder for each such room, with nothing in it. */
export const broughtAgentsFolder = (dataDir: string) => join(dataDir, "brought-agents");

/** Whether the folder is one of those, whichever way its path leads there. */
export const isForBroughtAgents = async (dataDir: string, folder: string) => isInside(await realOrAsIs(folder), await realOrAsIs(broughtAgentsFolder(dataDir)));

/** How long a room's machine has to let an agent in, after which your Mirador gives up on it. */
export const LETTING_IN_MS = 15_000;

/** An answered task is kept this long after its answer, so that one a room's machine sends again is answered again rather than run again. */
export const ANSWERS_KEPT_MS = 24 * 60 * 60_000;

/** How long past the time a room's machine gives a task your Mirador waits for it to answer a call in its workspace. */
const ANSWER_LATE_MS = 60_000;

const NOT_ON_A_TASK = "You work in the room's workspace only during a turn on a task the room gave you.";
const NOT_ANSWERING = "The room's machine isn't answering, so nothing was done.";
const CONNECTION_LOST = "The connection to the room's machine was lost before it answered, so this may or may not have been done: read what is there before you try again.";
const ANSWER_UNREADABLE = "The room's machine answered with nothing that can be read.";
const TURN_OVER = "Your turn ended before the room's machine answered.";
const OUT_OF_THE_ROOM = "You are no longer in the room.";
const NO_ANSWER_IN_TIME = "The room's machine didn't answer in time.";
const TIME_IS_OVER = "This task's time in the room's workspace is over, so nothing was done.";
const TOO_MANY_AT_ONCE = `Only ${MOST_WORKSPACE_CALLS_AT_ONCE} calls of yours wait or run at a time; let one of them end first.`;
const TOO_MANY_A_MINUTE = "You make too many calls; wait a minute.";

const callRefused = (text: string): WorkspaceCallResult => ({ done: false, text });

/** A call of an agent you brought on its way to the workspace of its room, until the room's machine answers. */
interface WorkspaceCallUnderWay {
  broughtId: string;
  conversationId: string;
  machineId: string;
  roomId: string;
  agentId: string;
  settle(result: WorkspaceCallResult): void;
}

/** What a room's machine may say kept an agent out, which your Mirador passes on; anything else it says counts as not letting it in. */
const REFUSALS_PASSED_ON = ["room-gone", "room-bringing-not-yours", "room-agents-brought-too-many", "room-agent-name-taken", "room-bringing-too-fast"] as const;

/** The machines this computer's owner joined as a person in their rooms, as this host talks to them. */
export interface RoomMachines {
  /** Whether the message went out, on an open socket to the machine. */
  send(machineId: string, message: ClientMessage): boolean;
}

/** The conversations of this computer the agents its owner brought work in. */
export interface BroughtSessions {
  createBroughtIntoRoom(workspaceId: string, launch: Launch, title: string, inRoomsWorkspace: boolean): Conversation;
  send(conversationId: string, text: string, imageIds: string[], options: { fromScript: true; fromMirador: true; afterTurn: true; broughtTaskId: string }): Promise<void>;
  heldTasksChanged(conversationId: string): void;
  dropQueuedBroughtTasks(conversationId: string, taskIds: string[]): void;
  broughtTasksInHand(conversationId: string): string[];
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

/** Who the room's machine says gave a task: a role there is, and a name as `authorNameIn` cleans it; null for anything else. */
export function taskAuthorIn(name: unknown, role: unknown): FramedAuthor | null {
  const shown = authorNameIn(name);
  return shown && isRoomAuthorRole(role) ? { role, name: shown } : null;
}

const answerOf = (events: StoredEvent[]) => {
  const { text, ended } = replyOf(events);
  return { text: (text ?? "").slice(0, ROOM_MESSAGE_MOST_CHARACTERS), ended: ended === "finished" ? null : ended };
};

/** The events up to the end of the turn they begin with, so that none of the turns after it is told. */
const firstTurnOf = (events: StoredEvent[]) => {
  const end = events.findIndex(endsTurn);
  return end === -1 ? events : events.slice(0, end + 1);
};

/**
 * The agents this computer's owner brought from their own profiles into rooms of machines they joined as a person, and
 * the tasks those rooms give them. A room's machine is someone else's, so nothing it says is taken as it comes: it
 * names the agent and the task only by ids of its own form, its task's text and author are cleaned and cut, it may send
 * only so many a minute and have only so many waiting, and a task can only become a prompt, written in this host's own
 * words before the room's, in the one conversation of that agent, or a card waiting for the owner's OK there; never a
 * choice of folder, profile, model or permission mode, which are the owner's. An agent brought to work in the room's
 * workspace has nothing of this computer at all, as that machine's files and commands speak to it directly.
 */
export class BroughtAgents {
  private readonly lettingIn = new Map<string, { settle: (problem: HostProblem | null) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly tasksArriving: SenderLimit;
  private readonly workspaceCallsMade: SenderLimit;
  /** Who this computer's owner is on each machine, as the machine last said. */
  private readonly you = new Map<string, string>();
  /** The task each conversation's turn under way works on, and since when. */
  private readonly turnsOnTasks = new Map<string, { taskId: string; since: number }>();
  private readonly workspaceCalls = new Map<string, WorkspaceCallUnderWay>();
  private readonly forwardedAsks = new Map<string, { broughtId: string; machineId: string; roomId: string; agentId: string }>();
  private canvas: Pick<CanvasService, "answer" | "hasWaiter"> | null = null;
  private holding: ReadonlySet<string>;

  constructor(
    private readonly store: Store,
    private readonly hub: Pick<Hub, "broadcast">,
    private readonly machines: RoomMachines,
    private readonly sessions: BroughtSessions,
    private readonly notifications: Pick<SystemNotifications, "notify">,
    private readonly emptyFolders: string,
    private readonly now: () => number = Date.now,
    private readonly lettingInMs = LETTING_IN_MS,
    private readonly canvasAssetsOrigins: readonly string[] = [],
  ) {
    this.tasksArriving = new SenderLimit(now, MOST_BROUGHT_TASKS_A_MINUTE);
    this.workspaceCallsMade = new SenderLimit(now, MOST_WORKSPACE_CALLS_A_MINUTE);
    store.forgetBroughtTasksAnsweredBefore(now() - ANSWERS_KEPT_MS);
    store.forgetBroughtAgentsNotLetIn();
    this.holding = this.conversationsHolding();
  }

  list(): { agents: BroughtAgentHere[]; tasks: BroughtTaskWaiting[] } {
    return { agents: this.store.listBroughtAgents().filter(({ agentId }) => agentId !== null), tasks: this.tasksWaiting() };
  }

  /** After this computer names a machine again: the tasks waiting say which machine they came from by its new name. */
  relabeled() {
    this.publish();
  }

  /** The conversations with a task that waits for the owner's OK, which wait for them as for a permission. */
  conversationsHoldingTasks(): ReadonlySet<string> {
    return this.holding;
  }

  /** A task queued in its agent's conversation goes to the agent only while it is sent and unanswered, of an agent still in its room. */
  stillToRun(taskId: string) {
    return this.store.findBroughtTaskById(taskId)?.state === "sent";
  }

  /**
   * Answers the tasks the conversation was given and has in hand no longer, as after a restart that did not continue their
   * turn, or once the owner takes them out of its queue or deletes it; those that wait for an OK there go with it too.
   */
  settleLost(conversationId: string) {
    const deleted = !this.store.hasConversation(conversationId);
    const inHand = this.sessions.broughtTasksInHand(conversationId);
    const isLost = ({ id, state }: BroughtTask) => deleted || (state !== "waiting" && !inHand.includes(id));
    this.store
      .listBroughtAgents()
      .filter((brought) => brought.conversationId === conversationId)
      .flatMap(({ id }) => this.store.broughtTasksQueued(id))
      .filter(isLost)
      .forEach((task) => {
        const { text, ended } = this.lostAnswer(conversationId, task);
        this.finish(task, text, ended);
      });
  }

  /**
   * Asks the room's machine to let an agent of the profile in, under the profile's name, to work in the workspace, or in
   * the room's where it is null; settles once it answers, or gives up.
   */
  bring(machineId: string, roomId: string, profileId: string, workspaceId: string | null, othersTasks: OthersTasks): Promise<void> {
    const machine = this.store.findMachine(machineId);
    const joined = machine?.asPerson === true && machine.joined && this.store.machineRooms(machineId).some(({ id }) => id === roomId);
    const profile = this.store.findProfile(profileId);
    const workspace = workspaceId === null ? null : this.store.findWorkspace(workspaceId);
    if (!joined || !profile || workspace === undefined || workspace?.forBroughtAgents || !isOthersTasks(othersTasks)) throw new Error("An agent is brought into a room you joined, from one of your profiles, to work in one of your workspaces or the room's.");
    if (workspace?.sandbox.on) throw new HostProblemError({ code: "brought-agent-in-sandboxed-workspace" });
    if (workspace === null && !worksInRoomsWorkspaces(profile.harness)) throw new HostProblemError({ code: "agent-cannot-work-in-rooms-workspace" });
    if (this.broughtInto(machineId, roomId).length >= MOST_AGENTS_BROUGHT) throw new HostProblemError({ code: "room-agents-brought-too-many" });
    const name = personName(shownAsWritten(profile.name)) || profile.harness;
    const brought: BroughtAgentHere = { id: crypto.randomUUID(), machineId, roomId, agentId: null, profileId, workspaceId, othersTasks, conversationId: null };
    this.store.insertBroughtAgentHere(brought);
    if (!this.machines.send(machineId, { type: "room.bring-agent", requestId: brought.id, roomId, name, harness: profile.harness, worksInRoom: workspace === null })) {
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

  takeOutOf(machineId: string, roomId: string) {
    this.broughtInto(machineId, roomId).forEach(({ id }) => this.takeOut(id));
  }

  /** The socket to the machine opened: it is told this host takes the tasks of the owner's agents there. */
  connected(machineId: string) {
    this.machines.send(machineId, { type: "room.brought-agents-here" });
  }

  /** The socket to the machine closed, so what it would have answered is not coming. */
  disconnected(machineId: string) {
    this.endWorkspaceCalls((call) => call.machineId === machineId, CONNECTION_LOST);
  }

  /** The machine is gone or signed this computer out: forget every agent brought there and drop their queued tasks. */
  forgotMachine(machineId: string) {
    this.you.delete(machineId);
    this.endWorkspaceCalls((call) => call.machineId === machineId, OUT_OF_THE_ROOM);
    const here = this.store.listBroughtAgents().filter((brought) => brought.machineId === machineId);
    here.forEach((brought) => this.forget(brought));
    if (here.length === 0) this.changed();
  }

  /**
   * Has the room's machine do what the agent of the conversation asks in the room's workspace, only in a turn on a task
   * of the room's, and tells the agent what that machine says came of it. That machine's limits are its own to keep, so
   * this host keeps them too: no room keeps an agent calling, at its bringer's cost, for longer or faster than they allow.
   */
  async callInWorkspace(conversationId: string, call: WorkspaceCall, signal: AbortSignal): Promise<WorkspaceCallResult> {
    const turn = this.turnsOnTasks.get(conversationId);
    const task = turn && this.store.findBroughtTaskById(turn.taskId);
    const brought = task?.state === "sent" ? this.store.findBroughtAgentHere(task.broughtId) : undefined;
    if (!turn || !task || !brought?.agentId || brought.workspaceId !== null || signal.aborted) return callRefused(NOT_ON_A_TASK);
    const { id: broughtId, machineId, roomId, agentId } = brought;
    if (this.now() - turn.since > WORKSPACE_TASK_MS) return callRefused(TIME_IS_OVER);
    if (this.callsUnderWay(conversationId) >= MOST_WORKSPACE_CALLS_AT_ONCE) return callRefused(TOO_MANY_AT_ONCE);
    if (!this.workspaceCallsMade.allows(machineId)) return callRefused(TOO_MANY_A_MINUTE);
    const callId = crypto.randomUUID();
    if (!this.machines.send(machineId, { type: "room.workspace-call", roomId, agentId, taskId: task.taskId, callId, call })) return callRefused(NOT_ANSWERING);
    return new Promise((resolve) => {
      const giveUp = (why: string) => {
        this.machines.send(machineId, { type: "room.workspace-call-stopped", roomId, agentId, callId });
        this.workspaceCalls.get(callId)?.settle(callRefused(why));
      };
      const turnStopped = () => giveUp(TURN_OVER);
      const timer = setTimeout(() => giveUp(NO_ANSWER_IN_TIME), WORKSPACE_TASK_MS + ANSWER_LATE_MS);
      signal.addEventListener("abort", turnStopped, { once: true });
      const settle = (result: WorkspaceCallResult) => {
        if (!this.workspaceCalls.delete(callId)) return;
        clearTimeout(timer);
        signal.removeEventListener("abort", turnStopped);
        resolve(result);
      };
      this.workspaceCalls.set(callId, { broughtId, conversationId, machineId, roomId, agentId, settle });
    });
  }

  /** Delivers confirmed room answers for brought agents' questions to their local canvas service. */
  answersCanvasWith(canvas: Pick<CanvasService, "answer" | "hasWaiter">) {
    this.canvas = canvas;
  }

  /** Forwards a page drawn by a brought agent during an active room task onto the room's shared canvas. */
  forwardShow(conversationId: string, item: ShowItem): boolean {
    const active = this.activeBroughtTask(conversationId);
    if (!active || !item.html) return false;
    const { brought, task } = active;
    const title = item.title.slice(0, MOST_BROUGHT_CANVAS_TITLE_CHARACTERS);
    const html = replaceAssetsOrigins(item.html, this.canvasAssetsOrigins, BROUGHT_ASSETS_ORIGIN_TOKEN);
    if (html.length > MOST_BROUGHT_CANVAS_HTML_CHARACTERS) return false;
    return this.machines.send(brought.machineId, {
      type: "room.brought-canvas-show",
      roomId: brought.roomId,
      agentId: brought.agentId!,
      taskId: task.taskId,
      itemId: item.id,
      title,
      html,
    });
  }

  /** Forwards a question asked by a brought agent during an active room task onto the room's canvas for room voting. */
  forwardAsk(conversationId: string, item: AskItem): boolean {
    const active = this.activeBroughtTask(conversationId);
    if (!active) return false;
    const { brought, task } = active;
    const payload: BroughtCanvasAskPayload = rewriteAskAssets(
      {
        title: item.title.slice(0, MOST_BROUGHT_CANVAS_TITLE_CHARACTERS),
        question: (item.question ?? item.title).slice(0, MOST_BROUGHT_CANVAS_TITLE_CHARACTERS),
        ...(item.html !== undefined && { html: item.html }),
        ...(item.options !== undefined && { options: item.options }),
        allowOther: true,
        ...(item.optionWidth !== undefined && { optionWidth: item.optionWidth }),
        ...(item.questions !== undefined && {
          questions: item.questions.map((each) => ({
            question: each.question.slice(0, MOST_BROUGHT_CANVAS_TITLE_CHARACTERS),
            ...(each.html !== undefined && { html: each.html }),
            options: each.options,
            allowOther: true,
            ...(each.optionWidth !== undefined && { optionWidth: each.optionWidth }),
          })),
        }),
        ...(item.shownBefore !== undefined && item.shownBefore.length > 0 && { shownBefore: item.shownBefore }),
      },
      this.canvasAssetsOrigins,
      BROUGHT_ASSETS_ORIGIN_TOKEN,
    );
    const sent = this.machines.send(brought.machineId, {
      type: "room.brought-canvas-ask",
      roomId: brought.roomId,
      agentId: brought.agentId!,
      taskId: task.taskId,
      itemId: item.id,
      ask: payload,
    });
    if (sent) this.forwardedAsks.set(item.id, { broughtId: brought.id, machineId: brought.machineId, roomId: brought.roomId, agentId: brought.agentId! });
    return sent;
  }

  /** Tells the room's machine that a brought agent's waiting question was cancelled locally. */
  cancelAsk(_conversationId: string, itemId: string) {
    const forwarded = this.forwardedAsks.get(itemId);
    if (!forwarded) return;
    this.forwardedAsks.delete(itemId);
    this.machines.send(forwarded.machineId, { type: "room.brought-canvas-cancel", roomId: forwarded.roomId, agentId: forwarded.agentId, itemId });
  }

  private activeBroughtTask(conversationId: string) {
    const turn = this.turnsOnTasks.get(conversationId);
    const task = turn && this.store.findBroughtTaskById(turn.taskId);
    const brought = task?.state === "sent" ? this.store.findBroughtAgentHere(task.broughtId) : undefined;
    return brought?.agentId && task ? { brought, task } : null;
  }

  /** What a machine joined as a person said: whether it let an agent in, a task for one, how a call in its workspace came out, and its rooms with the agents still in them. */
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
      case "room.brought-ask-answered":
        return this.askAnswered(machineId, said);
      case "room.workspace-answered":
        return this.workspaceAnswered(machineId, said);
    }
  }

  turnStarted(conversationId: string, turnSeq: number) {
    const task = this.taskStarting(conversationId, turnSeq);
    if (!task) return;
    this.turnsOnTasks.set(conversationId, { taskId: task.id, since: this.now() });
    this.tellStarted(task);
  }

  /** The turn on a task ended: its final answer goes to the room, or how it ended without one. */
  turnEnded(conversationId: string, turnSeq: number) {
    this.turnsOnTasks.delete(conversationId);
    this.stopWorkspaceCalls((call) => call.conversationId === conversationId);
    const task = this.taskStarting(conversationId, turnSeq);
    if (!task) return;
    const { text, ended } = answerOf(this.store.listEventsFrom(conversationId, turnSeq));
    this.finish(task, text, ended);
  }

  /** What came of a task no turn is left to answer: of the last turn on it, or that it was not taken where none began. */
  private lostAnswer(conversationId: string, task: BroughtTask): { text: string; ended: BroughtAnswerEnd | null } {
    const began = this.store.listEventsOfTypes(conversationId, ["user-message"]).findLast(({ event }) => event.type === "user-message" && event.broughtTaskId === task.id);
    if (began) {
      const turn = firstTurnOf(this.store.listEventsFrom(conversationId, began.seq));
      return turn.some(endsTurn) ? answerOf(turn) : { ...answerOf(turn), ended: "stopped" };
    }
    return { text: "", ended: this.turnsOnTasks.get(conversationId)?.taskId === task.id ? "stopped" : "refused" };
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

  /** A task the room's machine sent before, again, e.g. once this host is back: its answer goes again while still kept, one forgotten never runs again, and one running says so. */
  private sentAgain(task: BroughtTask) {
    if (task.state === "forgotten") return;
    if (task.state === "answered") return this.sendAnswer(task);
    const conversationId = this.store.findBroughtAgentHere(task.broughtId)?.conversationId;
    if (task.state === "sent" && conversationId && this.turnsOnTasks.get(conversationId)?.taskId === task.id) this.tellStarted(task);
  }

  private hold(task: BroughtTask, brought: BroughtAgentHere) {
    const conversationId = this.conversationOf(brought);
    if (!conversationId) return this.finish(task, "", "failed");
    this.notifications.notify(conversationId, { kind: "permission", ask: { kind: "task", by: task.byName } });
  }

  private run(task: BroughtTask) {
    const brought = this.store.findBroughtAgentHere(task.broughtId);
    const conversationId = brought && this.conversationOf(brought);
    if (!brought || !conversationId) return this.finish(task, "", "failed");
    this.store.setBroughtTaskState(task.id, "sent");
    const prompt = broughtTaskPrompt({ ...this.placeOf(brought), by: { role: task.byRole, name: task.byName }, text: task.text, inRoomsWorkspace: brought.workspaceId === null });
    this.sessions.send(conversationId, prompt, [], { fromScript: true, fromMirador: true, afterTurn: true, broughtTaskId: task.id }).catch(() => this.finish(task, "", "failed"));
  }

  private workspaceAnswered(machineId: string, { roomId, agentId, callId, result }: Said) {
    const call = typeof callId === "string" ? this.workspaceCalls.get(callId) : undefined;
    if (call?.machineId !== machineId || call.roomId !== roomId || call.agentId !== agentId) return;
    call.settle(workspaceCallResultIn(result) ?? callRefused(ANSWER_UNREADABLE));
  }

  private askAnswered(machineId: string, { roomId, agentId, itemId, answer }: Said) {
    if (!this.canvas || !isRoomId(roomId) || !isRoomId(agentId) || !isRoomId(itemId)) return;
    const brought = this.broughtInto(machineId, roomId).find((each) => each.agentId === agentId);
    if (!brought?.conversationId) return;
    const item = this.store.findCanvasItem(itemId);
    if (!item || item.conversationId !== brought.conversationId || item.kind !== "ask" || item.status !== "waiting") return;
    const cleaned = broughtAskAnswerIn(answer);
    if (!cleaned) return;
    this.forwardedAsks.delete(itemId);
    let followUpLocalId: string | undefined;
    if (!this.canvas.hasWaiter(itemId) && cleaned.followUpTaskId) {
      const existing = this.store.findBroughtTask(machineId, cleaned.followUpTaskId);
      if (existing) {
        followUpLocalId = existing.id;
      } else {
        const task: BroughtTask = {
          id: crypto.randomUUID(),
          machineId,
          taskId: cleaned.followUpTaskId,
          broughtId: brought.id,
          state: "sent",
          byName: cleaned.answerer?.author.name ?? "",
          byRole: cleaned.answerer?.author.role ?? "owner",
          text: cleaned.label,
          at: this.now(),
          answer: null,
          ended: null,
        };
        this.store.insertBroughtTask(task);
        followUpLocalId = task.id;
      }
    }
    this.canvas.answer(itemId, { label: cleaned.label }, cleaned.answers, undefined, cleaned.answerer, followUpLocalId);
  }

  private callsUnderWay(conversationId: string) {
    return [...this.workspaceCalls.values()].filter((call) => call.conversationId === conversationId).length;
  }

  private endWorkspaceCalls(which: (call: WorkspaceCallUnderWay) => boolean, why: string) {
    [...this.workspaceCalls.values()].filter(which).forEach(({ settle }) => settle(callRefused(why)));
  }

  /** The room's machine hears that they are no longer wanted. */
  private stopWorkspaceCalls(which: (call: WorkspaceCallUnderWay) => boolean) {
    [...this.workspaceCalls]
      .filter(([, call]) => which(call))
      .forEach(([callId, { machineId, roomId, agentId }]) => this.machines.send(machineId, { type: "room.workspace-call-stopped", roomId, agentId, callId }));
    this.endWorkspaceCalls(which, TURN_OVER);
  }

  /** The task's answer, kept and sent to the room's machine once; one already answered, or of an agent taken out, is left. */
  private finish(task: BroughtTask, text: string, ended: BroughtAnswerEnd | null) {
    const current = this.store.findBroughtTaskById(task.id);
    if (!current || current.state === "answered" || current.state === "forgotten") return;
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

  /** The agent's conversation, made anew when there is none; null once its profile or its workspace of yours is gone. */
  private conversationOf(brought: BroughtAgentHere): string | null {
    if (brought.conversationId && this.store.hasConversation(brought.conversationId)) return brought.conversationId;
    const profile = this.store.findProfile(brought.profileId);
    if (!profile || (brought.workspaceId !== null && !this.store.findWorkspace(brought.workspaceId))) return null;
    const inRoomsWorkspace = brought.workspaceId === null;
    const launch = { harness: profile.harness, profileId: profile.id };
    const workspaceId = brought.workspaceId ?? this.emptyWorkspaceFor(brought, launch);
    const { id } = this.sessions.createBroughtIntoRoom(workspaceId, launch, this.titleOf(brought), inRoomsWorkspace);
    this.store.setBroughtAgentConversation(brought.id, id);
    this.publish();
    return id;
  }

  /** The workspace that shows the conversations of the agents that work in the room's: named as they are, its folder empty. */
  private emptyWorkspaceFor(brought: BroughtAgentHere, defaultLaunch: Launch): string {
    const path = join(this.emptyFolders, `${brought.machineId}-${brought.roomId}`);
    mkdirSync(path, { recursive: true });
    const existing = this.store.findWorkspaceByPath(path);
    if (existing) return existing.id;
    const workspace = this.store.insertWorkspace({ id: crypto.randomUUID(), name: this.titleOf(brought), path, defaultLaunch, createdAt: this.now(), forBroughtAgents: true });
    this.hub.broadcast({ type: "workspace.upserted", workspace });
    return workspace.id;
  }

  private titleOf(brought: BroughtAgentHere) {
    const { roomName, machineName } = this.placeOf(brought);
    return `${roomName} · ${machineName}`;
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
    this.endWorkspaceCalls((call) => call.broughtId === brought.id, OUT_OF_THE_ROOM);
    for (const [itemId, forwarded] of this.forwardedAsks) {
      if (forwarded.broughtId === brought.id) this.forwardedAsks.delete(itemId);
    }
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
