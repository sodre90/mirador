import { useState, type Dispatch } from "react";
import type { Profile, Workspace } from "../shared/model.ts";
import { DEFAULT_PERMISSION_PRESET, PERMISSION_PRESETS, type PermissionPreset } from "../shared/room-permissions.ts";
import type { Room, RoomApproval } from "../shared/rooms.ts";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { waitingHints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { Modal } from "./Palette.tsx";
import type { AppAction } from "./state.ts";
import { waitingLabels } from "./waiting.ts";

const words = t.rooms;

/** The rooms where an agent waits for you to answer its request. */
export const roomsWaitingFor = (you: string | null, approvals: RoomApproval[]) =>
  new Set(approvals.filter(({ approvers }) => you !== null && approvers.includes(you)).map(({ roomId }) => roomId));

export function RoomsSection({
  rooms,
  selectedRoomId,
  waitingRoomIds,
  dispatch,
}: {
  rooms: Room[];
  selectedRoomId: string | null;
  waitingRoomIds: Set<string>;
  dispatch: Dispatch<AppAction>;
}) {
  const openSettings = (roomId: string | null) => dispatch({ type: "open-overlay", overlay: { kind: "room", roomId } });
  return (
    <section className="rooms" aria-label={words.rooms}>
      <header>
        <div className="workspace-heading">
          <div className="workspace-name">{words.rooms}</div>
        </div>
        <button type="button" className="icon workspace-new" aria-label={words.newRoom} onClick={() => openSettings(null)}>
          +
        </button>
      </header>
      <ul>
        {rooms.map((room) => {
          const waiting = waitingRoomIds.has(room.id);
          return (
            <li
              key={room.id}
              className={[room.id === selectedRoomId && "selected", waiting && "waiting"].filter(Boolean).join(" ")}
              data-waiting-tone={waiting ? "decision" : undefined}
              onClick={() => dispatch({ type: "select-room", roomId: room.id })}
            >
              {waiting && <span className="dot waiting tone-decision" data-hint={waitingHints.permission} />}
              <span className="conversation-title"># {room.name}</span>
              {waiting && (
                <span className="waiting-pill tone-decision" data-hint={waitingHints.permission}>
                  {waitingLabels.decision}
                </span>
              )}
              <button
                type="button"
                className="icon"
                aria-label={words.roomSettings(room.name)}
                onClick={(event) => {
                  event.stopPropagation();
                  openSettings(room.id);
                }}
              >
                ⋯
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Makes a room, or changes one: its name, agents and what they may do without asking; a room's workspace stays the one it was made in. */
export function RoomDialog({
  room,
  workspaces,
  profiles,
  dispatch,
  onClose,
}: {
  room: Room | null;
  workspaces: Workspace[];
  profiles: Profile[];
  dispatch: Dispatch<AppAction>;
  onClose: () => void;
}) {
  const [name, setName] = useState(room?.name ?? "");
  const [workspaceId, setWorkspaceId] = useState(room?.workspaceId ?? workspaces[0]?.id ?? "");
  const [agentIds, setAgentIds] = useState<string[]>(room?.agents.map(({ profileId }) => profileId) ?? []);
  const [permissions, setPermissions] = useState<PermissionPreset>(room?.permissions ?? DEFAULT_PERMISSION_PRESET);
  const toggle = (profileId: string) => setAgentIds((ticked) => (ticked.includes(profileId) ? ticked.filter((id) => id !== profileId) : [...ticked, profileId]));
  const canSave = name.trim() !== "" && workspaceId !== "";
  const save = () => {
    if (!canSave) return;
    if (room) {
      if (name.trim() !== room.name) connection.send({ type: "room.rename", roomId: room.id, name });
      connection.send({ type: "room.set-agents", roomId: room.id, profileIds: agentIds });
      if (permissions !== room.permissions) connection.send({ type: "room.set-permissions", roomId: room.id, permissions });
      return onClose();
    }
    const requestId = crypto.randomUUID();
    const unsubscribe = connection.onMessage((message) => {
      if (message.type !== "room.created" || message.requestId !== requestId) return;
      unsubscribe();
      dispatch({ type: "select-room", roomId: message.roomId });
    });
    connection.send({ type: "room.create", requestId, name, workspaceId, profileIds: agentIds, permissions });
    onClose();
  };
  const deleteRoom = () => {
    if (!room) return;
    connection.send({ type: "room.delete", roomId: room.id });
    onClose();
  };
  return (
    <Modal label={room ? words.editRoom : words.newRoom} className="room-dialog" onClose={onClose}>
      <h2>{room ? words.editRoom : words.newRoom}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="room-field">
          {words.name}
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="room-field">
          {words.workspace}
          <select value={workspaceId} disabled={room !== null} onChange={(event) => setWorkspaceId(event.target.value)}>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
          <span className="hint">{words.workspaceHint}</span>
        </label>
        <fieldset className="room-field room-agents-field">
          <legend>{words.agents}</legend>
          {profiles.length === 0 && <span className="hint">{words.noProfiles}</span>}
          {profiles.map((profile) => (
            <label key={profile.id} className="room-agent-choice">
              <input type="checkbox" checked={agentIds.includes(profile.id)} onChange={() => toggle(profile.id)} />
              {profile.name}
            </label>
          ))}
          <span className="hint">{words.agentsHint}</span>
        </fieldset>
        <fieldset className="room-field room-permissions-field">
          <legend>{words.permissions}</legend>
          {PERMISSION_PRESETS.map((preset) => (
            <label key={preset} className="room-agent-choice">
              <input type="radio" name="room-permissions" checked={permissions === preset} onChange={() => setPermissions(preset)} />
              {words.presets[preset]}
            </label>
          ))}
          <span className="hint">{words.permissionsHint}</span>
        </fieldset>
        <div className="form-actions">
          {room && (
            <ConfirmButton className="link danger room-delete" label={words.deleteRoom} hint={words.deleteHint} armedText={words.deleteArmed} armedHint={words.deleteArmedHint} onConfirm={deleteRoom}>
              {words.deleteRoom}
            </ConfirmButton>
          )}
          <button type="button" className="link" onClick={onClose}>
            {words.cancel}
          </button>
          <button type="submit" className="primary" disabled={!canSave}>
            {room ? words.save : words.create}
          </button>
        </div>
      </form>
    </Modal>
  );
}
