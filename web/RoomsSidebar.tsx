import { useRef, useState, type CSSProperties, type Dispatch } from "react";
import { workspaceMarkColor } from "../shared/marks.ts";
import type { JoinedRoom, Machine, MachineStatus, Profile } from "../shared/model.ts";
import type { Room } from "../shared/rooms.ts";
import { placedBelow, useClosing } from "./BarMenu.tsx";
import { waitingHints } from "./hints.ts";
import { t } from "./i18n/index.ts";
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
function roomSubline(room: Room, profiles: Profile[], manages: boolean) {
  const agents = room.agents.map(({ profileId }) => profiles.find(({ id }) => id === profileId)?.name ?? words.agentGone);
  return [manages && room.people.length > 0 && words.peopleCount(room.people.length), agents.length > 0 ? agents.join(", ") : words.noAgentsYet].filter(Boolean).join(" · ");
}

function RoomMark({ style }: { style: CSSProperties }) {
  return (
    <span className="room-mark" style={style} aria-hidden="true">
      #
    </span>
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
  roomsWithPeopleHere = [],
  joinedRooms = [],
  manages,
  dispatch,
  onOpenJoinedRoom,
}: {
  rooms: Room[];
  profiles: Profile[];
  selectedRoomId: string | null;
  waitingRoomIds: Set<string>;
  /** The rooms someone other than the owner is in now. */
  roomsWithPeopleHere?: string[];
  /** Rooms of someone else's machines, which open in that machine's frame; listed only where this page shows machines. */
  joinedRooms?: JoinedRoomShown[];
  /** The machine's owner makes rooms and changes them; anyone else only opens the ones they are in. */
  manages: boolean;
  dispatch: Dispatch<AppAction>;
  onOpenJoinedRoom?: (machineId: string, roomId: string) => void;
}) {
  return (
    <section className="rooms" aria-label={words.rooms}>
      <header>
        <div className="workspace-heading">
          <div className="workspace-name">{words.rooms}</div>
        </div>
        {manages && <AddRoomMenu canJoin={onOpenJoinedRoom !== undefined} dispatch={dispatch} />}
      </header>
      <ul>
        {rooms.map((room) => {
          const waiting = waitingRoomIds.has(room.id);
          return (
            <li
              key={room.id}
              className={["room-card", room.id === selectedRoomId && "selected", waiting && "waiting"].filter(Boolean).join(" ")}
              data-waiting-tone={waiting ? "decision" : undefined}
              onClick={() => dispatch({ type: "select-room", roomId: room.id })}
            >
              <RoomMark style={{ background: workspaceMarkColor(room.name) }} />
              <span className="room-card-text">
                <span className="room-card-name">{room.name}</span>
                <span className="room-card-subline">{roomSubline(room, profiles, manages)}</span>
              </span>
              {roomsWithPeopleHere.includes(room.id) && <span className="room-people-here" role="img" aria-label={words.someoneHere} data-hint={words.someoneHere} />}
              {waiting && (
                <span className="waiting-pill tone-decision" data-hint={waitingHints.permission}>
                  {waitingLabels.decision}
                </span>
              )}
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
            return (
              <li
                key={`${machine.id}:${room.id}`}
                className={["room-card", "joined-room", away && "away"].filter(Boolean).join(" ")}
                data-machine={machine.id}
                onClick={() => onOpenJoinedRoom(machine.id, room.id)}
              >
                <RoomMark style={machine.color ? { ...pastelVariables(machine.color), background: "var(--pastel-stripe)" } : { background: workspaceMarkColor(machine.name) }} />
                <span className="room-card-text">
                  <span className="room-card-name">{room.name}</span>
                  <span className="room-card-subline">{[words.onMachine(machine.name), away && t.shell.machines.notAnswering].filter(Boolean).join(" · ")}</span>
                </span>
              </li>
            );
          })}
      </ul>
    </section>
  );
}
