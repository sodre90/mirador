import { HostProblemError } from "../../shared/host-problems.ts";
import { commandShown, everyCharacterShown } from "../../shared/written-text.ts";
import type { BroughtAgent, Room, RoomMessage, RoomThread } from "../../shared/rooms.ts";
import {
  MOST_WORKSPACE_CALLS_A_MINUTE,
  MOST_WORKSPACE_CALLS_AT_ONCE,
  WORKSPACE_ABOUT_KEPT_CHARACTERS,
  WORKSPACE_CALL_KEPT_CHARACTERS,
  WORKSPACE_TASK_MS,
  type RoomWorkspaceCall,
  type WorkspaceCall,
  type WorkspaceCallNamed,
  type WorkspaceCallResult,
  type WorkspaceCallState,
} from "../../shared/room-workspace.ts";
import type { Hub } from "../hub.ts";
import { SenderLimit } from "../join-requests.ts";
import type { RoomBroughtTask, Store } from "../store.ts";
import { WorkspaceCallRefused, type FileChange } from "../sandbox/in-vm/workspace-files.ts";
import { commandRun } from "./commands.ts";
import { changeAskedFor, changeMade, diffOf, proposedDiffOf, readInWorkspace } from "./files.ts";
import type { WorkspacePlace } from "./workspace-place.ts";

/** A call as a person's Mirador sent it: which of its agents makes it, for which task. */
export interface WorkspaceCallSent {
  personId: string;
  roomId: string;
  agentId: string;
  taskId: string;
  callId: string;
  call: WorkspaceCall;
}

/** A call that waits for an approver, or runs: as it was sent, and as the room shows it. */
export interface WorkspaceCallUnderWay {
  sent: WorkspaceCallSent;
  shown: RoomWorkspaceCall;
  /** The whole of what it would do, for whoever allows it. */
  whole: string;
  messageId: string;
  change: FileChange | null;
  /** Where it was asked for, and the only place it is done. */
  place: WorkspacePlace;
  inSandbox: boolean;
  stopping: AbortController;
  overAt: ReturnType<typeof setTimeout>;
}

/** What a room gives its workspace's calls: the thread an agent answers a task in, and that what waits for its approvers changed. */
export interface RoomOfCalls {
  threadOf(asked: RoomMessage, agentId: string): RoomThread | undefined;
  waitingChanged(roomId: string): void;
  callWaits(room: Room, agentId: string): void;
  /** Where the agent works in the room's workspace: on this computer, or in the room's sandbox and nowhere else; null where the workspace is gone. */
  placeOf(room: Room, agentId: string): WorkspacePlace | null;
}

const NOT_LET_IN = "The room's owner or an approver has not let you work in its workspace.";
const NOT_LET_THROUGH = "Nobody who approves in the room let this task through, so nothing in its workspace is open to you for it. Say so in your answer; a follow-up of the owner or an approver opens it.";
const TIME_IS_OVER = "The time for this task in the room's workspace is over.";
const STOPPED = "It was stopped.";
const DENIED = "Whoever approves in the room said no.";

const refusal = (text: string): WorkspaceCallResult => ({ done: false, text });

const namedIn = (call: WorkspaceCall): WorkspaceCallNamed => ({ kind: call.kind, about: call.kind === "run" ? commandShown(call.command) : everyCharacterShown(call.path) });

/**
 * Every edit and command asks, whatever the room's preset lets its own agents do: no model need be behind it. A read asks
 * only where everything does. In the room's sandbox nothing asks where its owner lets agents work freely there.
 */
const asksFirst = (call: WorkspaceCall, { permissions, sandbox }: Room) => !(sandbox.on && sandbox.workFreely) && (call.kind !== "read" || permissions === "ask-everything");

const readsAskFirst = ({ permissions, sandbox }: Room) => !(sandbox.on && sandbox.workFreely) && permissions === "ask-everything";

const kept = (text: string, most = WORKSPACE_CALL_KEPT_CHARACTERS) => (text.length <= most ? text : `${text.slice(0, most / 2)}\n…\n${text.slice(-most / 2)}`);

/**
 * What the agents people brought have done in the rooms' workspaces on this machine. Each call comes from another
 * person's computer, with perhaps no model behind it, so nothing is taken as it comes: it is done only for an agent of
 * theirs that the owner or an approver let into the workspace, for a task one of them wrote or allowed, that the agent
 * has not answered, within the time this machine gives it; each edit and command only once one of them allowed it.
 */
export class RoomWorkspaceCalls {
  private readonly underWay = new Map<string, WorkspaceCallUnderWay>();
  /** Calls whose change is still worked out, each with what stops that. */
  private readonly beingPrepared = new Map<WorkspaceCallSent, AbortController>();
  private readonly calling: SenderLimit;

  constructor(
    private readonly store: Store,
    private readonly hub: Pick<Hub, "sendToAgentsOf" | "publishToRoom">,
    private readonly room: RoomOfCalls,
    private readonly now: () => number = Date.now,
  ) {
    this.calling = new SenderLimit(now, MOST_WORKSPACE_CALLS_A_MINUTE);
    store.stopWorkspaceCallsUnderWay();
  }

  waitingIn(roomId: string): WorkspaceCallUnderWay[] {
    return [...this.underWay.values()].filter(({ shown }) => shown.roomId === roomId && shown.state === "waiting");
  }

  /** Does the call, once it is allowed where it asks; its result goes to the person's Mirador, why it was refused too. */
  async called(sent: WorkspaceCallSent) {
    try {
      await this.begin(sent);
    } catch (error) {
      this.tell(sent, refusal(this.whyRefused(error)));
    }
  }

  /** Its bringer's Mirador no longer wants it. */
  stopped({ personId, roomId, agentId, callId }: Omit<WorkspaceCallSent, "taskId" | "call">) {
    this.endAll((sent) => sent.personId === personId && sent.roomId === roomId && sent.agentId === agentId && sent.callId === callId);
  }

  /** An approver's answer, which the caller checked is theirs to give. */
  answer(roomId: string, id: string, answer: "allow" | "deny", approverId: string) {
    const call = this.underWay.get(id);
    if (call?.shown.roomId !== roomId || call.shown.state !== "waiting") throw new HostProblemError({ code: "permission-no-longer-pending" });
    call.shown = { ...call.shown, answeredBy: approverId };
    if (answer === "deny") return this.end(call, "denied", refusal(DENIED));
    try {
      this.assertOpen(call.sent);
    } catch (error) {
      return this.end(call, "refused", refusal(this.whyRefused(error)));
    }
    void this.run(call);
  }

  /** Nothing of these calls goes on: what waits no longer does, and what runs is stopped. */
  endAll(which: (sent: WorkspaceCallSent) => boolean) {
    this.beingPrepared.forEach((stopping, sent) => which(sent) && stopping.abort());
    [...this.underWay.values()].filter(({ sent }) => which(sent)).forEach((call) => this.stop(call, STOPPED));
  }

  shutdown() {
    this.endAll(() => true);
  }

  private async begin(sent: WorkspaceCallSent) {
    const { call } = sent;
    const { room: openRoom } = this.assertOpen(sent);
    if (this.under(sent)) return;
    if (!this.calling.allows(sent.personId)) throw new WorkspaceCallRefused("Your agents make too many calls; wait a minute.");
    if (this.madeBy(sent) >= MOST_WORKSPACE_CALLS_AT_ONCE) throw new WorkspaceCallRefused(`Only ${MOST_WORKSPACE_CALLS_AT_ONCE} calls of yours wait or run at a time; let one of them end first.`);
    const place = this.room.placeOf(openRoom, sent.agentId);
    if (!place) throw new WorkspaceCallRefused("The room's workspace is not there.");
    const preparesBeforeAsking = (call.kind === "edit" || call.kind === "write") && !readsAskFirst(openRoom);
    const change = preparesBeforeAsking ? await this.prepared(sent, (stopped) => changeAskedFor(call, place, stopped)) : null;
    const diff = change ? everyCharacterShown(diffOf(change)) : call.kind === "edit" || call.kind === "write" ? everyCharacterShown(proposedDiffOf(call)) : null;
    const { room, asked, thread, until } = this.assertOpen(sent);
    const asks = asksFirst(call, room);
    const named = namedIn(call);
    const shown: RoomWorkspaceCall = { id: crypto.randomUUID(), roomId: room.id, agentId: sent.agentId, threadId: thread.id, at: this.now(), kind: call.kind, about: kept(named.about, WORKSPACE_ABOUT_KEPT_CHARACTERS), state: asks ? "waiting" : "running", diff: diff && kept(diff), result: null, answeredBy: null };
    const overAt = setTimeout(() => this.stop(underWay, TIME_IS_OVER), until - this.now());
    const underWay: WorkspaceCallUnderWay = { sent, shown, whole: diff ?? named.about, messageId: asked.id, change, place, inSandbox: room.sandbox.on, stopping: new AbortController(), overAt };
    this.underWay.set(shown.id, underWay);
    this.store.insertWorkspaceCall(shown);
    this.hub.publishToRoom(room.id, { type: "room.workspace-call-shown", call: shown });
    if (!asks) return this.run(underWay);
    this.room.waitingChanged(room.id);
    this.room.callWaits(room, sent.agentId);
  }

  private async prepared<T>(sent: WorkspaceCallSent, prepare: (stopped: AbortSignal) => Promise<T>): Promise<T> {
    const stopping = new AbortController();
    this.beingPrepared.set(sent, stopping);
    try {
      const prepared = await prepare(stopping.signal);
      if (stopping.signal.aborted) throw new WorkspaceCallRefused(STOPPED);
      return prepared;
    } finally {
      this.beingPrepared.delete(sent);
    }
  }

  private async run(call: WorkspaceCallUnderWay) {
    const asked = call.shown.state === "waiting";
    this.show(call, "running");
    if (asked) this.room.waitingChanged(call.shown.roomId);
    try {
      const result = await this.resultOf(call);
      const isChange = call.sent.call.kind === "edit" || call.sent.call.kind === "write";
      if (call.stopping.signal.aborted && !isChange) this.end(call, "stopped", refusal(STOPPED), result.text);
      else this.end(call, result.done ? "done" : "refused", result);
    } catch (error) {
      this.end(call, call.stopping.signal.aborted ? "stopped" : "refused", refusal(this.whyRefused(error)));
    }
  }

  /** What waits no longer does. A command that runs is stopped, and what it wrote by then stays here; a change being made is done in a moment. */
  private stop(call: WorkspaceCallUnderWay, why: string) {
    if (call.shown.state === "waiting") this.end(call, "stopped", refusal(why));
    else call.stopping.abort();
  }

  private async resultOf({ sent: { call }, change, place, stopping }: WorkspaceCallUnderWay): Promise<WorkspaceCallResult> {
    if (call.kind === "read") return readInWorkspace(call, place, stopping.signal);
    if (call.kind === "run") return commandRun(call.command, place, stopping.signal);
    const ready = change ?? (await changeAskedFor(call, place, stopping.signal));
    return changeMade(ready, place, stopping.signal);
  }

  /** The call is of an agent the person brought and an approver let into the workspace, for a task that is open to it there, until when. */
  private assertOpen({ personId, roomId, agentId, taskId }: WorkspaceCallSent) {
    const room = this.store.findRoom(roomId);
    const brought = room?.agents.find(({ profileId }) => profileId === agentId)?.brought;
    if (!room || brought?.personId !== personId) throw new WorkspaceCallRefused("You are no longer in the room.");
    if (!letIn(brought)) throw new WorkspaceCallRefused(NOT_LET_IN);
    return { room, ...this.openTask(roomId, agentId, taskId) };
  }

  private openTask(roomId: string, agentId: string, taskId: string) {
    const task = this.store.findRoomBroughtTask(taskId);
    const asked = task?.roomId === roomId && task.agentId === agentId ? this.store.findRoomMessage(task.messageId) : undefined;
    const thread = asked && this.room.threadOf(asked, agentId);
    if (!task || !asked || !thread) throw new WorkspaceCallRefused("The room knows no such task of yours, or you have answered it.");
    if (!task.letThrough) throw new WorkspaceCallRefused(NOT_LET_THROUGH);
    const until = openUntil(task);
    if (this.now() >= until) throw new WorkspaceCallRefused(TIME_IS_OVER);
    return { asked, thread, until };
  }

  private allSent() {
    return [...this.beingPrepared.keys(), ...[...this.underWay.values()].map(({ sent }) => sent)];
  }

  private under({ personId, agentId, callId }: WorkspaceCallSent) {
    return this.allSent().some((sent) => sent.personId === personId && sent.agentId === agentId && sent.callId === callId);
  }

  private madeBy({ roomId, agentId }: WorkspaceCallSent) {
    return this.allSent().filter((sent) => sent.roomId === roomId && sent.agentId === agentId).length;
  }

  private whyRefused(error: unknown) {
    if (error instanceof WorkspaceCallRefused) return error.message;
    console.error("a call in a room's workspace failed:", error);
    return "It could not be done on the room's machine.";
  }

  private show(call: WorkspaceCallUnderWay, state: WorkspaceCallState, result: string | null = null) {
    call.shown = { ...call.shown, state, result };
    this.store.updateWorkspaceCall(call.shown);
    this.hub.publishToRoom(call.shown.roomId, { type: "room.workspace-call-shown", call: call.shown });
  }

  private end(call: WorkspaceCallUnderWay, state: WorkspaceCallState, told: WorkspaceCallResult, cameOfIt = told.text) {
    if (!this.underWay.delete(call.shown.id)) return;
    clearTimeout(call.overAt);
    const waited = call.shown.state === "waiting";
    this.show(call, state, kept(everyCharacterShown(cameOfIt)));
    this.tell(call.sent, told);
    if (waited) this.room.waitingChanged(call.shown.roomId);
  }

  private tell({ personId, roomId, agentId, callId }: WorkspaceCallSent, result: WorkspaceCallResult) {
    this.hub.sendToAgentsOf(personId, { type: "room.workspace-answered", personId, roomId, agentId, callId, result });
  }
}

const letIn = ({ workspace }: BroughtAgent) => workspace === "allowed";

const openUntil = ({ sentAt }: RoomBroughtTask) => sentAt + WORKSPACE_TASK_MS;
