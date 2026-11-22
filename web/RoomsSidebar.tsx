import { useRef, useState, type CSSProperties, type Dispatch, type MouseEvent } from "react";
import { workspaceMarkColor } from "../shared/marks.ts";
import type { BroughtAgentHere } from "../shared/brought-agents.ts";
import type { JoinedRoom, Machine, MachineStatus, Person, Profile } from "../shared/model.ts";
import { personGoesBy } from "../shared/people.ts";
import type { RoomReading } from "../shared/room-reading.ts";
import { broughtAgentName, type Room } from "../shared/rooms.ts";
import { placedBelow, useClosing } from "./BarMenu.tsx";
import { connection } from "./connection.ts";
import { waitingHints } from "./hints.ts";
import { formatNumber, t } from "./i18n/index.ts";
import { LineIcon } from "./LineIcon.tsx";
import { pastelVariables } from "./pastels.ts";
import type { AppAction } from "./state.ts";
import { waitingLabels } from "./waiting.ts";

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

const needsYou = (waiting: boolean, { toConfirm }: ReadingCounts) => waiting || toConfirm > 0;

const readingClasses = ({ unread, muted }: ReadingCounts) => [unread > 0 && "unread", muted && "muted"];

/** What a room holds for you: a mark where you were tagged, how many messages you have not read, and "Needs you" where something waits for you. */
function ReadingMarks({ reading, waiting }: { reading: ReadingCounts; waiting: boolean }) {
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
        <span className="waiting-pill tone-decision" data-hint={waiting ? waitingHints.permission : words.waitsForYourConfirm}>
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
  waitingRoomIds,
  readings,
  roomsWithPeopleHere = [],
  joinedRooms = [],
  people,
  broughtAgents = [],
  manages,
  dispatch,
  onOpenJoinedRoom,
}: {
  rooms: Room[];
  profiles: Profile[];
  selectedRoomId: string | null;
  waitingRoomIds: Set<string>;
  /** How far you have read each room, and what waits for you there. */
  readings: RoomReading[];
  /** The rooms someone other than the owner is in now. */
  roomsWithPeopleHere?: string[];
  /** Rooms of someone else's machines, which open in that machine's frame; listed only where this page shows machines. */
  joinedRooms?: JoinedRoomShown[];
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
          const waiting = waitingRoomIds.has(room.id);
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
                className={["room-card", "joined-room", away && "away", needsYou(false, room) && "waiting", ...readingClasses({ ...room, muted: room.muted || mutedHere })].filter(Boolean).join(" ")}
                data-waiting-tone={needsYou(false, room) ? "decision" : undefined}
                data-machine={machine.id}
                onClick={() => onOpenJoinedRoom(machine.id, room.id)}
              >
                <RoomMark style={machine.color ? { ...pastelVariables(machine.color), background: "var(--pastel-stripe)" } : { background: workspaceMarkColor(machine.name) }} />
                <span className="room-card-text">
                  <span className="room-card-name">{room.name}</span>
                  <span className="room-card-subline">
                    {[words.onMachine(machine.name), away && t.shell.machines.notAnswering, ...broughtHere.map(({ profileId }) => profiles.find(({ id }) => id === profileId)?.name ?? words.agentGone)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <ReadingMarks reading={room} waiting={false} />
                <MuteHereToggle machineId={machine.id} roomId={room.id} mutedHere={mutedHere} />
                <JoinedRoomMenu machineId={machine.id} room={room} brought={broughtHere} profiles={profiles} dispatch={dispatch} />
              </li>
            );
          })}
      </ul>
    </section>
  );
}
