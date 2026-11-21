import { useEffect, useState, type Dispatch } from "react";
import { roomInviteLink } from "../shared/machines.ts";
import type { Person, Profile, ReachabilitySettings, Workspace } from "../shared/model.ts";
import { personGoesBy } from "../shared/people.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { DEFAULT_PERMISSION_PRESET, PERMISSION_PRESETS, type PermissionPreset } from "../shared/room-permissions.ts";
import { ROOM_ROLES, type Room, type RoomInvite, type RoomRole } from "../shared/rooms.ts";
import { tunnelOrigin } from "../shared/tunnel.ts";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { timeOf } from "./Devices.tsx";
import { waitingHints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { Modal } from "./Palette.tsx";
import { QrCode } from "./QrCode.tsx";
import type { AppAction } from "./state.ts";
import { waitingLabels } from "./waiting.ts";

const words = t.rooms;

export function RoomsSection({
  rooms,
  selectedRoomId,
  waitingRoomIds,
  manages,
  dispatch,
}: {
  rooms: Room[];
  selectedRoomId: string | null;
  waitingRoomIds: Set<string>;
  /** The machine's owner makes rooms and changes them; anyone else only opens the ones they are in. */
  manages: boolean;
  dispatch: Dispatch<AppAction>;
}) {
  const openSettings = (roomId: string | null) => dispatch({ type: "open-overlay", overlay: { kind: "room", roomId } });
  return (
    <section className="rooms" aria-label={words.rooms}>
      <header>
        <div className="workspace-heading">
          <div className="workspace-name">{words.rooms}</div>
        </div>
        {manages && (
          <button type="button" className="icon workspace-new" aria-label={words.newRoom} onClick={() => openSettings(null)}>
            +
          </button>
        )}
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
              {manages && (
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
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type RoleInRoom = RoomRole | null;

const rolesIn = (room: Room | null): Record<string, RoleInRoom> => Object.fromEntries(room?.people.map(({ personId, role }) => [personId, role]) ?? []);

/** Lets each person whose role the owner changed into the room with it, or takes them out of it. */
function sendRoleChanges(roomId: string, before: Record<string, RoleInRoom>, after: Record<string, RoleInRoom>) {
  Object.entries(after)
    .filter(([personId, role]) => (before[personId] ?? null) !== role)
    .forEach(([personId, role]) =>
      connection.send(role === null ? { type: "room.remove-person", roomId, personId } : { type: "room.set-person-role", roomId, personId, role }),
    );
}

/**
 * The people of the machine besides its owner, each in the room as a member or a guest, or not in it; what they can
 * reach through the agents with the room's preset; and whether their tasks start without the owner allowing each.
 */
function RoomPeopleField({
  people,
  roles,
  nameClashes,
  permissions,
  tasksStartUnasked,
  onChange,
  onTasksStartUnaskedChange,
}: {
  people: Person[];
  roles: Record<string, RoleInRoom>;
  /** The names people presented on joining that read as one already in the room, by person. */
  nameClashes: Record<string, string>;
  permissions: PermissionPreset;
  tasksStartUnasked: boolean;
  onChange: (personId: string, role: RoleInRoom) => void;
  onTasksStartUnaskedChange: (unasked: boolean) => void;
}) {
  return (
    <fieldset className="room-field room-people-field">
      <legend>{words.people}</legend>
      <span className="hint room-people-reach">
        {words.peopleReach[permissions]} {words.peopleReachBeyond}
      </span>
      {people.length === 0 && <span className="hint">{words.noPeople}</span>}
      {people.map((person) => {
        const name = personGoesBy(person, words.nameless);
        const nameClash = nameClashes[person.id];
        return (
          <div key={person.id}>
            <label className="room-person-choice">
              <span>{name}</span>
              <select aria-label={words.roleOf(name)} value={roles[person.id] ?? ""} onChange={(event) => onChange(person.id, (event.target.value || null) as RoleInRoom)}>
                <option value="">{words.notInRoom}</option>
                {ROOM_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {words.roles[role]}
                  </option>
                ))}
              </select>
            </label>
            {nameClash && <span className="hint room-person-name-clash">{words.nameClash(nameClash)}</span>}
          </div>
        );
      })}
      {people.length > 0 && <span className="hint">{words.peopleHint}</span>}
      <label className="room-agent-choice room-tasks-unasked">
        <input type="checkbox" checked={tasksStartUnasked} onChange={(event) => onTasksStartUnaskedChange(event.target.checked)} />
        {words.peoplesTasksStart}
      </label>
      <span className="hint">{words.peoplesTasksHint}</span>
    </fieldset>
  );
}

/**
 * Invites into the room, each for one person with its role, who joins this machine with it from their own Mirador:
 * the one just made with its code, link and QR code, while it waits, and every waiting one, which can be withdrawn.
 */
type MadeRoomInvite = Extract<ServerMessage, { type: "room.invited" }>;

/**
 * The invite's one link: at this machine's address when it has one, and through its peer-to-peer tunnel when it
 * can, which needs no address at all. The person's Mirador tries what works.
 */
function roomInviteLinkOf({ code, tunnel }: MadeRoomInvite, reachability: ReachabilitySettings | null) {
  const publicOrigin = reachability?.publicAddress?.origin ?? null;
  if (publicOrigin) return roomInviteLink(publicOrigin, code, reachability?.authorityFingerprint ?? null, tunnel);
  return tunnel && roomInviteLink(tunnelOrigin(tunnel), code, null, tunnel);
}

function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(link).then(() => setCopied(true));
  return (
    <button type="button" className="copy-invite-link" onClick={copy}>
      {copied ? words.linkCopied : words.copyLink}
    </button>
  );
}

/** The invites not yet expired, which drop out each as it expires: the host lists them again only when they change otherwise. */
function useUnexpired(invites: RoomInvite[]) {
  const [now, setNow] = useState(Date.now);
  const unexpired = invites.filter(({ expiresAt }) => expiresAt > now);
  const soonestExpiry = Math.min(...unexpired.map(({ expiresAt }) => expiresAt));
  useEffect(() => {
    if (!Number.isFinite(soonestExpiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), soonestExpiry - Date.now());
    return () => clearTimeout(timer);
  }, [soonestExpiry]);
  return unexpired;
}

function RoomInvitesField({ room, invites, reachability }: { room: Room; invites: RoomInvite[]; reachability: ReachabilitySettings | null }) {
  const [role, setRole] = useState<RoomRole>("member");
  const [made, setMade] = useState<MadeRoomInvite | null>(null);
  const waiting = useUnexpired(invites.filter(({ roomId }) => roomId === room.id));
  const makeInvite = async () => {
    try {
      const invited = await connection.sendAndAwait(
        (requestId) => ({ type: "room.invite", requestId, roomId: room.id, role }),
        (message, requestId) => (message.type === "room.invited" && message.requestId === requestId ? message : undefined),
      );
      setMade(invited);
    } catch {
      // Disconnected; the host made no invite
    }
  };
  const shown = made && waiting.some(({ id }) => id === made.invite.id) ? made : null;
  const link = shown && roomInviteLinkOf(shown, reachability);
  const throughTunnelAlone = !reachability?.publicAddress && shown?.tunnel;
  return (
    <fieldset className="room-field room-invites-field">
      <legend>{words.invites}</legend>
      <span className="hint">{words.invitesHint}</span>
      <div className="room-invite-make">
        <label>
          {words.inviteAs}
          <select value={role} onChange={(event) => setRole(event.target.value as RoomRole)}>
            {ROOM_ROLES.map((each) => (
              <option key={each} value={each}>
                {words.roles[each]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void makeInvite()}>
          {words.makeInvite}
        </button>
      </div>
      {shown && (
        <div className="invite room-invite" role="group" aria-label={words.inviteCode}>
          <span>
            {words.inviteCode} <code className="invite-code">{shown.code}</code> {words.inviteWorksUntil(timeOf(shown.invite.expiresAt))}
          </span>
          {link ? (
            <>
              <QrCode text={link} label={words.inviteLinkQr} />
              <span>
                {throughTunnelAlone ? words.inviteLinkPeerToPeerHint : words.inviteLinkHint} <code className="invite-link">{link}</code>
              </span>
              <CopyLinkButton key={link} link={link} />
            </>
          ) : (
            <span className="hint">{words.inviteWithoutLink}</span>
          )}
        </div>
      )}
      {waiting.length > 0 && (
        <ul className="room-invites" aria-label={words.waitingInvites}>
          {waiting.map((invite) => {
            const shownRole = words.roles[invite.role];
            const until = timeOf(invite.expiresAt);
            return (
              <li key={invite.id}>
                <span>{words.waitingInvite(shownRole, until)}</span>
                <button type="button" className="link" aria-label={words.withdrawInviteOf(shownRole, until)} onClick={() => connection.send({ type: "room.withdraw-invite", inviteId: invite.id })}>
                  {words.withdrawInvite}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}

/**
 * Makes a room, or changes one: its name, agents, what they may do without asking and who else is in it, and its
 * invites; a room's workspace stays the one it was made in.
 */
export function RoomDialog({
  room,
  workspaces,
  profiles,
  people,
  ownerId,
  invites,
  reachability,
  dispatch,
  onClose,
}: {
  room: Room | null;
  workspaces: Workspace[];
  profiles: Profile[];
  people: Person[];
  ownerId: string | null;
  invites: RoomInvite[];
  /** How other machines reach this one, which an invite's link needs; null until the host said. */
  reachability: ReachabilitySettings | null;
  dispatch: Dispatch<AppAction>;
  onClose: () => void;
}) {
  const [name, setName] = useState(room?.name ?? "");
  const [workspaceId, setWorkspaceId] = useState(room?.workspaceId ?? workspaces[0]?.id ?? "");
  const [agentIds, setAgentIds] = useState<string[]>(room?.agents.map(({ profileId }) => profileId) ?? []);
  const [permissions, setPermissions] = useState<PermissionPreset>(room?.permissions ?? DEFAULT_PERMISSION_PRESET);
  const [roles, setRoles] = useState(() => rolesIn(room));
  const [tasksStartUnasked, setTasksStartUnasked] = useState(room !== null && !room.peoplesTasksWait);
  const toggle = (profileId: string) => setAgentIds((ticked) => (ticked.includes(profileId) ? ticked.filter((id) => id !== profileId) : [...ticked, profileId]));
  const canSave = name.trim() !== "" && workspaceId !== "";
  const save = () => {
    if (!canSave) return;
    if (room) {
      if (name.trim() !== room.name) connection.send({ type: "room.rename", roomId: room.id, name });
      if (workspaceId !== room.workspaceId) connection.send({ type: "room.set-workspace", roomId: room.id, workspaceId });
      connection.send({ type: "room.set-agents", roomId: room.id, profileIds: agentIds });
      if (permissions !== room.permissions) connection.send({ type: "room.set-permissions", roomId: room.id, permissions });
      if (tasksStartUnasked === room.peoplesTasksWait) connection.send({ type: "room.set-peoples-tasks-wait", roomId: room.id, wait: !tasksStartUnasked });
      sendRoleChanges(room.id, rolesIn(room), roles);
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
          <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
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
        {room && (
          <RoomPeopleField
            people={people.filter(({ id }) => id !== ownerId)}
            roles={roles}
            nameClashes={Object.fromEntries(room.people.flatMap(({ personId, nameClash }) => (nameClash ? [[personId, nameClash]] : [])))}
            permissions={permissions}
            tasksStartUnasked={tasksStartUnasked}
            onChange={(personId, role) => setRoles((before) => ({ ...before, [personId]: role }))}
            onTasksStartUnaskedChange={setTasksStartUnasked}
          />
        )}
        {room && <RoomInvitesField room={room} invites={invites} reachability={reachability} />}
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
