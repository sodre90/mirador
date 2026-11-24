import { useEffect, useId, useRef, useState, type CSSProperties, type Dispatch, type RefObject } from "react";
import { workspaceMarkColor } from "../shared/marks.ts";
import type { BroughtAgentHere } from "../shared/brought-agents.ts";
import type { JoinedRoom, Machine, MachineStatus, Person, Profile, RoomKnock } from "../shared/model.ts";
import { personGoesBy } from "../shared/people.ts";
import type { RoomReading } from "../shared/room-reading.ts";
import { broughtAgentName, type Room } from "../shared/rooms.ts";
import { placedBelow, useClosing } from "./BarMenu.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { useClosingWhenFocusLeavesPage } from "./ContextMenu.tsx";
import { formatNumber, t } from "./i18n/index.ts";
import { LayoutToggles } from "./LayoutToggles.tsx";
import { LineIcon } from "./LineIcon.tsx";
import { machineRemovalAsked, removeMachine } from "./machine-removal.ts";
import { pastelVariables } from "./pastels.ts";
import type { AppAction, AppState } from "./state.ts";
import { waitingLabels, type RoomWait } from "./waiting.ts";

const words = t.rooms;

/** A room of someone else's machine this computer joined, as that machine lists it: display data, never a room of this one. */
export interface JoinedRoomShown {
  machine: Machine;
  status: MachineStatus | undefined;
  room: JoinedRoom;
}

/** The rooms someone else's machines list for this computer's owner, each with its machine. */
export function joinedRoomsOf(machines: Machine[], statuses: MachineStatus[]): JoinedRoomShown[] {
  return machines
    .filter(({ asPerson }) => asPerson)
    .flatMap((machine) => {
      const status = statuses.find(({ machineId }) => machineId === machine.id);
      return (status?.rooms ?? []).map((room) => ({ machine, status, room }));
    });
}

/** The joined room the window shows: the one selected, or where its machine alone is, the first that machine lists. */
export const joinedRoomShown = (selected: AppState["selectedJoinedRoom"], joinedRooms: JoinedRoomShown[]) =>
  joinedRooms.find(({ machine, room }) => machine.id === selected?.machineId && (selected.roomId === null || selected.roomId === room.id));

/** A room of someone else's machine this computer's owner waits to be let into, or was turned away from, with its machine. */
export interface KnockShown {
  machine: Machine;
  knock: RoomKnock;
}

/** Every room door this computer's owner stands at on someone else's machines. */
export const knocksOf = (machines: Machine[]): KnockShown[] => machines.filter(({ asPerson }) => asPerson).flatMap((machine) => machine.knocks.map((knock) => ({ machine, knock })));

/** What someone else's machines have for this computer's owner. */
interface Invited {
  joinedRooms: JoinedRoomShown[];
  knocks: KnockShown[];
  /** Those this computer isn't signed in to, as their owner signed it out or it has yet to join, until a new invite is pasted there. */
  machinesToComeBackTo: Machine[];
}

export const invitedOf = (machines: Machine[], statuses: MachineStatus[]): Invited => ({
  joinedRooms: joinedRoomsOf(machines, statuses),
  knocks: knocksOf(machines),
  machinesToComeBackTo: machines.filter(({ asPerson, joined, knocks }) => asPerson && !joined && knocks.length === 0),
});

const knockKey = (machineId: string, roomId: string) => JSON.stringify([machineId, roomId]);

/** A room this computer's owner waited at the door of opens once its owner lets them in, as a room joined at once does. */
export function useOpenedWhenLetIn(machines: Machine[], statuses: MachineStatus[], open: (machineId: string, roomId: string) => void) {
  const waitedAt = useRef<Set<string> | null>(null);
  useEffect(() => {
    const waitingAt = new Set(knocksOf(machines).flatMap(({ machine, knock }) => (knock.turnedAway ? [] : [knockKey(machine.id, knock.roomId)])));
    const waitedBefore = waitedAt.current;
    waitedAt.current = waitingAt;
    if (!waitedBefore) return;
    joinedRoomsOf(machines, statuses)
      .filter(({ machine, room }) => waitedBefore.has(knockKey(machine.id, room.id)) && !waitingAt.has(knockKey(machine.id, room.id)))
      .forEach(({ machine, room }) => open(machine.id, room.id));
  }, [machines, statuses]);
}

/** What a room door says of this computer's owner, by the name its machine's owner goes by when it said one. */
function knockText({ ownerName }: Machine, { turnedAway }: RoomKnock) {
  if (turnedAway) return ownerName ? words.turnedAwayBy(ownerName) : words.turnedAwayNoName;
  return ownerName ? words.waitingToBeLetIn(ownerName) : words.waitingToBeLetInNoName;
}

/** A room of someone else's machine has a hollow mark, in its machine's colour. */
export function JoinedRoomMark({ machine }: { machine: Machine }) {
  return <RoomMark hollow style={machine.color ? { ...pastelVariables(machine.color), "--room-mark": "var(--pastel-stripe)" } : { "--room-mark": workspaceMarkColor(machine.name) }} />;
}

const dismissKnock = (machineId: string, roomId: string) => connection.send({ type: "machine.dismiss-knock", machineId, roomId });

/**
 * The main pane while this computer's owner stands at a room's door on someone else's machine: whose OK they wait for,
 * on which machine, that the room opens by itself once they are let in and that they need not keep the page open; or
 * that they were turned away, which they put away.
 */
export function KnockView({ machine, knock }: KnockShown) {
  return (
    <>
      <div className="empty-state-bar" data-pane-bar>
        <LayoutToggles />
      </div>
      <section className={`empty-state room-knock-view${knock.turnedAway ? " turned-away" : ""}`} aria-label={knockText(machine, knock)}>
        <JoinedRoomMark machine={machine} />
        <h2>{knockText(machine, knock)}</h2>
        {knock.turnedAway ? (
          <>
            <p>{words.turnedAwayFrom(machine.name)}</p>
            <button type="button" onClick={() => dismissKnock(machine.id, knock.roomId)}>
              {words.dismissKnock}
            </button>
          </>
        ) : (
          <>
            <p>{words.knockedOn(machine.name)}</p>
            <p>{words.mayCloseWhileWaiting}</p>
          </>
        )}
      </section>
    </>
  );
}

/** Under a room's name: the people in it besides its owner, and its agents, or that it has none yet. */
function roomSubline(room: Room, profiles: Profile[], people: Person[], manages: boolean) {
  const agents = room.agents.map(({ profileId, brought }) =>
    brought
      ? broughtAgentName(personGoesBy(people.find(({ id }) => id === brought.personId), words.nameless), brought.name)
      : (profiles.find(({ id }) => id === profileId)?.name ?? words.agentGone),
  );
  return [manages && room.people.length > 0 && words.peopleCount(room.people.length), agents.length > 0 ? agents.join(", ") : words.noAgentsYet].filter(Boolean).join(" · ");
}

function RoomMark({ style, hollow = false }: { style: CSSProperties & { "--room-mark": string }; hollow?: boolean }) {
  return (
    <span className={`room-mark${hollow ? " hollow" : ""}`} style={style} aria-hidden="true">
      #
    </span>
  );
}

/** Whose room it is and on which machine, as far as its owner has said a name. */
const ownerAndMachine = ({ ownerName, name }: Machine) => (ownerName ? `${ownerName} · ${name}` : words.onMachine(name));

type ReadingCounts = Pick<RoomReading, "unread" | "mentions" | "toConfirm" | "toApprove" | "muted">;

const NOTHING_UNREAD: ReadingCounts = { unread: 0, mentions: 0, toConfirm: 0, toApprove: 0, muted: false };

const needsYou = (waiting: RoomWait | undefined, { toConfirm, toApprove }: ReadingCounts) => waiting !== undefined || toConfirm > 0 || toApprove > 0;

/** What the pill says waits: what the room's own host tells this page, or else what another machine counted for you. */
function needsYouHint(waiting: RoomWait | undefined, { toApprove }: ReadingCounts) {
  if (waiting) return roomWaitHints[waiting];
  return toApprove > 0 ? words.answerWaits : words.waitsForYourConfirm;
}

const readingClasses = ({ unread, muted }: ReadingCounts) => [unread > 0 && "unread", muted && "muted"];

const roomWaitHints: Record<RoomWait, string> = {
  answer: words.answerWaits,
  "held-change": words.heldChangeWaits,
  door: words.doorWaits,
};

/** What a room holds for you: a mark where you were tagged, how many messages you have not read, and "Needs you" where something waits for you. */
function ReadingMarks({ reading, waiting }: { reading: ReadingCounts; waiting?: RoomWait }) {
  return (
    <>
      {reading.mentions > 0 && (
        <span className="waiting-count tone-decision room-tagged" role="img" aria-label={words.taggedHere} data-hint={words.taggedHere}>
          @
        </span>
      )}
      {reading.unread > 0 && (
        <span className="waiting-count tone-unread room-unread" role="img" aria-label={words.unreadCount(reading.unread)} data-hint={words.unreadCount(reading.unread)}>
          {formatNumber(reading.unread)}
        </span>
      )}
      {needsYou(waiting, reading) && (
        <span className="waiting-pill tone-decision" data-hint={needsYouHint(waiting, reading)}>
          {waitingLabels.decision}
        </span>
      )}
    </>
  );
}

const isMutedHere = ({ status, room }: JoinedRoomShown) => status?.mutedHere.includes(room.id) === true;

/** Keeps a room of someone else's machine quiet on this computer, whatever that machine does; muted there, it is quiet too. */
export function MuteHereToggle({ joined }: { joined: JoinedRoomShown }) {
  const mutedHere = isMutedHere(joined);
  return (
    <button
      type="button"
      className={`icon room-mute${mutedHere ? " muted" : ""}`}
      aria-label={words.muteRoom}
      aria-pressed={mutedHere}
      data-hint={mutedHere ? words.mutedHint : words.muteRoom}
      onClick={(event) => {
        event.stopPropagation();
        connection.send({ type: "machine.mute-room", machineId: joined.machine.id, roomId: joined.room.id, muted: !mutedHere });
      }}
    >
      <LineIcon shape={mutedHere ? "bellOff" : "bell"} />
    </button>
  );
}

interface RoomMenuEntry {
  label: string;
  onChoose: () => void;
  /** Asks again in place before it is chosen. */
  asked?: { label: string; armedText: string; armedHint: string };
}

function OpenRoomMenu({ roomName, entries, opener, placement, onClose }: { roomName: string; entries: RoomMenuEntry[]; opener: RefObject<HTMLElement | null>; placement: CSSProperties; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  useClosing(true, [opener, menu], onClose);
  useClosingWhenFocusLeavesPage(onClose);
  const choose = (entry: RoomMenuEntry) => {
    onClose();
    entry.onChoose();
  };
  return (
    <div ref={menu} className="add-room-menu" role="menu" aria-label={words.moreFor(roomName)} style={placement}>
      {entries.map((entry, index) =>
        entry.asked ? (
          <ConfirmButton key={index} role="menuitem" className="danger" {...entry.asked} onConfirm={() => choose(entry)}>
            {entry.label}
          </ConfirmButton>
        ) : (
          <button key={index} type="button" role="menuitem" onClick={() => choose(entry)}>
            {entry.label}
          </button>
        ),
      )}
    </div>
  );
}

/** A room's "⋯", and what it offers. */
function RoomMenu({ roomName, entries }: { roomName: string; entries: RoomMenuEntry[] }) {
  const opener = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  return (
    <span className="room-menu" onClick={(event) => event.stopPropagation()}>
      <button
        ref={opener}
        type="button"
        className="icon"
        aria-label={words.moreFor(roomName)}
        aria-haspopup="menu"
        aria-expanded={placement !== null}
        onClick={(event) => setPlacement(placement ? null : placedBelow(event.currentTarget))}
      >
        ⋯
      </button>
      {placement && <OpenRoomMenu roomName={roomName} entries={entries} opener={opener} placement={placement} onClose={() => setPlacement(null)} />}
    </span>
  );
}

const ownRoomEntries = (room: Room, dispatch: Dispatch<AppAction>): RoomMenuEntry[] => [
  { label: words.inviteSomeone, onChoose: () => dispatch({ type: "open-overlay", overlay: { kind: "room-invite", roomId: room.id } }) },
  { label: words.editRoom, onChoose: () => dispatch({ type: "open-overlay", overlay: { kind: "room", roomId: room.id } }) },
  { label: words.deleteRoom, asked: { label: words.deleteRoom, armedText: words.deleteArmed, armedHint: words.deleteArmedHint }, onChoose: () => connection.send({ type: "room.delete", roomId: room.id }) },
];

/** Of a room of someone else's machine: bringing an agent of your own into it, taking out those you brought, and leaving it. */
const joinedRoomEntries = ({ machine, room }: JoinedRoomShown, brought: BroughtAgentHere[], profiles: Profile[], dispatch: Dispatch<AppAction>): RoomMenuEntry[] => [
  { label: words.bringAgent, onChoose: () => dispatch({ type: "open-overlay", overlay: { kind: "bring-agent", machineId: machine.id, roomId: room.id } }) },
  ...brought.map(({ id, profileId }) => ({
    label: words.takeOutAgent(profiles.find((profile) => profile.id === profileId)?.name ?? words.agentGone),
    onChoose: () => connection.send({ type: "machine.take-agent-out", broughtId: id }),
  })),
  {
    label: words.leaveRoom,
    asked: { label: words.leaveRoom, armedText: words.leaveArmed, armedHint: words.leaveArmedHint },
    onChoose: () => {
      connection.send({ type: "machine.leave-room", machineId: machine.id, roomId: room.id });
      dispatch({ type: "leave-joined-room", machineId: machine.id, roomId: room.id });
    },
  },
];

const broughtInto = ({ machine, room }: JoinedRoomShown, broughtAgents: BroughtAgentHere[]) => broughtAgents.filter(({ machineId, roomId }) => machineId === machine.id && roomId === room.id);

export function JoinedRoomMenu({ joined, broughtAgents, profiles, dispatch }: { joined: JoinedRoomShown; broughtAgents: BroughtAgentHere[]; profiles: Profile[]; dispatch: Dispatch<AppAction> }) {
  return <RoomMenu roomName={joined.room.name} entries={joinedRoomEntries(joined, broughtInto(joined, broughtAgents), profiles, dispatch)} />;
}

/** The section's "+": a new room of this machine, or joining someone else's with their invite. */
function AddRoomMenu({ canJoin, dispatch }: { canJoin: boolean; dispatch: Dispatch<AppAction> }) {
  const opener = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  const open = placement !== null;
  useClosing(open, [opener, menu], () => setPlacement(null));
  const choose = (overlay: { kind: "new-room" } | { kind: "join-room" }) => {
    setPlacement(null);
    dispatch({ type: "open-overlay", overlay });
  };
  if (!canJoin)
    return (
      <button type="button" className="icon workspace-new" aria-label={words.newRoom} onClick={() => choose({ kind: "new-room" })}>
        +
      </button>
    );
  return (
    <>
      <button ref={opener} type="button" className="icon workspace-new" aria-label={words.addRoom} aria-haspopup="menu" aria-expanded={open} onClick={(event) => setPlacement(open ? null : placedBelow(event.currentTarget))}>
        +
      </button>
      {open && (
        <div ref={menu} className="add-room-menu" role="menu" aria-label={words.addRoom} style={placement}>
          <button type="button" role="menuitem" onClick={() => choose({ kind: "new-room" })}>
            {words.newRoom}
          </button>
          <button type="button" role="menuitem" onClick={() => choose({ kind: "join-room" })}>
            {words.joinRoom}
          </button>
        </div>
      )}
    </>
  );
}

function JoinedRoomCard({
  joined,
  selected,
  broughtAgents,
  profiles,
  dispatch,
  onOpen,
}: {
  joined: JoinedRoomShown;
  selected: boolean;
  broughtAgents: BroughtAgentHere[];
  profiles: Profile[];
  dispatch: Dispatch<AppAction>;
  onOpen: () => void;
}) {
  const { machine, status, room } = joined;
  const away = status?.reachable === false;
  const agentNames = broughtInto(joined, broughtAgents).map(({ profileId }) => profiles.find(({ id }) => id === profileId)?.name ?? words.agentGone);
  return (
    <li
      className={["room-card", "joined-room", selected && "selected", away && "away", needsYou(undefined, room) && "waiting", ...readingClasses({ ...room, muted: room.muted || isMutedHere(joined) })].filter(Boolean).join(" ")}
      data-waiting-tone={needsYou(undefined, room) ? "decision" : undefined}
      data-machine={machine.id}
      onClick={onOpen}
    >
      <JoinedRoomMark machine={machine} />
      <span className="room-card-text">
        <span className="room-card-name">{room.name}</span>
        <span className="room-card-subline">{[ownerAndMachine(machine), away && t.shell.machines.notAnswering, ...agentNames].filter(Boolean).join(" · ")}</span>
      </span>
      <ReadingMarks reading={room} />
      <MuteHereToggle joined={joined} />
      <JoinedRoomMenu joined={joined} broughtAgents={broughtAgents} profiles={profiles} dispatch={dispatch} />
    </li>
  );
}

function KnockCard({ machine, knock, selected, dispatch }: KnockShown & { selected: boolean; dispatch: Dispatch<AppAction> }) {
  return (
    <li
      className={["room-card", "room-knock", knock.turnedAway && "turned-away", selected && "selected"].filter(Boolean).join(" ")}
      data-machine={machine.id}
      onClick={() => dispatch({ type: "select-knock", machineId: machine.id, roomId: knock.roomId })}
    >
      <JoinedRoomMark machine={machine} />
      <span className="room-card-text">
        <span className="room-card-name">{knockText(machine, knock)}</span>
        <span className="room-card-subline">{words.onMachine(machine.name)}</span>
      </span>
      {knock.turnedAway && (
        <button
          type="button"
          className="link"
          onClick={(event) => {
            event.stopPropagation();
            dismissKnock(machine.id, knock.roomId);
          }}
        >
          {words.dismissKnock}
        </button>
      )}
    </li>
  );
}

/** Opens where a new invite is pasted to come back to its rooms. */
function MachineToComeBackToCard({ machine, selected, onOpen }: { machine: Machine; selected: boolean; onOpen: () => void }) {
  return (
    <li className={["room-card", "machine-to-come-back-to", selected && "selected"].filter(Boolean).join(" ")} data-machine={machine.id} onClick={onOpen}>
      <JoinedRoomMark machine={machine} />
      <span className="room-card-text">
        <span className="room-card-name">{machine.name}</span>
        <span className="room-card-subline">{machine.outOfRooms ? words.signedOutByOwner : t.shell.machines.notJoinedYet}</span>
      </span>
      <RoomMenu roomName={machine.name} entries={[{ label: t.shell.machines.remove, asked: machineRemovalAsked(machine), onChoose: () => removeMachine(machine.id) }]} />
    </li>
  );
}

function InvitedRooms({
  invited: { joinedRooms, knocks, machinesToComeBackTo },
  selectedKnock,
  selectedJoinedRoom,
  broughtAgents,
  profiles,
  dispatch,
  onOpenJoinedRoom,
}: {
  invited: Invited;
  selectedKnock: AppState["selectedKnock"];
  selectedJoinedRoom: AppState["selectedJoinedRoom"];
  broughtAgents: BroughtAgentHere[];
  profiles: Profile[];
  dispatch: Dispatch<AppAction>;
  onOpenJoinedRoom: (machineId: string, roomId: string | null) => void;
}) {
  const heading = useId();
  if (joinedRooms.length + knocks.length + machinesToComeBackTo.length === 0) return null;
  const joinedShown = joinedRoomShown(selectedJoinedRoom, joinedRooms);
  return (
    <>
      <h3 id={heading} className="rooms-invited-heading">
        {words.invited}
      </h3>
      <ul aria-labelledby={heading}>
        {joinedRooms.map((joined) => (
          <JoinedRoomCard
            key={`${joined.machine.id}:${joined.room.id}`}
            joined={joined}
            selected={joined === joinedShown}
            broughtAgents={broughtAgents}
            profiles={profiles}
            dispatch={dispatch}
            onOpen={() => onOpenJoinedRoom(joined.machine.id, joined.room.id)}
          />
        ))}
        {knocks.map(({ machine, knock }) => (
          <KnockCard
            key={`knock:${machine.id}:${knock.roomId}`}
            machine={machine}
            knock={knock}
            selected={selectedKnock?.machineId === machine.id && selectedKnock.roomId === knock.roomId}
            dispatch={dispatch}
          />
        ))}
        {machinesToComeBackTo.map((machine) => (
          <MachineToComeBackToCard key={`machine:${machine.id}`} machine={machine} selected={selectedJoinedRoom?.machineId === machine.id} onOpen={() => onOpenJoinedRoom(machine.id, null)} />
        ))}
      </ul>
    </>
  );
}

export function RoomsSection({
  rooms,
  profiles,
  selectedRoomId,
  roomsWaiting,
  readings,
  roomsWithPeopleHere = [],
  invited,
  selectedKnock = null,
  selectedJoinedRoom = null,
  people,
  broughtAgents = [],
  manages,
  dispatch,
  onOpenJoinedRoom,
}: {
  rooms: Room[];
  profiles: Profile[];
  selectedRoomId: string | null;
  roomsWaiting: ReadonlyMap<string, RoomWait>;
  /** How far you have read each room, and what waits for you there. */
  readings: RoomReading[];
  /** The rooms someone other than the owner is in now. */
  roomsWithPeopleHere?: string[];
  /** Listed only where this page shows machines. */
  invited?: Invited;
  /** The door shown in the main pane. */
  selectedKnock?: AppState["selectedKnock"];
  /** The room of someone else's machine shown in the main pane. */
  selectedJoinedRoom?: AppState["selectedJoinedRoom"];
  people: Person[];
  /** The agents this computer's owner brought into rooms of other machines. */
  broughtAgents?: BroughtAgentHere[];
  /** The machine's owner makes rooms and changes them; anyone else only opens the ones they are in. */
  manages: boolean;
  dispatch: Dispatch<AppAction>;
  onOpenJoinedRoom?: (machineId: string, roomId: string | null) => void;
}) {
  return (
    <section className="rooms" aria-label={words.rooms}>
      <header data-sticky-heading>
        <div className="workspace-heading">
          <div className="workspace-name">{words.rooms}</div>
        </div>
        {manages && <AddRoomMenu canJoin={onOpenJoinedRoom !== undefined} dispatch={dispatch} />}
      </header>
      <ul>
        {rooms.map((room) => {
          const waiting = roomsWaiting.get(room.id);
          const reading = readings.find(({ roomId }) => roomId === room.id) ?? NOTHING_UNREAD;
          return (
            <li
              key={room.id}
              className={["room-card", room.id === selectedRoomId && "selected", needsYou(waiting, reading) && "waiting", ...readingClasses(reading)].filter(Boolean).join(" ")}
              data-waiting-tone={needsYou(waiting, reading) ? "decision" : undefined}
              onClick={() => dispatch({ type: "select-room", roomId: room.id })}
            >
              <RoomMark style={{ "--room-mark": workspaceMarkColor(room.name) }} />
              <span className="room-card-text">
                <span className="room-card-name">{room.name}</span>
                <span className="room-card-subline">{roomSubline(room, profiles, people, manages)}</span>
              </span>
              {roomsWithPeopleHere.includes(room.id) && <span className="room-people-here" role="img" aria-label={words.someoneHere} data-hint={words.someoneHere} />}
              <ReadingMarks reading={reading} waiting={waiting} />
              {manages && <RoomMenu roomName={room.name} entries={ownRoomEntries(room, dispatch)} />}
            </li>
          );
        })}
      </ul>
      {onOpenJoinedRoom && invited && (
        <InvitedRooms
          invited={invited}
          selectedKnock={selectedKnock}
          selectedJoinedRoom={selectedJoinedRoom}
          broughtAgents={broughtAgents}
          profiles={profiles}
          dispatch={dispatch}
          onOpenJoinedRoom={onOpenJoinedRoom}
        />
      )}
    </section>
  );
}
