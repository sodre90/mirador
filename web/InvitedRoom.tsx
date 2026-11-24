import { useMemo, type Dispatch, type ReactNode } from "react";
import type { BroughtAgentHere } from "../shared/brought-agents.ts";
import type { Machine, MachineStatus, Profile } from "../shared/model.ts";
import { t } from "./i18n/index.ts";
import { SidebarToggle, type PaneToggle } from "./LayoutToggles.tsx";
import { MachineFrames, useKeptLoaded, type PlaceToOpen } from "./MachineRail.tsx";
import type { JoiningPerson } from "./name-to-join.tsx";
import { JoinedRoomMark, JoinedRoomMenu, joinedRoomShown, joinedRoomsOf, MuteHereToggle, type JoinedRoomShown } from "./RoomsSidebar.tsx";
import type { AppAction, AppState } from "./state.ts";

const words = t.rooms;

const NO_PLACE = () => "";
const KEEPS_NO_PLACE = () => {};

function whoseRoom({ ownerName, name, joined }: Machine) {
  if (!joined) return name;
  return ownerName ? words.roomOf(ownerName, name) : words.roomOnMachine(name);
}

/** This computer's own line above the page of someone else's machine, which can neither cover nor change it. */
function InvitedRoomBar({
  machine,
  joined,
  away,
  sidebar,
  broughtAgents,
  profiles,
  dispatch,
}: {
  machine: Machine;
  joined: JoinedRoomShown | undefined;
  away: boolean;
  sidebar: PaneToggle;
  broughtAgents: BroughtAgentHere[];
  profiles: Profile[];
  dispatch: Dispatch<AppAction>;
}) {
  return (
    <header className="invited-room-bar">
      <SidebarToggle sidebar={sidebar} />
      <JoinedRoomMark machine={machine} />
      <span className="invited-room-whose">{[whoseRoom(machine), away && t.shell.machines.notAnswering].filter(Boolean).join(" · ")}</span>
      {joined && (
        <span className="invited-room-actions">
          <MuteHereToggle joined={joined} />
          <JoinedRoomMenu joined={joined} broughtAgents={broughtAgents} profiles={profiles} dispatch={dispatch} />
        </span>
      )}
    </header>
  );
}

/**
 * Over this computer's own panes, the room of someone else's machine that is open: its page as that machine serves it,
 * in its sandbox, under this computer's own line saying whose it is. A machine shown again within
 * HIDDEN_MACHINE_STAYS_LOADED_MS is still loaded.
 */
export function InvitedRoomPane({
  machines,
  statuses,
  selected,
  covered,
  person,
  sidebar,
  broughtAgents,
  profiles,
  banner,
  onJoinedRoom,
  dispatch,
}: {
  machines: Machine[];
  statuses: MachineStatus[];
  selected: AppState["selectedJoinedRoom"];
  /** Whether a machine of this computer's owner is shown over all of it. */
  covered: boolean;
  person: JoiningPerson;
  sidebar: PaneToggle;
  broughtAgents: BroughtAgentHere[];
  profiles: Profile[];
  banner: ReactNode;
  onJoinedRoom: (machineId: string, roomId: string, waiting: boolean) => void;
  dispatch: Dispatch<AppAction>;
}) {
  const machine = machines.find(({ id, asPerson }) => asPerson && id === selected?.machineId);
  const joined = joinedRoomShown(selected, joinedRoomsOf(machines, statuses));
  const roomId = selected?.roomId ?? joined?.room.id;
  const opening = useMemo((): PlaceToOpen | null => (selected && roomId ? { machineId: selected.machineId, place: `#/r/${roomId}` } : null), [selected, roomId]);
  const { visited } = useKeptLoaded(machine?.id ?? null);
  return (
    <section className={`invited-room ${machine ? "shown" : ""}`} aria-label={machine && whoseRoom(machine)}>
      {machine && (
        <div className="invited-room-top">
          {banner}
          <InvitedRoomBar
            machine={machine}
            joined={joined}
            away={statuses.find(({ machineId }) => machineId === machine.id)?.reachable === false}
            sidebar={sidebar}
            broughtAgents={broughtAgents}
            profiles={profiles}
            dispatch={dispatch}
          />
        </div>
      )}
      <MachineFrames
        machines={machines.filter(({ asPerson }) => asPerson)}
        person={person}
        shownId={covered ? null : (machine?.id ?? null)}
        visited={visited}
        opening={opening}
        placeOf={NO_PLACE}
        onPlace={KEEPS_NO_PLACE}
        onJoinedRoom={onJoinedRoom}
      />
    </section>
  );
}
