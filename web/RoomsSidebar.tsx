import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type MouseEvent } from "react";
import { workspaceMarkColor } from "../shared/marks.ts";
import type { BroughtAgentHere } from "../shared/brought-agents.ts";
import type { JoinedRoom, Machine, MachineStatus, Person, Profile, RoomKnock } from "../shared/model.ts";
import { personGoesBy } from "../shared/people.ts";
import type { RoomReading } from "../shared/room-reading.ts";
import { broughtAgentName, type Room } from "../shared/rooms.ts";
import { placedBelow, useClosing } from "./BarMenu.tsx";
import { connection } from "./connection.ts";
import { formatNumber, t } from "./i18n/index.ts";
import { LayoutToggles } from "./LayoutToggles.tsx";
import { LineIcon } from "./LineIcon.tsx";
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

/** A room of someone else's machine this computer's owner waits to be let into, or was turned away from, with its machine. */
export interface KnockShown {
  machine: Machine;
  knock: RoomKnock;
}

/** Every room door this computer's owner stands at on someone else's machines. */
export const knocksOf = (machines: Machine[]): KnockShown[] => machines.filter(({ asPerson }) => asPerson).flatMap((machine) => machine.knocks.map((knock) => ({ machine, knock })));

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

const machineMarkStyle = (machine: Machine): CSSProperties => (machine.color ? { ...pastelVariables(machine.color), background: "var(--pastel-stripe)" } : { background: workspaceMarkColor(machine.name) });

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
        <RoomMark style={machineMarkStyle(machine)} />
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

function RoomMark({ style }: { style: CSSProperties }) {
  return (
    <span className="room-mark" style={style} aria-hidden="true">
      #
    </span>
  );
}

type ReadingCounts = Pick<RoomReading, "unread" | "mentions" | "toConfirm" | "muted">;

const NOTHING_UNREAD: ReadingCounts = { unread: 0, mentions: 0, toConfirm: 0, muted: false };

const needsYou = (waiting: RoomWait | undefined, { toConfirm }: ReadingCounts) => waiting !== undefined || toConfirm > 0;

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
        <span className="waiting-pill tone-decision" data-hint={waiting ? roomWaitHints[waiting] : words.waitsForYourConfirm}>
          {waitingLabels.decision}
        </span>
      )}
    </>
  );
}

/** Keeps a room of someone else's machine quiet on this computer, whatever that machine does; muted there, it is quiet too. */
function MuteHereToggle({ machineId, roomId, mutedHere }: { machineId: string; roomId: string; mutedHere: boolean }) {
  return (
    <button
      type="button"
      className={`icon room-mute${mutedHere ? " muted" : ""}`}
      aria-label={words.muteRoom}
      aria-pressed={mutedHere}
      data-hint={mutedHere ? words.mutedHint : words.muteRoom}
      onClick={(event) => {
        event.stopPropagation();
        connection.send({ type: "machine.mute-room", machineId, roomId, muted: !mutedHere });
      }}
    >
      <LineIcon shape={mutedHere ? "bellOff" : "bell"} />
    </button>
  );
}

/** A joined room's "⋯": bringing an agent of your own into it, and taking out those you brought. */
function JoinedRoomMenu({ machineId, room, brought, profiles, dispatch }: { machineId: string; room: JoinedRoom; brought: BroughtAgentHere[]; profiles: Profile[]; dispatch: Dispatch<AppAction> }) {
  const opener = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  const open = placement !== null;
  useClosing(open, [opener, menu], () => setPlacement(null));
  const choose = (event: MouseEvent, act: () => void) => {
    event.stopPropagation();
    setPlacement(null);
    act();
  };
  return (
    <>
      <button
        ref={opener}
        type="button"
        className="icon"
        aria-label={words.moreFor(room.name)}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setPlacement(open ? null : placedBelow(event.currentTarget));
        }}
      >
        ⋯
      </button>
      {open && (
        <div ref={menu} className="add-room-menu joined-room-menu" role="menu" aria-label={words.moreFor(room.name)} style={placement}>
          <button type="button" role="menuitem" onClick={(event) => choose(event, () => dispatch({ type: "open-overlay", overlay: { kind: "bring-agent", machineId, roomId: room.id } }))}>
            {words.bringAgent}
          </button>
          {brought.map(({ id, profileId }) => (
            <button key={id} type="button" role="menuitem" onClick={(event) => choose(event, () => connection.send({ type: "machine.take-agent-out", broughtId: id }))}>
              {words.takeOutAgent(profiles.find((profile) => profile.id === profileId)?.name ?? words.agentGone)}
            </button>
          ))}
        </div>
      )}
    </>
  );
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

export function RoomsSection({
  rooms,
  profiles,
  selectedRoomId,
  roomsWaiting,
  readings,
  roomsWithPeopleHere = [],
  joinedRooms = [],
  knocks = [],
  selectedKnock = null,
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
  /** Rooms of someone else's machines, which open in that machine's frame; listed only where this page shows machines. */
  joinedRooms?: JoinedRoomShown[];
  /** The doors of rooms of someone else's machines this computer's owner waits at, or was turned away from; listed only where joined rooms are. */
  knocks?: KnockShown[];
  /** The door shown in the main pane. */
  selectedKnock?: AppState["selectedKnock"];
  people: Person[];
  /** The agents this computer's owner brought into rooms of other machines. */
  broughtAgents?: BroughtAgentHere[];
  /** The machine's owner makes rooms and changes them; anyone else only opens the ones they are in. */
  manages: boolean;
  dispatch: Dispatch<AppAction>;
  onOpenJoinedRoom?: (machineId: string, roomId: string) => void;
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
              <RoomMark style={{ background: workspaceMarkColor(room.name) }} />
              <span className="room-card-text">
                <span className="room-card-name">{room.name}</span>
                <span className="room-card-subline">{roomSubline(room, profiles, people, manages)}</span>
              </span>
              {roomsWithPeopleHere.includes(room.id) && <span className="room-people-here" role="img" aria-label={words.someoneHere} data-hint={words.someoneHere} />}
              <ReadingMarks reading={reading} waiting={waiting} />
              {manages && (
                <button
                  type="button"
                  className="icon"
                  aria-label={words.roomSettings(room.name)}
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatch({ type: "open-overlay", overlay: { kind: "room", roomId: room.id } });
                  }}
                >
                  ⋯
                </button>
              )}
            </li>
          );
        })}
        {onOpenJoinedRoom &&
          joinedRooms.map(({ machine, status, room }) => {
            const away = status?.reachable === false;
            const mutedHere = status?.mutedHere.includes(room.id) === true;
            const broughtHere = broughtAgents.filter((agent) => agent.machineId === machine.id && agent.roomId === room.id);
            return (
              <li
                key={`${machine.id}:${room.id}`}
                className={["room-card", "joined-room", away && "away", needsYou(undefined, room) && "waiting", ...readingClasses({ ...room, muted: room.muted || mutedHere })].filter(Boolean).join(" ")}
                data-waiting-tone={needsYou(undefined, room) ? "decision" : undefined}
                data-machine={machine.id}
                onClick={() => onOpenJoinedRoom(machine.id, room.id)}
              >
                <RoomMark style={machineMarkStyle(machine)} />
                <span className="room-card-text">
                  <span className="room-card-name">{room.name}</span>
                  <span className="room-card-subline">
                    {[words.onMachine(machine.name), away && t.shell.machines.notAnswering, ...broughtHere.map(({ profileId }) => profiles.find(({ id }) => id === profileId)?.name ?? words.agentGone)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <ReadingMarks reading={room} />
                <MuteHereToggle machineId={machine.id} roomId={room.id} mutedHere={mutedHere} />
                <JoinedRoomMenu machineId={machine.id} room={room} brought={broughtHere} profiles={profiles} dispatch={dispatch} />
              </li>
            );
          })}
        {onOpenJoinedRoom &&
          knocks.map(({ machine, knock }) => (
            <li
              key={`knock:${machine.id}:${knock.roomId}`}
              className={["room-card", "room-knock", knock.turnedAway && "turned-away", selectedKnock?.machineId === machine.id && selectedKnock.roomId === knock.roomId && "selected"].filter(Boolean).join(" ")}
              data-machine={machine.id}
              onClick={() => dispatch({ type: "select-knock", machineId: machine.id, roomId: knock.roomId })}
            >
              <RoomMark style={machineMarkStyle(machine)} />
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
          ))}
      </ul>
    </section>
  );
}
