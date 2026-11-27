import { useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { namelessPerson } from "../shared/people.ts";
import { isMuted } from "../shared/room-reading.ts";
import { approvesIn } from "../shared/rooms.ts";
import { t } from "./i18n/index.ts";
import { inView, toggledInView, type PaneLayout } from "./layout.ts";
import { LayoutToggles, LayoutToggleState } from "./LayoutToggles.tsx";
import { shownInAnotherMirador } from "./machine-place.ts";
import { Modal } from "./Palette.tsx";
import { useConversationLayouts, useSidebarWidth } from "./paneLayouts.ts";
import { RoomCanvas, RoomView } from "./Room.tsx";
import { RoomsSection } from "./RoomsSidebar.tsx";
import { OwnProfileSettings } from "./Settings.tsx";
import type { AppAction, AppState } from "./state.ts";
import type { RoomWait } from "./waiting.ts";
import { WorkspaceArea } from "./Workspace.tsx";

const words = t.rooms;
const NO_ROOMS_WAITING: ReadonlyMap<string, RoomWait> = new Map();

/** The host's snapshot says who the page signed in as; until it comes, the page may be a person's, and shows none of the owner's. */
export const knowsWhoSignedIn = ({ you }: Pick<AppState, "you">) => you !== null;

/** Signed in as a person other than the machine's owner, the page shows the rooms they are in, and nothing else of the machine. */
export const seesOnlyTheirRooms = ({ you, ownerId }: Pick<AppState, "you" | "ownerId">) => you !== null && ownerId !== null && you !== ownerId;

/** Whose machine this is, and the rooms they are in here. */
function Welcome({ state }: { state: AppState }) {
  const owner = state.people.find(({ id }) => id === state.ownerId)?.name;
  return (
    <p className="rooms-only-welcome">
      {owner ? words.machineOf(owner) : words.machineOfNamelessOwner} {state.rooms.length > 0 && words.invitedTo(state.rooms.map(({ name }) => name).join(", "))}
    </p>
  );
}

/**
 * The page of a person other than the machine's owner: the list of their rooms, the room they opened, its canvas, and
 * their own name and colour. Taken out of their last room, they are signed out, and it says so. In their own Mirador,
 * whose sidebar lists the rooms and which mutes them, it shows the room alone.
 */
export function RoomsOnlyApp({
  state,
  dispatch,
  outOfRooms,
  banner,
  layouts,
  sidebarHidden: sidebarHiddenHere,
  setSidebarHidden,
}: {
  state: AppState;
  dispatch: Dispatch<AppAction>;
  outOfRooms: boolean;
  banner: ReactNode;
  layouts: ReturnType<typeof useConversationLayouts>;
  sidebarHidden: boolean;
  setSidebarHidden: Dispatch<SetStateAction<boolean>>;
}) {
  const [sidebarWidth] = useSidebarWidth();
  const inTheirMirador = shownInAnotherMirador();
  const sidebarHidden = inTheirMirador || sidebarHiddenHere;
  const [ownProfileOpen, setOwnProfileOpen] = useState(false);
  const [itemToShow, setItemToShow] = useState<{ roomId: string; itemId: string } | null>(null);
  const room = state.rooms.find(({ id }) => id === state.selectedRoomId) ?? null;
  const layout = layouts.layoutOf(state.selectedRoomId);
  const changeLayout = (update: (layout: PaneLayout) => PaneLayout) => layouts.change(state.selectedRoomId, update);
  const toggleCanvas = () => changeLayout((current) => toggledInView(current, "canvas"));
  const canvasShown = room !== null && !layout.hidden.canvas;
  const you = state.people.find(({ id }) => id === state.you);
  const openOnCanvas = (roomId: string, itemId: string) => {
    changeLayout((current) => ({ ...current, hidden: { ...current.hidden, canvas: false } }));
    setItemToShow({ roomId, itemId });
  };
  const layoutToggles = {
    sidebar: inTheirMirador ? null : { visible: !sidebarHidden, toggle: () => setSidebarHidden((wasHidden) => !wasHidden) },
    canvas: { visible: inView(layout, "canvas"), toggle: toggleCanvas, disabled: room === null },
    terminal: { visible: false, toggle: () => {}, disabled: true },
  };
  const roomCanvas = room && (
    <RoomCanvas
      key={room.id}
      room={room}
      profiles={state.profiles}
      people={state.people}
      items={state.roomTimeline?.canvas ?? []}
      shown={canvasShown}
      assetsOrigin={state.canvasAssetsOrigin}
      homeDir=""
      canvasViews={state.canvasViews}
      openApps={state.openApps}
      installedApps={state.installedApps}
      appDocuments={state.appDocuments}
      itemToShow={itemToShow?.roomId === room.id ? itemToShow : null}
      readOnly
      canActOnPlugins={!room.people.some(({ personId, role }) => personId === state.you && role === "guest")}
      canRunAppTasks={approvesIn(room, state.you)}
      onHide={toggleCanvas}
    />
  );
  const roomPane = (
    <main className="chat-column">
      <LayoutToggleState.Provider value={layoutToggles}>
        {banner}
        {room ? (
          <RoomView
            key={room.id}
            room={room}
            timeline={state.roomTimeline?.roomId === room.id ? state.roomTimeline : null}
            profiles={state.profiles}
            roomConversations={state.roomConversations}
            threadConversations={state.threadConversations}
            people={state.people}
            ownerId={state.ownerId}
            ownerPicture={null}
            approvals={state.roomApprovals.filter(({ roomId }) => roomId === room.id)}
            tasks={state.roomTasksWaiting.filter(({ roomId }) => roomId === room.id)}
            workspaceWaiting={state.roomWorkspaceWaiting.filter(({ roomId }) => roomId === room.id)}
            heldChanges={[]}
            holdsTooMany={false}
            homeDir=""
            presence={state.roomPresence?.roomId === room.id ? state.roomPresence : null}
            joiners={[]}
            muted={isMuted(state.roomReadings, room.id)}
            you={state.you}
            offersMute={!inTheirMirador || isMuted(state.roomReadings, room.id)}
            onOwnProfile={inTheirMirador ? () => setOwnProfileOpen(true) : undefined}
            dispatch={dispatch}
            onOpenOnCanvas={(itemId) => openOnCanvas(room.id, itemId)}
          />
        ) : (
          <>
            <div className="empty-state-bar" data-pane-bar>
              <LayoutToggles />
            </div>
            <div className="empty-state">
              <h2>{outOfRooms ? words.outOfRooms : state.rooms.length > 0 ? words.noRoomOpen : state.waitingToJoin.length > 0 ? words.waitingHere : words.inNoRoom}</h2>
              {!outOfRooms && <Welcome state={state} />}
            </div>
          </>
        )}
      </LayoutToggleState.Provider>
    </main>
  );
  return (
    <div className="app rooms-only">
      <div className={`layout ${sidebarHidden ? "sidebar-hidden" : ""}`} style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
        {!sidebarHidden && (
          <nav className="sidebar">
            <div className="sidebar-scroll">
              <RoomsSection rooms={state.rooms} profiles={state.profiles} selectedRoomId={state.selectedRoomId} roomsWaiting={NO_ROOMS_WAITING} readings={state.roomReadings} people={state.people} manages={false} dispatch={dispatch} />
            </div>
            <footer>
              <button type="button" className="link" onClick={() => setOwnProfileOpen(true)}>
                {t.settings.ownProfile.title}
              </button>
            </footer>
          </nav>
        )}
        <WorkspaceArea layout={layout} onChange={changeLayout} keptOutOfSight={{ canvas: roomCanvas }} content={{ conversation: roomPane, canvas: canvasShown ? roomCanvas : null, terminals: null }} />
      </div>
      <div className="notices">
        {state.notices.map((notice) => (
          <div key={notice.id} className="notice" onClick={() => dispatch({ type: "dismiss-notice", id: notice.id })}>
            {notice.text}
          </div>
        ))}
      </div>
      {ownProfileOpen && you && (
        <Modal label={t.settings.ownProfile.title} className="own-profile-dialog" onClose={() => setOwnProfileOpen(false)}>
          <OwnProfileSettings person={you} nameless={namelessPerson(t.rooms.nameless, you)} />
        </Modal>
      )}
    </div>
  );
}
