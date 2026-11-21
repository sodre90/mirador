import { useState, type CSSProperties, type Dispatch, type ReactNode } from "react";
import { t } from "./i18n/index.ts";
import { inView, toggledInView, type PaneLayout } from "./layout.ts";
import { LayoutToggles, LayoutToggleState } from "./LayoutToggles.tsx";
import { Modal } from "./Palette.tsx";
import { useConversationLayouts, useSidebarHidden, useSidebarWidth } from "./paneLayouts.ts";
import { RoomCanvas, RoomView } from "./Room.tsx";
import { RoomsSection } from "./RoomsSidebar.tsx";
import { OwnProfileSettings } from "./Settings.tsx";
import type { AppAction, AppState } from "./state.ts";
import { WorkspaceArea } from "./Workspace.tsx";

const words = t.rooms;
const NO_ROOMS_WAITING = new Set<string>();

/** Signed in as a person other than the machine's owner, the page shows the rooms they are in, and nothing else of the machine. */
export const seesOnlyTheirRooms = ({ you, ownerId }: Pick<AppState, "you" | "ownerId">) => you !== null && ownerId !== null && you !== ownerId;

/** The page of a person other than the machine's owner: the list of their rooms, the room they opened, its canvas, and their own name and colour. */
export function RoomsOnlyApp({ state, dispatch, banner }: { state: AppState; dispatch: Dispatch<AppAction>; banner: ReactNode }) {
  const layouts = useConversationLayouts();
  const [sidebarWidth] = useSidebarWidth();
  const [sidebarHidden, setSidebarHidden] = useSidebarHidden();
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
    sidebar: { visible: !sidebarHidden, toggle: () => setSidebarHidden((wasHidden) => !wasHidden) },
    canvas: { visible: inView(layout, "canvas"), toggle: toggleCanvas, disabled: room === null },
    terminal: { visible: false, toggle: () => {}, disabled: true },
  };
  const roomCanvas = room && (
    <RoomCanvas
      key={room.id}
      room={room}
      items={state.roomTimeline?.canvas ?? []}
      shown={canvasShown}
      assetsOrigin={state.canvasAssetsOrigin}
      homeDir=""
      canvasViews={state.canvasViews}
      itemToShow={itemToShow?.roomId === room.id ? itemToShow : null}
      readOnly
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
            roomConversations={[]}
            threadConversations={[]}
            people={state.people}
            ownerId={state.ownerId}
            ownerPicture={null}
            approvals={[]}
            tasks={[]}
            you={state.you}
            dispatch={dispatch}
            onOpenOnCanvas={(itemId) => openOnCanvas(room.id, itemId)}
          />
        ) : (
          <>
            <div className="empty-state-bar" data-pane-bar>
              <LayoutToggles />
            </div>
            <div className="empty-state">
              <h2>{state.rooms.length === 0 ? words.inNoRoom : words.noRoomOpen}</h2>
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
            <RoomsSection rooms={state.rooms} selectedRoomId={state.selectedRoomId} waitingRoomIds={NO_ROOMS_WAITING} manages={false} dispatch={dispatch} />
            <div className="sidebar-scroll" />
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
          <OwnProfileSettings person={you} nameless={t.rooms.nameless} />
        </Modal>
      )}
    </div>
  );
}
