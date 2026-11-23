import { HostProblemError } from "../shared/host-problems.ts";
import { isPastel } from "../shared/model.ts";
import type { PersonMessageType } from "../shared/person-messages.ts";
import type { ClientMessage } from "../shared/protocol.ts";
import { isRoomId } from "../shared/machines.ts";
import { harnessIds } from "../shared/model.ts";
import { LONGEST_PERSON_NAME } from "../shared/people.ts";
import { MOST_OWN_ANSWER_CHARACTERS } from "../shared/room-votes.ts";
import { asksAgentsAs, isBroughtAnswerEnd, mayWriteAs, ROOM_MESSAGE_MOST_CHARACTERS, type RoomRole } from "../shared/rooms.ts";

/** A signed-in person other than the machine's owner, as far as what they send goes: the role they have in each room they are in. */
export interface PersonInRooms {
  roleIn(roomId: string): RoomRole | null;
}

const OWNER_ONLY = null;

type Admission<K extends ClientMessage["type"]> = (message: Extract<ClientMessage, { type: K }>, person: PersonInRooms) => void;

const unreadable = () => new Error("The host could not read that message.");
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((each) => typeof each === "string");
const isIdOrNone = (value: unknown) => value === null || typeof value === "string";

/** Far more questions, and options of each, than an agent's question holds; which there are is the host's to check. */
const MOST_PLACES = 100;
const isPlace = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < MOST_PLACES;

/** One option by its place, or words of the confirmer's own, nothing besides. */
function isConfirmedAnswer(value: unknown) {
  if (typeof value !== "object" || value === null || Object.keys(value).length !== 1) return false;
  const { option, own } = value as { option?: unknown; own?: unknown };
  return isPlace(option) || (typeof own === "string" && own.length <= MOST_OWN_ANSWER_CHARACTERS * 4);
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
  "settings.set-claude-program": OWNER_ONLY,
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
  "conversation.delete": OWNER_ONLY,
  "conversations.delete": OWNER_ONLY,
  "conversation.rename": OWNER_ONLY,
  "conversation.set-favourite": OWNER_ONLY,
  "conversation.set-unread": OWNER_ONLY,
  "conversation.set-reminder": OWNER_ONLY,
  "conversation.set-profile": OWNER_ONLY,
  "conversation.subscribe": OWNER_ONLY,
  "conversation.load-earlier": OWNER_ONLY,
  "conversation.find": OWNER_ONLY,
  "tool-raw-output.get": OWNER_ONLY,
  "tool-output.get": OWNER_ONLY,
  "conversation.unsubscribe": OWNER_ONLY,
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
  "conversation.set-config": OWNER_ONLY,
  "permission.respond": OWNER_ONLY,
  "ask.answer": OWNER_ONLY,
  "canvas.report": OWNER_ONLY,
  "app.subscribe": OWNER_ONLY,
  "app.unsubscribe": OWNER_ONLY,
  "app.apply": OWNER_ONLY,
  "app.use-in": OWNER_ONLY,
  "app.storage-set": OWNER_ONLY,
  "app.run": OWNER_ONLY,
  "app.open-file": OWNER_ONLY,
  "app.stop-task": OWNER_ONLY,
  "canvas.item-action": OWNER_ONLY,
  "canvas.run-command": OWNER_ONLY,
  "plugin-window.subscribe": OWNER_ONLY,
  "plugin-window.action": OWNER_ONLY,
  "plugin-tab.subscribe": OWNER_ONLY,
  "plugin-tab.action": OWNER_ONLY,
  "canvas.dismiss": OWNER_ONLY,
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
  "machine.remove": OWNER_ONLY,
  "machine.set-color": OWNER_ONLY,
  "machine.hide": OWNER_ONLY,
  "machine.show-again": OWNER_ONLY,
  "machine.join": OWNER_ONLY,
  "machine.ask-to-join": OWNER_ONLY,
  "machine.room-opened": OWNER_ONLY,
  "machine.mute-room": OWNER_ONLY,
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
  "room.approve": OWNER_ONLY,
  "room.answer-task": OWNER_ONLY,
  "room.set-peoples-tasks-wait": OWNER_ONLY,
  "room.set-claude-setup": OWNER_ONLY,
  "room.set-sandbox": OWNER_ONLY,
  "room.check-sandbox": OWNER_ONLY,
  "sandbox.answer-held-change": OWNER_ONLY,
  "sandbox.held-change-text": OWNER_ONLY,
  "sandbox.add-folder": OWNER_ONLY,
  "sandbox.set-folder-access": OWNER_ONLY,
  "sandbox.remove-folder": OWNER_ONLY,
  "sandbox.apply-folders-now": OWNER_ONLY,
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
  "room.set-members-bring-agents": OWNER_ONLY,
  /** Into a room the person is in; that only a member brings one, never a guest, while the room lets them, and how many, the room's host checks and answers. */
  "room.bring-agent": ({ requestId, roomId, name, harness }, person) => {
    if (!isRequestId(requestId) || typeof name !== "string" || name.length > MOST_AGENT_NAME_SENT || !harnessIds.includes(harness)) throw unreadable();
    void roleOf(person, roomId);
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
};

/** The message, from what a person other than the owner sent, when they may send it; anything else throws what refuses it. */
export function admittedFromPerson(sent: unknown, person: PersonInRooms): ClientMessage {
  const type = typeof sent === "object" && sent !== null ? (sent as { type?: unknown }).type : undefined;
  const admission = typeof type === "string" && Object.hasOwn(admissions, type) ? admissions[type as ClientMessage["type"]] : OWNER_ONLY;
  if (admission === OWNER_ONLY) throw new HostProblemError({ code: "only-the-owner" });
  (admission as Admission<ClientMessage["type"]>)(sent as ClientMessage, person);
  return sent as ClientMessage;
}
