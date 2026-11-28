import { broughtCanvasAskIn, broughtCanvasShowIn } from "../shared/brought-canvas.ts";
import { broughtPluginCallIn } from "../shared/brought-plugins.ts";
import { HostProblemError } from "../shared/host-problems.ts";
import { isPastel } from "../shared/model.ts";
import type { PersonMessageType } from "../shared/person-messages.ts";
import type { ClientMessage } from "../shared/protocol.ts";
import { isRoomId } from "../shared/machines.ts";
import { harnessIds } from "../shared/model.ts";
import { LONGEST_PERSON_NAME } from "../shared/person-names.ts";
import { MOST_OWN_ANSWER_CHARACTERS } from "../shared/room-votes.ts";
import { isRoomApprovalAnswer } from "../shared/room-permissions.ts";
import { BROUGHT_STEP_DELTA_MOST_CHARACTERS, isBroughtStepKind, isRoomWorkspaceAnswer, workspaceCallIn } from "../shared/room-workspace.ts";
import { approvesAs, asksAgentsAs, isBroughtAnswerEnd, mayWriteAs, ROOM_MESSAGE_MOST_CHARACTERS, type RoomRole } from "../shared/rooms.ts";

/** A signed-in person other than the machine's owner, as far as what they send goes: the role they have in each room they are in. */
export interface PersonInRooms {
  roleIn(roomId: string): RoomRole | null;
  /** The conversation a room's agent works in now, by the stand-in the person knows it by, where they read the agents' work. */
  conversationBehind(standIn: string): string | null;
  /** The room a plugin canvas item belongs to; null for items outside rooms or unknown items. */
  roomOfCanvasItem?(itemId: string): string | null;
  /** Whether an app document is currently open under `app` in `roomId`. */
  isAppDocumentInRoom?(documentId: string, roomId: string, app: string): boolean;
}

const OWNER_ONLY = null;

/** What a check returns to let nothing of a message through, without refusing it. */
const IGNORED = null;

/** A check that throws what refuses the message; one that returns a message lets that one through in its place. */
type Admission<K extends ClientMessage["type"]> = (message: Extract<ClientMessage, { type: K }>, person: PersonInRooms) => Extract<ClientMessage, { type: K }> | typeof IGNORED | void;

const unreadable = () => new Error("The host could not read that message.");
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((each) => typeof each === "string");
const isIdOrNone = (value: unknown) => value === null || typeof value === "string";

/** Far more questions, and options of each, than an agent's question holds; which there are is the host's to check. */
const MOST_PLACES = 100;
const isPlace = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < MOST_PLACES;

/** One option by its place, words of the confirmer's own, or none of the options, nothing besides. */
function isConfirmedAnswer(value: unknown) {
  if (typeof value !== "object" || value === null || Object.keys(value).length !== 1) return false;
  const { option, own, none } = value as { option?: unknown; own?: unknown; none?: unknown };
  return isPlace(option) || (typeof own === "string" && own.length <= MOST_OWN_ANSWER_CHARACTERS * 4) || none === true;
}

/** Far more than a name or an answer holds once cleaned, so that what is cleaned is never much. */
const MOST_AGENT_NAME_SENT = LONGEST_PERSON_NAME * 4;
const MOST_ANSWER_SENT = ROOM_MESSAGE_MOST_CHARACTERS * 4;
const MOST_REQUEST_ID = 100;

const isRequestId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= MOST_REQUEST_ID;

/** What names one task of one agent someone brought: ids of the form this machine gives them. */
function assertTaskNamed({ agentId, taskId }: { agentId: unknown; taskId: unknown }) {
  if (!isRoomId(agentId) || !isRoomId(taskId)) throw unreadable();
}

/** A room agent's conversation the person reads the work of, by its real id; they name it by its stand-in alone, and any other id is the owner's. */
function conversationOf(person: PersonInRooms, standIn: unknown) {
  const conversationId = typeof standIn === "string" ? person.conversationBehind(standIn) : null;
  if (conversationId === null) throw new HostProblemError({ code: "only-the-owner" });
  return conversationId;
}

const isSeq = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** A room the person is not in is as good as gone for them. */
function roleOf(person: PersonInRooms, roomId: unknown): RoomRole {
  const role = typeof roomId === "string" ? person.roleIn(roomId) : null;
  if (!role) throw new HostProblemError({ code: "room-gone" });
  return role;
}

/**
 * Every message a page can send, and whether a person other than the owner may send it: a check that throws what refuses
 * it, or only the owner. A message type missing here does not compile.
 */
const admissions: { [K in ClientMessage["type"]]: K extends PersonMessageType ? Admission<K> : typeof OWNER_ONLY } = {
  "workspace.create": OWNER_ONLY,
  "workspace.delete": OWNER_ONLY,
  "workspace.set-default-launch": OWNER_ONLY,
  "workspace.move": OWNER_ONLY,
  "workspace.set-color": OWNER_ONLY,
  "workspaces.find-icons": OWNER_ONLY,
  "workspace.set-worktree-settings": OWNER_ONLY,
  "workspace.set-side-chat-access": OWNER_ONLY,
  "workspace.set-sandbox": OWNER_ONLY,
  "workspace.check-sandbox": OWNER_ONLY,
  "workspace-group.create": OWNER_ONLY,
  "workspace-group.rename": OWNER_ONLY,
  "workspace-group.move": OWNER_ONLY,
  "workspace-group.delete": OWNER_ONLY,
  "profile.save": OWNER_ONLY,
  "profile.delete": OWNER_ONLY,
  "profile.turn-plugin": OWNER_ONLY,
  "profile.choices.get": OWNER_ONLY,
  "profile.test": OWNER_ONLY,
  "plugin.check-profile": OWNER_ONLY,
  "prompt-template.save": OWNER_ONLY,
  "prompt-template.delete": OWNER_ONLY,
  "settings.set-canvas-use": OWNER_ONLY,
  "settings.set-keep-awake": OWNER_ONLY,
  "settings.set-reminder-morning": OWNER_ONLY,
  "settings.set-conversation-order": OWNER_ONLY,
  "settings.set-keep-deleted-canvas": OWNER_ONLY,
  "settings.set-room-invites-connect": OWNER_ONLY,
  "settings.set-older-after": OWNER_ONLY,
  "settings.set-conversations-shown": OWNER_ONLY,
  "settings.set-side-chat-access": OWNER_ONLY,
  "settings.export": OWNER_ONLY,
  "settings.save-export": OWNER_ONLY,
  "settings.plan-import": OWNER_ONLY,
  "settings.import": OWNER_ONLY,
  "settings.set-claude-program": OWNER_ONLY,
  "settings.set-sandbox-engine": OWNER_ONLY,
  "settings.ask-sandbox-engines": OWNER_ONLY,
  "settings.set-sandbox-base-image": OWNER_ONLY,
  "newer-version.check": OWNER_ONLY,
  "newer-version.pull": OWNER_ONLY,
  "settings.set-script-program": OWNER_ONLY,
  "settings.set-editor": OWNER_ONLY,
  "settings.set-machine-name": OWNER_ONLY,
  "settings.set-push-relay": OWNER_ONLY,
  "push.register": OWNER_ONLY,
  "push.unregister": OWNER_ONLY,
  "notification.shown": OWNER_ONLY,
  "settings.set-avatar": OWNER_ONLY,
  "person.set-own-profile": ({ requestId, name, color }) => {
    if (typeof requestId !== "string" || typeof name !== "string" || !(color === null || isPastel(color))) throw unreadable();
  },
  "conversation.create": OWNER_ONLY,
  "conversation.move": OWNER_ONLY,
  "sessions.list": OWNER_ONLY,
  "sessions.search": OWNER_ONLY,
  "slash-commands.list": OWNER_ONLY,
  "prompt-history.list": OWNER_ONLY,
  "mentions.suggest": OWNER_ONLY,
  "conversation.adopt": OWNER_ONLY,
  "conversation.fork": OWNER_ONLY,
  "conversation.check-fork": OWNER_ONLY,
  "conversation.side-chat.start": OWNER_ONLY,
  "conversation.side-chat.promote": OWNER_ONLY,
  "conversation.set-side-chat-access": OWNER_ONLY,
  "conversation.delete": OWNER_ONLY,
  "conversations.delete": OWNER_ONLY,
  "conversation.rename": OWNER_ONLY,
  "conversation.set-favourite": OWNER_ONLY,
  "conversation.set-unread": OWNER_ONLY,
  "conversation.set-reminder": OWNER_ONLY,
  "conversation.set-profile": OWNER_ONLY,
  /**
   * A collaborator or an approver follows a room agent's work by its conversation's stand-in, in a page's form; a phone's
   * low-data form is the owner's. Any other id gets nothing, as the owner's page gets for a conversation gone: a page may
   * still ask for a stand-in it lost a moment ago, or for the conversation of an address it opened.
   */
  "conversation.subscribe": ({ conversationId, lowData }, person) => {
    if (lowData !== undefined) throw new HostProblemError({ code: "only-the-owner" });
    if (typeof conversationId !== "string") throw unreadable();
    const followed = person.conversationBehind(conversationId);
    return followed === null ? IGNORED : { type: "conversation.subscribe", conversationId: followed };
  },
  "conversation.load-earlier": ({ requestId, conversationId, beforeSeq, turns, reaching }, person) => {
    if (!isRequestId(requestId) || !isSeq(beforeSeq) || turns !== undefined || !(reaching === undefined || isSeq(reaching))) throw unreadable();
    return { type: "conversation.load-earlier", requestId, conversationId: conversationOf(person, conversationId), beforeSeq, ...(reaching !== undefined && { reaching }) };
  },
  "conversation.find": OWNER_ONLY,
  "tool-raw-output.get": ({ requestId, conversationId, toolCallId }, person) => {
    if (!isRequestId(requestId) || typeof toolCallId !== "string") throw unreadable();
    return { type: "tool-raw-output.get", requestId, conversationId: conversationOf(person, conversationId), toolCallId };
  },
  "tool-output.get": OWNER_ONLY,
  /** Letting go is never refused: a stand-in the person reads no longer was let go of when they lost it. */
  "conversation.unsubscribe": ({ conversationId }, person) => {
    if (typeof conversationId !== "string") throw unreadable();
    const followed = person.conversationBehind(conversationId);
    return followed === null ? IGNORED : { type: "conversation.unsubscribe", conversationId: followed };
  },
  "conversation.prompt": OWNER_ONLY,
  "conversation.cancel": OWNER_ONLY,
  "conversation.revert-preview": OWNER_ONLY,
  "conversation.revert": OWNER_ONLY,
  "conversation.rewind-preview": OWNER_ONLY,
  "conversation.rewind": OWNER_ONLY,
  "conversation.run-command": OWNER_ONLY,
  "conversation.stop-command": OWNER_ONLY,
  "conversation.drop-command-outputs": OWNER_ONLY,
  "conversation.queue.remove": OWNER_ONLY,
  "images.discard": OWNER_ONLY,
  "conversation.queue.move": OWNER_ONLY,
  "conversation.queue.set-after-turn": OWNER_ONLY,
  "conversation.usage-limit.continue": OWNER_ONLY,
  "conversation.try-again": OWNER_ONLY,
  "conversation.usage-limit.stop-waiting": OWNER_ONLY,
  "conversation.job-wait.stop": OWNER_ONLY,
  "conversation.async-task.stop": OWNER_ONLY,
  "conversation.async-task.dismiss": OWNER_ONLY,
  "conversation.async-task.clear-finished": OWNER_ONLY,
  "conversation.delegation.dismiss": OWNER_ONLY,
  "conversation.delegation.clear-finished": OWNER_ONLY,
  "async-task.output.get": OWNER_ONLY,
  "conversation.set-ask-mode": OWNER_ONLY,
  "conversation.set-plugin-setting": OWNER_ONLY,
  "conversation.set-bypass-permissions": OWNER_ONLY,
  "conversation.set-sandboxed": OWNER_ONLY,
  "conversation.set-config": OWNER_ONLY,
  "permission.respond": OWNER_ONLY,
  "ask.answer": OWNER_ONLY,
  "canvas.report": OWNER_ONLY,
  "app.subscribe": ({ workspaceId, app, documentId }, person) => {
    if (typeof workspaceId !== "string" || typeof app !== "string" || typeof documentId !== "string") throw unreadable();
    roleOf(person, workspaceId);
    if (!person.isAppDocumentInRoom?.(documentId, workspaceId, app)) return IGNORED;
  },
  "app.unsubscribe": ({ workspaceId, app, documentId }, person) => {
    if (typeof workspaceId !== "string" || typeof app !== "string" || (documentId !== undefined && typeof documentId !== "string")) throw unreadable();
    if (!person.roleIn(workspaceId)) return IGNORED;
  },
  "app.apply": ({ workspaceId, app, documentId }, person) => {
    if (typeof workspaceId !== "string" || typeof app !== "string" || typeof documentId !== "string") throw unreadable();
    const role = roleOf(person, workspaceId);
    if (!person.isAppDocumentInRoom?.(documentId, workspaceId, app)) throw new HostProblemError({ code: "only-the-owner" });
    if (!asksAgentsAs(role)) throw new HostProblemError({ code: "room-guests-only-write" });
  },
  "app.use-in": OWNER_ONLY,
  "app.storage-set": ({ workspaceId, app, key, value }, person) => {
    if (typeof workspaceId !== "string" || typeof app !== "string" || typeof key !== "string" || !(typeof value === "string" || value === null)) throw unreadable();
    const role = roleOf(person, workspaceId);
    if (!asksAgentsAs(role)) return IGNORED;
  },
  "app.run": ({ workspaceId, app, documentId, task }, person) => {
    if (typeof workspaceId !== "string" || typeof app !== "string" || typeof documentId !== "string" || typeof task !== "string") throw unreadable();
    const role = roleOf(person, workspaceId);
    if (!person.isAppDocumentInRoom?.(documentId, workspaceId, app)) throw new HostProblemError({ code: "only-the-owner" });
    if (!approvesAs(role)) throw new HostProblemError({ code: "room-approval-not-yours" });
  },
  "app.open-file": OWNER_ONLY,
  "app.stop-task": ({ workspaceId, app, documentId }, person) => {
    if (typeof workspaceId !== "string" || typeof app !== "string" || typeof documentId !== "string") throw unreadable();
    const role = roleOf(person, workspaceId);
    if (!person.isAppDocumentInRoom?.(documentId, workspaceId, app)) throw new HostProblemError({ code: "only-the-owner" });
    if (!approvesAs(role)) throw new HostProblemError({ code: "room-approval-not-yours" });
  },
  "canvas.item-action": ({ requestId, itemId }, person) => {
    if (!isRequestId(requestId) || typeof itemId !== "string") throw unreadable();
    const roomId = person.roomOfCanvasItem?.(itemId) ?? null;
    if (roomId === null) throw new HostProblemError({ code: "only-the-owner" });
    if (!asksAgentsAs(roleOf(person, roomId))) throw new HostProblemError({ code: "room-guests-only-write" });
  },
  "canvas.run-command": OWNER_ONLY,
  "plugin-window.subscribe": OWNER_ONLY,
  "plugin-window.action": OWNER_ONLY,
  "plugin-tab.subscribe": OWNER_ONLY,
  "plugin-tab.action": OWNER_ONLY,
  "canvas.dismiss": ({ itemId }, person) => {
    if (typeof itemId !== "string") throw unreadable();
    const roomId = person.roomOfCanvasItem?.(itemId) ?? null;
    if (roomId === null) throw new HostProblemError({ code: "only-the-owner" });
    if (!asksAgentsAs(roleOf(person, roomId))) throw new HostProblemError({ code: "room-guests-only-write" });
  },
  "canvas.export": OWNER_ONLY,
  "canvas.save-to-project": OWNER_ONLY,
  "canvas.save-image-to-project": OWNER_ONLY,
  "changes.list": OWNER_ONLY,
  "changes.diff": OWNER_ONLY,
  "changes.files": OWNER_ONLY,
  "changes.committable": OWNER_ONLY,
  "changes.commit": OWNER_ONLY,
  "changes.landable": OWNER_ONLY,
  "changes.land": OWNER_ONLY,
  "changes.open-in-editor": OWNER_ONLY,
  "files.open": OWNER_ONLY,
  "fs.complete": OWNER_ONLY,
  "statusline.render": OWNER_ONLY,
  "subagent-usage.get": OWNER_ONLY,
  "terminals.attach": OWNER_ONLY,
  "terminal.open": OWNER_ONLY,
  "terminal.replay": OWNER_ONLY,
  "terminal.open-login": OWNER_ONLY,
  "terminal.open-sandbox-sign-in": OWNER_ONLY,
  "terminal.follow-job": OWNER_ONLY,
  "terminal.open-panel-command": OWNER_ONLY,
  "terminal.input": OWNER_ONLY,
  "terminal.resize": OWNER_ONLY,
  "terminal.close": OWNER_ONLY,
  "terminal.close-tab": OWNER_ONLY,
  "terminal.clear": OWNER_ONLY,
  /** A room the person is not in, or none at all, is ignored where it is used rather than refused here, so that nothing tells them it exists. */
  "presence": ({ conversationId, attentive, sideChatId, roomId, visible }) => {
    if (!isIdOrNone(conversationId) || typeof attentive !== "boolean" || typeof visible !== "boolean" || ![sideChatId, roomId].every((id) => id === undefined || typeof id === "string")) {
      throw unreadable();
    }
  },
  "ping": () => {},
  "page.error": OWNER_ONLY,
  "host.restart": OWNER_ONLY,
  "devices.list": OWNER_ONLY,
  "plugins.list": OWNER_ONLY,
  "plugins.choose-setting": OWNER_ONLY,
  "plugins.offer": OWNER_ONLY,
  "plugins.offer-update": OWNER_ONLY,
  "plugins.install": OWNER_ONLY,
  "plugins.discard": OWNER_ONLY,
  "plugins.find-commits": OWNER_ONLY,
  "plugins.remove": OWNER_ONLY,
  "settings.set-plugin-update-mode": OWNER_ONLY,
  "plugins.set-updates-by-itself": OWNER_ONLY,
  "plugins.undo-update": OWNER_ONLY,
  "devices.invite": OWNER_ONLY,
  "address.find": OWNER_ONLY,
  "address.serve": OWNER_ONLY,
  "device.revoke": OWNER_ONLY,
  "join-request.approve": OWNER_ONLY,
  "join-request.deny": OWNER_ONLY,
  "settings.set-public-address": OWNER_ONLY,
  "settings.set-network": OWNER_ONLY,
  "voice.set-settings": OWNER_ONLY,
  "voice.engine.set-up": OWNER_ONLY,
  "voice.engine.cancel": OWNER_ONLY,
  "voice.engine.remove": OWNER_ONLY,
  "voice.engine.remove-model": OWNER_ONLY,
  "machine.add": OWNER_ONLY,
  "machine.rename": OWNER_ONLY,
  "machine.remove": OWNER_ONLY,
  "machine.set-color": OWNER_ONLY,
  "machine.hide": OWNER_ONLY,
  "machine.show-again": OWNER_ONLY,
  "machine.join": OWNER_ONLY,
  "machine.ask-to-join": OWNER_ONLY,
  "machine.room-opened": OWNER_ONLY,
  "machine.mute-room": OWNER_ONLY,
  "machine.leave-room": OWNER_ONLY,
  "machine.dismiss-knock": OWNER_ONLY,
  "machine.bring-agent": OWNER_ONLY,
  "machine.take-agent-out": OWNER_ONLY,
  "brought-task.answer": OWNER_ONLY,
  "search": OWNER_ONLY,
  "room.create": OWNER_ONLY,
  "room.rename": OWNER_ONLY,
  "room.set-agents": OWNER_ONLY,
  "room.set-agent-model": OWNER_ONLY,
  "room.set-permissions": OWNER_ONLY,
  "room.set-workspace": OWNER_ONLY,
  "room.set-person-role": OWNER_ONLY,
  "room.remove-person": OWNER_ONLY,
  "room.invite": OWNER_ONLY,
  "room.withdraw-invite": OWNER_ONLY,
  "room.let-in": OWNER_ONLY,
  "room.turn-away": OWNER_ONLY,
  "room.turn-away-all": OWNER_ONLY,
  /** Only an approver of the room answers what its agents ask; the room's host checks the request still waits. */
  "room.approve": ({ roomId, profileId, permissionId, answer }, person) => {
    if (typeof profileId !== "string" || typeof permissionId !== "string" || !isRoomApprovalAnswer(answer)) throw unreadable();
    if (!approvesAs(roleOf(person, roomId))) throw new HostProblemError({ code: "room-approval-not-yours" });
  },
  "room.answer-task": ({ roomId, messageId, answer }, person) => {
    if (typeof messageId !== "string" || (answer !== "allow" && answer !== "deny")) throw unreadable();
    if (!approvesAs(roleOf(person, roomId))) throw new HostProblemError({ code: "room-approval-not-yours" });
  },
  "room.set-peoples-tasks-wait": OWNER_ONLY,
  "room.set-claude-setup": OWNER_ONLY,
  "room.set-plugins": OWNER_ONLY,
  "room.set-sandbox": OWNER_ONLY,
  "room.check-sandbox": OWNER_ONLY,
  "sandbox.answer-held-change": OWNER_ONLY,
  "sandbox.held-change-text": OWNER_ONLY,
  "sandbox.add-folder": OWNER_ONLY,
  "sandbox.set-folder-access": OWNER_ONLY,
  "sandbox.remove-folder": OWNER_ONLY,
  "sandbox.apply-folders-now": OWNER_ONLY,
  "sandbox.set-network": OWNER_ONLY,
  "room.set-agent-variable": OWNER_ONLY,
  "room.set-agent-host-environment": OWNER_ONLY,
  "room.set-agents-read-guests": OWNER_ONLY,
  "room.delete": OWNER_ONLY,
  "room.subscribe": ({ roomId }, person) => void roleOf(person, roomId),
  "room.unsubscribe": ({ roomId }) => {
    if (typeof roomId !== "string") throw unreadable();
  },
  "room.write": ({ roomId, text, tags, threadId }, person) => {
    if (typeof text !== "string" || !isStringList(tags) || !isIdOrNone(threadId)) throw unreadable();
    if (!mayWriteAs(roleOf(person, roomId), tags, threadId)) throw new HostProblemError({ code: "room-guests-only-write" });
  },
  "room.writing": ({ roomId, threadId, writing }) => {
    if (typeof roomId !== "string" || !isIdOrNone(threadId) || typeof writing !== "boolean") throw unreadable();
  },
  "room.usage.get": OWNER_ONLY,
  "room.vote": ({ roomId, itemId, question, option }, person) => {
    if (typeof itemId !== "string" || !isPlace(question) || !isPlace(option)) throw unreadable();
    void roleOf(person, roomId);
  },
  /** Only the person whose task the agent works on confirms, besides the owner, and only while they may ask agents themselves; the room's host checks which. */
  "room.confirm": ({ roomId, itemId, answers }, person) => {
    if (typeof itemId !== "string" || !Array.isArray(answers) || answers.length > MOST_PLACES || !answers.every(isConfirmedAnswer)) throw unreadable();
    if (!asksAgentsAs(roleOf(person, roomId))) throw new HostProblemError({ code: "room-confirm-not-yours" });
  },
  "room.mute": ({ roomId, muted }, person) => {
    if (typeof muted !== "boolean") throw unreadable();
    void roleOf(person, roomId);
  },
  "room.leave": ({ roomId }, person) => void roleOf(person, roomId),
  "room.set-members-bring-agents": OWNER_ONLY,
  /** Whether the person is in the room, that only a member brings one, never a guest, while the room lets them, and how many, the room's host checks and answers. */
  "room.bring-agent": ({ requestId, roomId, name, harness, worksInRoom }) => {
    if (!isRequestId(requestId) || !isRoomId(roomId) || typeof name !== "string" || name.length > MOST_AGENT_NAME_SENT || !harnessIds.includes(harness) || typeof worksInRoom !== "boolean") throw unreadable();
  },
  /** Whose agent it is, the room's host checks: a person takes out only the agents they brought. */
  "room.take-agent-out": ({ roomId, agentId }, person) => {
    if (!isRoomId(agentId)) throw unreadable();
    void roleOf(person, roomId);
  },
  "room.brought-agents-here": (message) => {
    if (Object.keys(message).length !== 1) throw unreadable();
  },
  /** Only for a task the room's host sent an agent the person brought, and has not had answered, which it checks. */
  "room.brought-task-started": (message, person) => {
    assertTaskNamed(message);
    void roleOf(person, message.roomId);
  },
  "room.brought-task-answered": (message, person) => {
    assertTaskNamed(message);
    if (typeof message.text !== "string" || message.text.length > MOST_ANSWER_SENT || !(message.ended === null || isBroughtAnswerEnd(message.ended))) throw unreadable();
    void roleOf(person, message.roomId);
  },
  "room.brought-step": ({ roomId, agentId, taskId, stepId, kind, delta }, person) => {
    assertTaskNamed({ agentId, taskId });
    if (!isRoomId(stepId) || !isBroughtStepKind(kind) || typeof delta !== "string" || delta.length === 0 || delta.length > BROUGHT_STEP_DELTA_MOST_CHARACTERS || !asksAgentsAs(roleOf(person, roomId))) throw unreadable();
  },
  "room.brought-canvas-show": ({ type, roomId, agentId, taskId, itemId, title, html }, person) => {
    assertTaskNamed({ agentId, taskId });
    const cleaned = broughtCanvasShowIn({ title, html });
    if (!isRoomId(itemId) || !cleaned || !asksAgentsAs(roleOf(person, roomId))) throw unreadable();
    return { type, roomId, agentId, taskId, itemId, ...cleaned };
  },
  "room.brought-canvas-ask": ({ type, roomId, agentId, taskId, itemId, ask }, person) => {
    assertTaskNamed({ agentId, taskId });
    const cleaned = broughtCanvasAskIn(ask);
    if (!isRoomId(itemId) || !cleaned || !asksAgentsAs(roleOf(person, roomId))) throw unreadable();
    return { type, roomId, agentId, taskId, itemId, ask: cleaned };
  },
  "room.brought-canvas-cancel": ({ roomId, agentId, itemId }, person) => {
    if (!isRoomId(agentId) || !isRoomId(itemId)) throw unreadable();
    void roleOf(person, roomId);
  },
  /** Only a call of a form the host knows, no larger than it may be; what it may do, the room's host checks and answers. */
  "room.workspace-call": ({ type, roomId, agentId, taskId, callId, call }, person) => {
    assertTaskNamed({ agentId, taskId });
    const known = workspaceCallIn(call);
    if (!isRoomId(callId) || !known || !asksAgentsAs(roleOf(person, roomId))) throw unreadable();
    return { type, roomId, agentId, taskId, callId, call: known };
  },
  "room.workspace-call-stopped": ({ roomId, agentId, callId }, person) => {
    if (!isRoomId(agentId) || !isRoomId(callId)) throw unreadable();
    void roleOf(person, roomId);
  },
  "room.plugin-call": ({ type, roomId, agentId, taskId, callId, tool, args }, person) => {
    assertTaskNamed({ agentId, taskId });
    const known = broughtPluginCallIn(tool, args);
    if (!isRoomId(callId) || !known || !asksAgentsAs(roleOf(person, roomId))) throw unreadable();
    return { type, roomId, agentId, taskId, callId, ...known };
  },
  "room.plugin-call-stopped": ({ roomId, agentId, callId }, person) => {
    if (!isRoomId(agentId) || !isRoomId(callId)) throw unreadable();
    void roleOf(person, roomId);
  },
  "room.answer-workspace": ({ roomId, agentId, answer }, person) => {
    if (!isRoomId(agentId) || !isRoomWorkspaceAnswer(answer)) throw unreadable();
    if (!approvesAs(roleOf(person, roomId))) throw new HostProblemError({ code: "room-approval-not-yours" });
  },
  "room.answer-workspace-call": ({ roomId, callId, answer }, person) => {
    if (!isRoomId(callId) || (answer !== "allow" && answer !== "deny")) throw unreadable();
    if (!approvesAs(roleOf(person, roomId))) throw new HostProblemError({ code: "room-approval-not-yours" });
  },
};

/** The message, from what a person other than the owner sent, when they may send it, or null when it is let go quietly; anything else throws what refuses it. */
export function admittedFromPerson(sent: unknown, person: PersonInRooms): ClientMessage | null {
  const type = typeof sent === "object" && sent !== null ? (sent as { type?: unknown }).type : undefined;
  const admission = typeof type === "string" && Object.hasOwn(admissions, type) ? admissions[type as ClientMessage["type"]] : OWNER_ONLY;
  if (admission === OWNER_ONLY) throw new HostProblemError({ code: "only-the-owner" });
  const admitted = (admission as Admission<ClientMessage["type"]>)(sent as ClientMessage, person);
  return admitted === undefined ? (sent as ClientMessage) : admitted;
}
