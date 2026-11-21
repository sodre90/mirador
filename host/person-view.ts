import type { CanvasItem, Profile } from "../shared/model.ts";
import { DEFAULT_CONVERSATIONS_SHOWN, DEFAULT_OLDER_AFTER } from "../shared/model.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import type { RoomPresence } from "../shared/rooms.ts";
import { agentStandIn, shownOnRoomCanvas, type Room } from "../shared/rooms.ts";
import type { ShownToPerson, SocketData } from "./hub.ts";
import type { Store } from "./store.ts";

const HIDDEN = null;

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;

type View<K extends ServerMessage["type"]> = (message: Extract<ServerMessage, { type: K }>, socket: SocketData) => ServerMessage[];

/**
 * A room as a person in it sees it: of its people only themselves, nothing of the workspace its agents work in, and in
 * place of each agent's conversation there, which they never open, a stand-in that names none.
 */
const roomSeenBy = ({ id, name, agents, permissions, people, peoplesTasksWait, createdAt }: Room, personId: string): Room => ({
  id,
  name,
  workspaceId: "",
  agents: agents.map(({ profileId, conversationId, answering }) => ({ profileId, conversationId: conversationId === null ? null : agentStandIn(id, profileId), answering })),
  permissions,
  people: people.flatMap(({ personId: each, role }) => (each === personId ? [{ personId, role }] : [])),
  peoplesTasksWait,
  createdAt,
});

/** A page or question of a room's agent as people in the room see it: its agent's stand-in in place of its conversation. */
const canvasItemSeen = (item: CanvasItem, roomId: string, profileId: string): CanvasItem => ({ ...item, conversationId: agentStandIn(roomId, profileId) });

/** A room's agent as people in the room see it: its name and the agent it runs on, none of its settings. */
const agentSeen = ({ id, name, harness }: Profile): Profile => ({
  id,
  name,
  harness,
  environment: "",
  prelaunch: "",
  model: null,
  mode: null,
  effort: null,
  bypassPermissions: false,
  askMode: "wait",
  color: null,
  pluginsOff: [],
  createdAt: 0,
});

/** The agents of the rooms, by their profiles. */
export function agentsOfRooms(store: Pick<Store, "listProfiles">, rooms: Room[]) {
  const agentIds = new Set(rooms.flatMap(({ agents }) => agents.map(({ profileId }) => profileId)));
  return store.listProfiles().filter(({ id }) => agentIds.has(id));
}

type PeopleSeen = Pick<Store, "roomsOf" | "listPeople" | "ownerId" | "writersInRoomsOf">;

/**
 * The people a person other than the owner sees: the owner, who is in every room, themselves, everyone who shares a room
 * with them, and everyone who wrote in those rooms, so messages of people since taken out keep their names.
 */
export function peopleSeenBy(store: PeopleSeen, personId: string) {
  const sharingARoom = store.roomsOf(personId).flatMap(({ people }) => people.map((person) => person.personId));
  const seen = new Set([store.ownerId(), personId, ...sharingARoom, ...store.writersInRoomsOf(personId)]);
  return store.listPeople().filter(({ id }) => seen.has(id));
}

/** The names of the people and agents a person other than the owner sees, their own left out: whether one is taken tells them of nobody they don't see. */
export const namesOthersGoBy = (store: PeopleSeen & Pick<Store, "listProfiles">, personId: string) => [
  ...peopleSeenBy(store, personId).flatMap(({ id, name }) => (id === personId ? [] : [name])),
  ...agentsOfRooms(store, store.roomsOf(personId)).map(({ name }) => name),
];

/**
 * What a signed-in person other than the machine's owner sees of each message the host sends: their rooms, the people
 * and agents in them, and those rooms' messages and canvases, as made for them; nothing else. A message type missing here
 * does not compile.
 */
export function personView(store: PeopleSeen & Pick<Store, "findRoom" | "listProfiles" | "findConversation" | "findRoomThread">): ShownToPerson {
  const isIn = (socket: SocketData, roomId: string) => store.findRoom(roomId)?.people.some(({ personId }) => personId === socket.personId) === true;
  const shownIf = (shown: boolean, message: ServerMessage) => (shown ? [message] : []);

  const agentsOf = (rooms: Room[]) => agentsOfRooms(store, rooms);
  const isAgentOfTheirRooms = (profileId: string, socket: SocketData) =>
    store.roomsOf(socket.personId).some(({ agents }) => agents.some((agent) => agent.profileId === profileId));
  const peopleSeen = (personId: string) => peopleSeenBy(store, personId);

  /** The room as it is now for a person in it, with its agents, which they may not have been told of; for a person just taken out of it, that it is gone. */
  const roomNewsFor = (room: Room, socket: SocketData): ServerMessage[] => {
    if (room.people.some(({ personId }) => personId === socket.personId)) {
      socket.roomsShown.add(room.id);
      const agents = agentsOf([room]).map((profile): ServerMessage => ({ type: "profile.upserted", profile: agentSeen(profile) }));
      return [...agents, { type: "room.upserted", room: roomSeenBy(room, socket.personId) }];
    }
    socket.roomSubscriptions.delete(room.id);
    return shownIf(socket.roomsShown.delete(room.id), { type: "room.deleted", roomId: room.id });
  };

  const canvasItemFor = (item: CanvasItem, socket: SocketData): ServerMessage[] => {
    const conversation = store.findConversation(item.conversationId);
    const roomId = conversation?.roomId;
    if (!shownOnRoomCanvas(item) || typeof roomId !== "string" || conversation?.profileId == null || !isIn(socket, roomId)) return [];
    return [{ type: "canvas.upserted", item: canvasItemSeen(item, roomId, conversation.profileId) }];
  };

  const timelineCanvasSeen = (roomId: string, items: CanvasItem[]) => {
    const agents = store.findRoom(roomId)?.agents ?? [];
    return items.flatMap((item) => {
      const profileId = agents.find(({ conversationId }) => conversationId === item.conversationId)?.profileId;
      return profileId === undefined ? [] : [canvasItemSeen(item, roomId, profileId)];
    });
  };

  /** Of who is in their room now, only the people they see, each writing in the room or in one of its threads. */
  const presenceSeen = (roomId: string, { here, writing }: RoomPresence, socket: SocketData): RoomPresence => {
    const seen = new Set(peopleSeen(socket.personId).map(({ id }) => id));
    const inTheRoom = (threadId: string | null) => threadId === null || store.findRoomThread(threadId)?.roomId === roomId;
    return { here: here.filter((personId) => seen.has(personId)), writing: writing.filter(({ personId, threadId }) => seen.has(personId) && inTheRoom(threadId)) };
  };

  const snapshotFor = ({ hostRunId }: Snapshot, socket: SocketData): Snapshot => {
    const rooms = store.roomsOf(socket.personId);
    rooms.forEach(({ id }) => socket.roomsShown.add(id));
    return {
      type: "snapshot",
      workspaces: [],
      workspaceGroups: [],
      conversations: [],
      rooms: rooms.map((room) => roomSeenBy(room, socket.personId)),
      roomApprovals: [],
      roomTasksWaiting: [],
      roomInvites: [],
      profiles: agentsOf(rooms).map(agentSeen),
      promptTemplates: [],
      canvasUse: "as-needed",
      claudeProgram: { configured: "", found: null, version: null, installFolders: "", installCommand: "" },
      scriptProgram: "",
      editor: { setting: { editor: "first-found" }, found: [], opensIn: null },
      pushRelay: { address: null, tokenSet: false, grantRelay: null, miradorRelay: null },
      avatar: null,
      people: peopleSeen(socket.personId),
      ownerId: store.ownerId(),
      you: socket.personId,
      installedAgents: [],
      canvasAssetsOrigin: socket.canvasAssetsOrigin,
      agentsCanvasAssetsOrigin: "",
      machines: [],
      machineStatuses: [],
      hiddenMachines: [],
      hostId: "",
      homeDir: "",
      hostRunId,
      hostCodeChanged: false,
      revokedPlugins: [],
      desktopAppOutdated: false,
      version: "",
      answersPings: true,
      newerVersion: null,
      installedApps: [],
      openApps: [],
      canvasViews: {},
      conversationPlugins: [],
      pluginLooks: {},
      olderAfter: DEFAULT_OLDER_AFTER,
      conversationsShown: DEFAULT_CONVERSATIONS_SHOWN,
    };
  };

  const views: { [K in ServerMessage["type"]]: View<K> | typeof HIDDEN } = {
    "snapshot": (message, socket) => [snapshotFor(message, socket)],
    "apps.open": HIDDEN,
    "app.state": HIDDEN,
    "app.storage": HIDDEN,
    "profile.upserted": ({ profile }, socket) => shownIf(isAgentOfTheirRooms(profile.id, socket), { type: "profile.upserted", profile: agentSeen(profile) }),
    "profile.deleted": HIDDEN,
    "profile.saved": HIDDEN,
    "profile.choices.got": HIDDEN,
    "profile.tested": HIDDEN,
    "plugin.profile-checked": HIDDEN,
    "prompt-template.upserted": HIDDEN,
    "prompt-template.deleted": HIDDEN,
    "settings.canvas-use": HIDDEN,
    "settings.keep-awake": HIDDEN,
    "settings.plugin-update-mode": HIDDEN,
    "plugins.updated-at-start": HIDDEN,
    "settings.reminder-morning": HIDDEN,
    "settings.conversation-order": HIDDEN,
    "settings.keep-deleted-canvas": HIDDEN,
    "settings.older-after": HIDDEN,
    "settings.conversations-shown": HIDDEN,
    "settings.claude-program": HIDDEN,
    "settings.script-program": HIDDEN,
    "settings.editor": HIDDEN,
    "settings.machine-name": HIDDEN,
    "settings.push-relay": HIDDEN,
    "settings.avatar": HIDDEN,
    "people.listed": (_, socket) => [{ type: "people.listed", people: peopleSeen(socket.personId) }],
    "voice.settings": HIDDEN,
    "voice.engine": HIDDEN,
    "workspace.upserted": HIDDEN,
    "workspace.deleted": HIDDEN,
    "workspace-group.upserted": HIDDEN,
    "workspace-group.deleted": HIDDEN,
    "conversation.upserted": HIDDEN,
    "conversation.deleted": HIDDEN,
    "room.created": HIDDEN,
    "room.upserted": ({ room }, socket) => roomNewsFor(room, socket),
    "room.deleted": (message, socket) => shownIf(socket.roomsShown.delete(message.roomId), message),
    "room.invited": HIDDEN,
    "room-invites.listed": HIDDEN,
    "room.timeline": (message, socket) => shownIf(isIn(socket, message.roomId), { ...message, canvas: timelineCanvasSeen(message.roomId, message.canvas) }),
    "room.message": (message, socket) => shownIf(isIn(socket, message.message.roomId), message),
    "room.approvals": HIDDEN,
    "room.presence": ({ roomId, here, writing }, socket) => shownIf(isIn(socket, roomId), { type: "room.presence", roomId, ...presenceSeen(roomId, { here, writing }, socket) }),
    "room.usage.got": HIDDEN,
    "conversation.history": HIDDEN,
    "conversation.earlier": HIDDEN,
    "tool-output.got": HIDDEN,
    "conversation.found": HIDDEN,
    "tool-raw-output.got": HIDDEN,
    "async-task.output.got": HIDDEN,
    "conversation.event": HIDDEN,
    "conversation.revert-previewed": HIDDEN,
    "conversation.reverted": HIDDEN,
    "conversation.revert-failed": HIDDEN,
    "conversation.rewind-previewed": HIDDEN,
    "conversation.rewind-done": HIDDEN,
    "conversation.rewound": HIDDEN,
    "conversation.rewind-failed": HIDDEN,
    "canvas.upserted": ({ item }, socket) => canvasItemFor(item, socket),
    "canvas.exported": HIDDEN,
    "canvas.saved-to-project": HIDDEN,
    "canvas.export-failed": HIDDEN,
    "fs.completions": HIDDEN,
    "statusline.rendered": HIDDEN,
    "subagent-usage.got": HIDDEN,
    "sessions.listed": HIDDEN,
    "sessions.searched": HIDDEN,
    "sessions.failed": HIDDEN,
    "slash-commands.listed": HIDDEN,
    "conversation.fork-checked": HIDDEN,
    "conversation.side-chat.started": HIDDEN,
    "prompt-history.listed": HIDDEN,
    "mentions.suggested": HIDDEN,
    "changes.listed": HIDDEN,
    "changes.diffed": HIDDEN,
    "changes.files-listed": HIDDEN,
    "changes.committable-listed": HIDDEN,
    "changes.committed": HIDDEN,
    "changes.landable-listed": HIDDEN,
    "changes.landed": HIDDEN,
    "changes.failed": HIDDEN,
    "terminals.listed": HIDDEN,
    "terminal.opened": HIDDEN,
    "terminal.replayed": HIDDEN,
    "terminal.output": HIDDEN,
    "terminal.exited": HIDDEN,
    "terminal.busy": HIDDEN,
    "terminal.cleared": HIDDEN,
    "system-notification": HIDDEN,
    "waiting.counted": HIDDEN,
    "running-turns.counted": HIDDEN,
    "host.code-changed": HIDDEN,
    "plugins.revoked-running": HIDDEN,
    "desktop-app.outdated": HIDDEN,
    "newer-version.found": HIDDEN,
    "newer-version.checked": HIDDEN,
    "newer-version.pulled": HIDDEN,
    "plugin-updates.found": HIDDEN,
    "host.restarting": HIDDEN,
    "error": (message) => [message],
    "pong": (message) => [message],
    "files.ask-to-open": HIDDEN,
    "conversation.delete-asks": HIDDEN,
    "conversations.delete-asks": HIDDEN,
    "workspace.delete-asks": HIDDEN,
    "devices.listed": HIDDEN,
    "plugins.listed": HIDDEN,
    "plugins.views": HIDDEN,
    "plugins.settings": HIDDEN,
    "plugins.changed": HIDDEN,
    "plugins.offered": HIDDEN,
    "canvas.item-acted": HIDDEN,
    "app.file-opened": HIDDEN,
    "canvas.command-ran": HIDDEN,
    "plugin-window.state": HIDDEN,
    "plugin-window.acted": HIDDEN,
    "plugin-tab.state": HIDDEN,
    "plugin-tab.acted": HIDDEN,
    "plugins.commits-found": HIDDEN,
    "devices.invited": HIDDEN,
    "address.found": HIDDEN,
    "machines.changed": HIDDEN,
    "machines.hidden": HIDDEN,
    "machine.status": HIDDEN,
    "machine.join-asked": HIDDEN,
    "machine.join-answered": HIDDEN,
    "machine.added": HIDDEN,
    "join-requests.listed": HIDDEN,
    "join-request.answered": HIDDEN,
    "settings.saved": (message) => [message],
    "search.results": HIDDEN,
  };

  return (message, socket) => {
    const view = views[message.type] as View<ServerMessage["type"]> | typeof HIDDEN;
    return view === HIDDEN ? [] : view(message, socket);
  };
}
