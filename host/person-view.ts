import { englishProblem, type HostProblem } from "../shared/host-problems.ts";
import type { CanvasItem, Conversation, ConversationEvent, Profile, StoredEvent } from "../shared/model.ts";
import { DEFAULT_CONVERSATIONS_SHOWN, DEFAULT_OLDER_AFTER, DEFAULT_SIDE_CHAT_ACCESS } from "../shared/model.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { ALL_OF_CLAUDE_SETUP } from "../shared/room-agent-setup.ts";
import { NO_SANDBOX } from "../shared/sandbox.ts";
import type { RoomWorkspaceApproval } from "../shared/room-workspace.ts";
import type { RoomApproval, RoomPresence, RoomTaskApproval } from "../shared/rooms.ts";
import { agentStandIn, broughtAgentName, PROFILES_MODEL, seesAgentsWorkIn, shownOnRoomCanvas, type Room } from "../shared/rooms.ts";
import { PERSON_WITHOUT_A_NAME, personGoesBy } from "../shared/people.ts";
import type { ShownToPerson, SocketData } from "./hub.ts";
import type { Store } from "./store.ts";

const HIDDEN = null;

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;

type View<K extends ServerMessage["type"]> = (message: Extract<ServerMessage, { type: K }>, socket: SocketData) => ServerMessage[];

/**
 * What people in a room know one conversation of its agent by: the room and the agent, and a digest that tells it apart
 * from the agent's other conversations there, as when the room moves to another workspace, without naming it.
 */
export const conversationStandIn = (roomId: string, profileId: string, conversationId: string) =>
  `${agentStandIn(roomId, profileId)}/${new Bun.CryptoHasher("sha256").update(conversationId).digest("hex").slice(0, 16)}`;

/** The conversation a room agent works in now, by the stand-in the person knows it by, in a room where they read the agents' work; null for any other. */
export function conversationBehindStandIn(store: Pick<Store, "roomsOf">, personId: string, standIn: string): string | null {
  const watched = store
    .roomsOf(personId)
    .filter((room) => seesAgentsWorkIn(room, personId))
    .flatMap((room) => room.agents.flatMap(({ profileId, conversationId }) => (conversationId !== null && conversationStandIn(room.id, profileId, conversationId) === standIn ? [conversationId] : [])));
  return watched[0] ?? null;
}

/**
 * A room as a person in it sees it: its people by id and role alone, whom they tag and see vote, nothing of the
 * workspace its agents work in, the models the owner chose for them, what they are given or whether they run in a sandbox, and in place of each
 * agent's conversation there a stand-in that names none; of an agent someone brought, who did, its name and kind,
 * whether it is here, and whether it works in the room's workspace.
 */
const roomSeenBy = ({ id, name, agents, permissions, people, peoplesTasksWait, membersBringAgents, createdAt }: Room): Room => ({
  id,
  name,
  workspaceId: "",
  agents: agents.map(({ profileId, conversationId, answering, brought }) => ({
    profileId,
    conversationId: conversationId === null ? null : conversationStandIn(id, profileId, conversationId),
    answering,
    ...PROFILES_MODEL,
    variables: {},
    wholeHostEnvironment: false,
    ...(brought && { brought: { personId: brought.personId, name: brought.name, harness: brought.harness, here: brought.here, ...(brought.workspace !== undefined && { workspace: brought.workspace }) } }),
  })),
  permissions,
  people: people.map(({ personId, role }) => ({ personId, role })),
  peoplesTasksWait,
  claudeSetup: ALL_OF_CLAUDE_SETUP,
  agentsReadGuests: true,
  membersBringAgents,
  sandbox: NO_SANDBOX,
  createdAt,
});

/** A page or question of a room's agent as people in the room see it: its conversation's stand-in in place of its conversation. */
const canvasItemSeen = (item: CanvasItem, roomId: string, profileId: string): CanvasItem => ({ ...item, conversationId: conversationStandIn(roomId, profileId, item.conversationId) });

/** A request a room's agent waits on, as an approver of the room sees it: its conversation's stand-in in place of its conversation. */
const approvalSeen = (approval: RoomApproval): RoomApproval => ({ ...approval, conversationId: conversationStandIn(approval.roomId, approval.profileId, approval.conversationId) });

/**
 * A room agent's conversation as a person who reads its work sees it: under its stand-in, whether it is at work, and
 * nothing of its settings, its title, what waits in it or what it took.
 */
const conversationSeen = ({ harness, profileId, status, roomId, createdAt, updatedAt }: Conversation, standIn: string): Conversation => ({
  id: standIn,
  workspaceId: "",
  harness,
  profileId,
  title: "",
  titleSetByUser: false,
  acpSessionId: null,
  askMode: "wait",
  bypassPermissions: false,
  status,
  statusDetail: null,
  openInTerminal: null,
  contextUsage: null,
  queuedMessages: [],
  usageLimit: null,
  jobWaits: [],
  asyncTasks: [],
  waitingFor: null,
  pendingRequest: null,
  lastWords: null,
  activity: null,
  configOptions: [],
  position: 0,
  ...(roomId !== undefined && { roomId }),
  createdAt,
  updatedAt,
});

/** What of a turn's end a person who reads the agent's work sees: not what the turn took or on which model, which the room tells its owner alone. */
const MEASURES_SEEN = ["startedAt", "toolCalls", "filesEdited"] as const;

const measuresSeen = (spend: Partial<Record<(typeof MEASURES_SEEN)[number], number>>) =>
  Object.fromEntries(MEASURES_SEEN.flatMap((measure) => (spend[measure] === undefined ? [] : [[measure, spend[measure]]])));

/** What an agent's session tells of its own state, which is the owner's: its commands, its title and its model choices. */
const OWNERS_SESSION_STATE = new Set(["available_commands_update", "session_info_update", "config_option_update"]);

type ConversationError = Extract<ConversationEvent, { type: "error" }>;

/** Any other error is about the owner's setup, and may hold what the owner's commands printed. */
const cameOfAgentsWork = ({ continuable, usageLimit }: ConversationError) => continuable === true || usageLimit !== undefined;

const TURN_NOT_STARTED: HostProblem = { code: "room-agent-turn-not-started" };

function errorSeen(event: ConversationError): ConversationError | null {
  const { message, problem, usageLimit, authRequired, continuable, endsTurn } = event;
  if (cameOfAgentsWork(event)) {
    return { type: "error", message, ...(problem && { problem }), ...(usageLimit && { usageLimit }), ...(authRequired && { authRequired }), ...(continuable && { continuable }), ...(endsTurn && { endsTurn }), ...measuresSeen(event) };
  }
  return endsTurn ? { type: "error", message: englishProblem(TURN_NOT_STARTED), problem: TURN_NOT_STARTED, endsTurn, ...measuresSeen(event) } : null;
}

/**
 * An event of a room agent's conversation as a person who reads its work sees it: none of the session's own state, a
 * turn's end or failure without what it took, and of a turn that could not start only that; null for one they don't see.
 */
export function eventSeen(stored: StoredEvent): StoredEvent | null {
  const { event } = stored;
  if (event.type === "acp" && OWNERS_SESSION_STATE.has(event.update.sessionUpdate)) return null;
  if (event.type === "user-message" && event.imageIds?.length) {
    const { imageIds: _omitted, ...rest } = event;
    return { ...stored, event: rest };
  }
  if (event.type === "turn-end") return { ...stored, event: { type: "turn-end", stopReason: event.stopReason, ...(event.cutShortByRestart && { cutShortByRestart: true }), ...measuresSeen(event) } };
  if (event.type === "error") {
    const error = errorSeen(event);
    return error && { ...stored, event: error };
  }
  return stored;
}

const eventsSeen = (events: StoredEvent[]) => events.flatMap((event) => eventSeen(event) ?? []);

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

/** What the rooms call the agents people brought into them. */
export function broughtAgentNamesIn(store: Pick<Store, "listPeople">, rooms: Room[]) {
  const people = store.listPeople();
  return rooms.flatMap(({ agents }) =>
    agents.flatMap(({ brought }) => (brought ? [broughtAgentName(personGoesBy(people.find(({ id }) => id === brought.personId), PERSON_WITHOUT_A_NAME), brought.name)] : [])),
  );
}

/** The names of the people and agents a person other than the owner sees, their own left out: whether one is taken tells them of nobody they don't see. */
export const namesOthersGoBy = (store: PeopleSeen & Pick<Store, "listProfiles">, personId: string) => [
  ...peopleSeenBy(store, personId).flatMap(({ id, name }) => (id === personId ? [] : [name])),
  ...agentsOfRooms(store, store.roomsOf(personId)).map(({ name }) => name),
  ...broughtAgentNamesIn(store, store.roomsOf(personId)),
];

/** The names a room shows and frames, a person's own left out: its owner's, its people's and those of who wrote there, and its agents'. */
export function namesShownIn(store: PeopleSeen & Pick<Store, "listProfiles" | "writersIn">, room: Room, besides: string) {
  const shown = new Set([store.ownerId(), ...room.people.map(({ personId }) => personId), ...store.writersIn(room.id)]);
  shown.delete(besides);
  return [
    ...store.listPeople().flatMap(({ id, name }) => (shown.has(id) ? [name] : [])),
    ...agentsOfRooms(store, [room]).map(({ name }) => name),
    ...broughtAgentNamesIn(store, [room]),
  ];
}

/**
 * What a signed-in person other than the machine's owner sees of each message the host sends: their rooms, the people
 * and agents in them, those rooms' messages and canvases, and in a room they approve in, what waits for an approver
 * there, as made for them; nothing else. A message type missing here
 * does not compile.
 */
export function personView(store: PeopleSeen & Pick<Store, "findRoom" | "listProfiles" | "findConversation" | "findRoomThread" | "findRoomBroughtCanvasItem">): ShownToPerson {
  const isIn = (socket: SocketData, roomId: string) => store.findRoom(roomId)?.people.some(({ personId }) => personId === socket.personId) === true;
  const shownIf = (shown: boolean, message: ServerMessage) => (shown ? [message] : []);
  const readsAgentsWorkIn = (socket: SocketData, roomId: string) => {
    const room = store.findRoom(roomId);
    return room !== undefined && seesAgentsWorkIn(room, socket.personId);
  };
  const waitsFor = (socket: SocketData) => (waiting: RoomApproval | RoomTaskApproval | RoomWorkspaceApproval) => isIn(socket, waiting.roomId) && waiting.approvers.includes(socket.personId);

  const agentsOf = (rooms: Room[]) => agentsOfRooms(store, rooms);

  /** The agents' conversations of the room whose work the person reads there, each by its real id with its stand-in. */
  const watchedIn = (room: Room, personId: string) =>
    new Map(
      seesAgentsWorkIn(room, personId)
        ? room.agents.flatMap(({ profileId, conversationId }) => (conversationId === null ? [] : [[conversationId, conversationStandIn(room.id, profileId, conversationId)] as const]))
        : [],
    );

  /** A conversation an agent works in now, by its stand-in and room, in a room where the person reads the agents' work; null for any other. */
  const watched = (conversationId: string, socket: SocketData) => {
    const roomId = store.findConversation(conversationId)?.roomId;
    const room = typeof roomId === "string" ? store.findRoom(roomId) : undefined;
    const standIn = room && watchedIn(room, socket.personId).get(conversationId);
    return room && standIn ? { standIn, roomId: room.id } : null;
  };

  const watchedStandIn = (conversationId: string, socket: SocketData) => watched(conversationId, socket)?.standIn ?? null;

  /** The page is told of a conversation it may read, under its stand-in; one it was told of and may read no longer, of the agent's past ones or after a change of role, goes, and so does following it. */
  const watchedConversationsNews = (room: Room, socket: SocketData, conversations: Conversation[]): ServerMessage[] => {
    const readable = watchedIn(room, socket.personId);
    const gone = [...socket.agentConversationsShown].filter(([conversationId, shown]) => shown.roomId === room.id && !readable.has(conversationId));
    gone.forEach(([conversationId]) => {
      socket.agentConversationsShown.delete(conversationId);
      socket.subscriptions.delete(conversationId);
      socket.lowDataSubscriptions.delete(conversationId);
    });
    const added = conversations.flatMap((conversation) => {
      const standIn = readable.get(conversation.id);
      if (standIn === undefined || socket.agentConversationsShown.has(conversation.id)) return [];
      socket.agentConversationsShown.set(conversation.id, { standIn, roomId: room.id });
      return [{ type: "conversation.upserted", conversation: conversationSeen(conversation, standIn) } satisfies ServerMessage];
    });
    return [...gone.map(([, { standIn }]): ServerMessage => ({ type: "conversation.deleted", conversationId: standIn })), ...added];
  };

  const agentConversationsOf = (room: Room) =>
    room.agents.flatMap(({ conversationId }) => {
      const conversation = conversationId === null ? undefined : store.findConversation(conversationId);
      return conversation ? [conversation] : [];
    });
  const isAgentOfTheirRooms = (profileId: string, socket: SocketData) =>
    store.roomsOf(socket.personId).some(({ agents }) => agents.some((agent) => agent.profileId === profileId));
  const peopleSeen = (personId: string) => peopleSeenBy(store, personId);

  /** The room as it is now for a person in it, with its agents, which they may not have been told of; for a person just taken out of it, that it is gone. */
  const roomNewsFor = (room: Room, socket: SocketData): ServerMessage[] => {
    const conversations = watchedConversationsNews(room, socket, agentConversationsOf(room));
    if (room.people.some(({ personId }) => personId === socket.personId)) {
      socket.roomsShown.add(room.id);
      const agents = agentsOf([room]).map((profile): ServerMessage => ({ type: "profile.upserted", profile: agentSeen(profile) }));
      return [...agents, ...conversations, { type: "room.upserted", room: roomSeenBy(room) }];
    }
    socket.roomSubscriptions.delete(room.id);
    return [...conversations, ...shownIf(socket.roomsShown.delete(room.id), { type: "room.deleted", roomId: room.id })];
  };

  const canvasItemFor = (item: CanvasItem, socket: SocketData): ServerMessage[] => {
    if (!shownOnRoomCanvas(item)) return [];
    const conversation = store.findConversation(item.conversationId);
    if (conversation) {
      const roomId = conversation.roomId;
      if (typeof roomId !== "string" || conversation.profileId == null || !isIn(socket, roomId)) return [];
      return [{ type: "canvas.upserted", item: canvasItemSeen(item, roomId, conversation.profileId) }];
    }
    const brought = store.findRoomBroughtCanvasItem(item.id);
    if (!brought || !isIn(socket, brought.roomId)) return [];
    return [{ type: "canvas.upserted", item }];
  };

  const timelineCanvasSeen = (roomId: string, items: CanvasItem[]) => {
    const agents = store.findRoom(roomId)?.agents ?? [];
    return items.flatMap((item) => {
      const profileId = agents.find(({ conversationId }) => conversationId === item.conversationId)?.profileId;
      if (profileId !== undefined) return [canvasItemSeen(item, roomId, profileId)];
      return item.conversationId.startsWith(`${roomId}/`) ? [item] : [];
    });
  };

  /** Of who is in their room now, only the people they see, each writing in the room or in one of its threads. */
  const presenceSeen = (roomId: string, { here, writing }: RoomPresence, socket: SocketData): RoomPresence => {
    const seen = new Set(peopleSeen(socket.personId).map(({ id }) => id));
    const inTheRoom = (threadId: string | null) => threadId === null || store.findRoomThread(threadId)?.roomId === roomId;
    return { here: here.filter((personId) => seen.has(personId)), writing: writing.filter(({ personId, threadId }) => seen.has(personId) && inTheRoom(threadId)) };
  };

  const snapshotFor = ({ hostRunId, roomApprovals, roomTasksWaiting, roomWorkspaceWaiting, conversations }: Snapshot, socket: SocketData): Snapshot => {
    const rooms = store.roomsOf(socket.personId);
    rooms.forEach(({ id }) => socket.roomsShown.add(id));
    socket.agentConversationsShown.clear();
    const conversationsNews = rooms.flatMap((room) => watchedConversationsNews(room, socket, conversations));
    return {
      type: "snapshot",
      workspaces: [],
      workspaceGroups: [],
      conversations: conversationsNews.flatMap((message) => (message.type === "conversation.upserted" ? [message.conversation] : [])),
      rooms: rooms.map(roomSeenBy),
      roomApprovals: roomApprovals.filter(waitsFor(socket)).map(approvalSeen),
      roomTasksWaiting: roomTasksWaiting.filter(waitsFor(socket)),
      roomWorkspaceWaiting: roomWorkspaceWaiting.filter(waitsFor(socket)),
      sandboxSetups: [],
      heldChanges: [],
      sandboxesHoldingTooMany: [],
      sandboxFolders: [],
      roomInvites: [],
      roomJoiners: [],
      broughtAgents: [],
      broughtTasks: [],
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
      sideChatAccess: DEFAULT_SIDE_CHAT_ACCESS,
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
    "settings.side-chat-access": HIDDEN,
    "settings.exported": HIDDEN,
    "settings.export-saved": HIDDEN,
    "settings.import-planned": HIDDEN,
    "settings.imported": HIDDEN,
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
    "workspace.icon": HIDDEN,
    "workspace-group.upserted": HIDDEN,
    "workspace-group.deleted": HIDDEN,
    "conversation.upserted": ({ conversation }, socket) => {
      const shown = watched(conversation.id, socket);
      if (shown === null) return [];
      socket.agentConversationsShown.set(conversation.id, shown);
      return [{ type: "conversation.upserted", conversation: conversationSeen(conversation, shown.standIn) }];
    },
    "conversation.deleted": ({ conversationId }, socket) => {
      const shown = socket.agentConversationsShown.get(conversationId);
      if (!shown) return [];
      socket.agentConversationsShown.delete(conversationId);
      return [{ type: "conversation.deleted", conversationId: shown.standIn }];
    },
    "room.created": HIDDEN,
    "room.upserted": ({ room }, socket) => roomNewsFor(room, socket),
    "room.deleted": (message, socket) => shownIf(socket.roomsShown.delete(message.roomId), message),
    "room.invited": HIDDEN,
    "room-invites.listed": HIDDEN,
    "room-joiners.listed": HIDDEN,
    "rooms.waiting-to-join": (message, socket) => shownIf(message.personId === socket.personId, message),
    "room.timeline": (message, socket) =>
      shownIf(isIn(socket, message.roomId), {
        ...message,
        canvas: timelineCanvasSeen(message.roomId, message.canvas),
        workspaceCalls: readsAgentsWorkIn(socket, message.roomId) ? message.workspaceCalls : [],
        broughtSteps: readsAgentsWorkIn(socket, message.roomId) ? message.broughtSteps : [],
      }),
    "room.message": (message, socket) => shownIf(isIn(socket, message.message.roomId), message),
    "room.votes": (message, socket) => shownIf(isIn(socket, message.roomId), message),
    "rooms.reading": ({ personId, readings }, socket) =>
      shownIf(personId === socket.personId, { type: "rooms.reading", personId, readings: readings.filter(({ roomId }) => isIn(socket, roomId)) }),
    "room.alert": (message, socket) => shownIf(message.personId === socket.personId && isIn(socket, message.roomId), message),
    /** Everyone in the room hears of it, so that a person no longer an approver drops what waited for them. */
    "room.approvals": ({ roomId, approvals, tasks, workspace }, socket) =>
      shownIf(isIn(socket, roomId), { type: "room.approvals", roomId, approvals: approvals.filter(waitsFor(socket)).map(approvalSeen), tasks: tasks.filter(waitsFor(socket)), workspace: workspace.filter(waitsFor(socket)) }),
    "room.workspace-call-shown": (message, socket) => shownIf(readsAgentsWorkIn(socket, message.call.roomId), message),
    "room.brought-step-shown": (message, socket) => shownIf(readsAgentsWorkIn(socket, message.step.roomId), message),
    "room.workspace-answered": (message, socket) => shownIf(message.personId === socket.personId && socket.carriesAgents, message),
    "room.sandbox-checked": HIDDEN,
    "workspace.sandbox-checked": HIDDEN,
    "sandbox.setup": HIDDEN,
    "sandbox.held-changes": HIDDEN,
    "sandbox.held-change-text": HIDDEN,
    "sandbox.folder-added": HIDDEN,
    "sandbox.folder-access-set": HIDDEN,
    "sandbox.folders": HIDDEN,
    "room.presence": ({ roomId, here, writing }, socket) => shownIf(isIn(socket, roomId), { type: "room.presence", roomId, ...presenceSeen(roomId, { here, writing }, socket) }),
    "room.usage.got": HIDDEN,
    "room.agent-brought": (message, socket) => shownIf(message.personId === socket.personId, message),
    "room.brought-task": (message, socket) => shownIf(message.personId === socket.personId && socket.carriesAgents, message),
    "room.brought-ask-answered": (message, socket) => shownIf(message.personId === socket.personId && socket.carriesAgents, message),
    "brought-agents.listed": HIDDEN,
    "machine.agent-brought": HIDDEN,
    "rooms.people-here": HIDDEN,
    "conversation.history": (message, socket) => {
      const standIn = watchedStandIn(message.conversationId, socket);
      if (standIn === null) return [];
      const canvas = message.canvas.filter(shownOnRoomCanvas).map((item) => ({ ...item, conversationId: standIn }));
      return [{ ...message, conversationId: standIn, events: eventsSeen(message.events), canvas }];
    },
    "conversation.earlier": (message, socket) => {
      const standIn = watchedStandIn(message.conversationId, socket);
      return standIn === null ? [] : [{ ...message, conversationId: standIn, events: eventsSeen(message.events) }];
    },
    "tool-output.got": HIDDEN,
    "conversation.found": HIDDEN,
    /** Only ever the answer to the page that asked, which the host let ask only of a conversation it reads. */
    "tool-raw-output.got": (message) => [message],
    "async-task.output.got": HIDDEN,
    "conversation.event": ({ conversationId, event }, socket) => {
      const standIn = watchedStandIn(conversationId, socket);
      const seen = standIn === null ? null : eventSeen(event);
      return standIn === null || seen === null ? [] : [{ type: "conversation.event", conversationId: standIn, event: seen }];
    },
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
