import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type RefObject } from "react";
import type { BroughtAgentHere, BroughtTaskWaiting } from "../shared/brought-agents.ts";
import type { Conversation, Machine, MachineStatus, Profile } from "../shared/model.ts";
import { BroughtAgentsBar, BroughtAgentsWaiting, broughtInto, BroughtWorkPanel, useBroughtWorkKept, type BroughtHere, type BroughtWorkJump } from "./BroughtWork.tsx";
import { t } from "./i18n/index.ts";
import { broughtWorkWidthIn, MIN_BROUGHT_WORK_MARGIN, MIN_BROUGHT_WORK_WIDTH } from "./layout.ts";
import { SidebarToggle, type PaneToggle } from "./LayoutToggles.tsx";
import { MachineFrames, useKeptLoaded, type PlaceToOpen } from "./MachineRail.tsx";
import type { OpenBroughtWorkRequest } from "./machine-place.ts";
import type { JoiningPerson } from "./name-to-join.tsx";
import { setBroughtWorkWidth, useBroughtWorkWidth } from "./paneLayouts.ts";
import { JoinedRoomMark, JoinedRoomMenu, joinedRoomShown, joinedRoomsOf, MuteHereToggle, type JoinedRoomShown } from "./RoomsSidebar.tsx";
import { Splitter } from "./Splitter.tsx";
import type { AppAction, AppState, OpenConversation } from "./state.ts";

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
  here,
  workShown,
  profiles,
  dispatch,
}: {
  machine: Machine;
  joined: JoinedRoomShown | undefined;
  away: boolean;
  sidebar: PaneToggle;
  broughtAgents: BroughtAgentHere[];
  here: BroughtHere[];
  workShown: string | null;
  profiles: Profile[];
  dispatch: Dispatch<AppAction>;
}) {
  return (
    <header className="invited-room-bar">
      <SidebarToggle sidebar={sidebar} />
      <JoinedRoomMark machine={machine} />
      <span className="invited-room-whose">{[whoseRoom(machine), away && t.shell.machines.notAnswering].filter(Boolean).join(" · ")}</span>
      <BroughtAgentsBar here={here} workShown={workShown} profiles={profiles} dispatch={dispatch} />
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
  broughtConversations,
  broughtWork,
  broughtWorkShown,
  broughtTasks,
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
  broughtConversations: Conversation[];
  broughtWork: OpenConversation[];
  broughtWorkShown: string | null;
  broughtTasks: BroughtTaskWaiting[];
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
  const here = machine ? broughtInto(machine.id, roomId ?? null, { broughtAgents, broughtConversations, broughtWork, broughtTasks, profiles }) : [];
  useBroughtWorkKept(here, dispatch);
  const workBeside = here.find(({ conversation }) => conversation.id === broughtWorkShown);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyWidth = useWidthOf(bodyRef);
  const draggedWorkWidth = useBroughtWorkWidth();
  const bodyStyle =
    bodyWidth > 0 ? ({ "--brought-work-width": `${broughtWorkWidthIn(bodyWidth, draggedWorkWidth)}px` } as CSSProperties) : undefined;
  const [jumpTo, setJumpTo] = useState<(BroughtWorkJump & { conversationId: string }) | null>(null);
  const openBroughtWork = (fromMachineId: string, request: OpenBroughtWorkRequest) => {
    if (!machine || fromMachineId !== machine.id || (roomId !== undefined && request.roomId !== roomId)) return;
    const brought = broughtAgents.find(
      (agent) => agent.machineId === fromMachineId && agent.roomId === request.roomId && agent.agentId === request.agentId && agent.conversationId !== null,
    );
    if (!brought?.conversationId) return;
    dispatch({ type: "show-brought-work", conversationId: brought.conversationId });
    if (request.messageSeq !== undefined) setJumpTo({ conversationId: brought.conversationId, messageSeq: request.messageSeq, at: Date.now() });
  };
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
            here={here}
            workShown={workBeside?.conversation.id ?? null}
            profiles={profiles}
            dispatch={dispatch}
          />
          <BroughtAgentsWaiting here={here} />
        </div>
      )}
      <div ref={bodyRef} className="invited-room-body" style={bodyStyle}>
        <MachineFrames
          machines={machines.filter(({ asPerson }) => asPerson)}
          person={person}
          shownId={covered ? null : (machine?.id ?? null)}
          visited={visited}
          opening={opening}
          placeOf={NO_PLACE}
          onPlace={KEEPS_NO_PLACE}
          onJoinedRoom={onJoinedRoom}
          onOpenBroughtWork={openBroughtWork}
        />
        {workBeside && (
          <>
            <div className="brought-work-backdrop" aria-hidden="true" onClick={() => dispatch({ type: "show-brought-work", conversationId: null })} />
            <BroughtWorkPanel
              agent={workBeside}
              jumpTo={jumpTo?.conversationId === workBeside.conversation.id ? jumpTo : null}
              resizer={bodyWidth > 0 ? <BroughtWorkDivider bodyRef={bodyRef} bodyWidth={bodyWidth} draggedWidth={draggedWorkWidth} /> : null}
              onClose={() => dispatch({ type: "show-brought-work", conversationId: null })}
            />
          </>
        )}
      </div>
    </section>
  );
}

function useWidthOf(element: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const observed = element.current;
    if (!observed) return;
    const keep = (next: number) => next > 0 && setWidth((current) => (current === next ? current : next));
    keep(observed.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => entry && keep(entry.contentRect.width));
    observer.observe(observed);
    return () => observer.disconnect();
  }, []);
  return width;
}

/** Drags the brought-work drawer wider or narrower over the room, remembering its width per browser. */
function BroughtWorkDivider({
  bodyRef,
  bodyWidth,
  draggedWidth,
}: {
  bodyRef: RefObject<HTMLDivElement | null>;
  bodyWidth: number;
  draggedWidth: number | null;
}) {
  const widthAt = (share: number) => broughtWorkWidthIn(bodyWidth, (1 - share) * bodyWidth);
  const shareOf = (width: number) => 1 - width / bodyWidth;
  const resetShare = shareOf(broughtWorkWidthIn(bodyWidth, null));
  return (
    <Splitter
      axis="columns"
      label={t.shell.panes.resizeSidePanel}
      share={shareOf(broughtWorkWidthIn(bodyWidth, draggedWidth))}
      resetShare={resetShare}
      minimumSize={MIN_BROUGHT_WORK_MARGIN}
      secondMinimumSize={MIN_BROUGHT_WORK_WIDTH}
      area={() => {
        const rect = bodyRef.current!.getBoundingClientRect();
        return { start: rect.left, size: rect.width };
      }}
      onDrag={(share) => bodyRef.current?.style.setProperty("--brought-work-width", `${widthAt(share)}px`)}
      onChange={(share) => setBroughtWorkWidth(share === resetShare ? null : widthAt(share))}
    />
  );
}
