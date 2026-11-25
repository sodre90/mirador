import { useState, type Dispatch } from "react";
import type { Conversation, Profile, Workspace } from "../shared/model.ts";
import { DEFAULT_PERMISSION_PRESET, PERMISSION_PRESETS, type PermissionPreset } from "../shared/room-permissions.ts";
import { PROFILES_MODEL, type Room, type RoomAgentModel } from "../shared/rooms.ts";
import { agentMarks } from "./Chat.tsx";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { Modal } from "./Palette.tsx";
import { AgentSearch, ModelChoice } from "./RoomAgents.tsx";
import { UnconfinedMark } from "./RoomAgentSetup.tsx";
import type { AppAction } from "./state.ts";
import { NAME_FIELD_ATTRIBUTES } from "./typing-aids.ts";

const words = t.rooms;

interface ChosenAgent extends RoomAgentModel {
  profileId: string;
}

/**
 * Where a new room works unless its maker picks another: the workspace of the conversation or room shown, else of the
 * conversation last active, else the first.
 */
export function newRoomWorkspace(workspaces: Workspace[], conversations: Conversation[], selectedConversationId: string | null, selectedRoom: Room | undefined) {
  const known = (workspaceId: string | undefined) => workspaces.find(({ id }) => id === workspaceId)?.id;
  const lastActive = conversations.toSorted((a, b) => b.updatedAt - a.updatedAt)[0];
  return (
    known(conversations.find(({ id }) => id === selectedConversationId)?.workspaceId) ??
    known(selectedRoom?.workspaceId) ??
    known(lastActive?.workspaceId) ??
    workspaces[0]?.id ??
    ""
  );
}

function AgentChip({ profile, agent, onChange, onRemove }: { profile: Profile; agent: ChosenAgent; onChange: (model: RoomAgentModel) => void; onRemove: () => void }) {
  return (
    <li className="room-agent-chip">
      <span className={`avatar agent-${profile.harness}`} aria-hidden="true">
        {agentMarks[profile.harness]}
      </span>
      <span className="room-agent-chip-name">{profile.name}</span>
      <UnconfinedMark harness={profile.harness} />
      <ModelChoice agentName={profile.name} profile={profile} conversation={undefined} chosen={agent} onChange={onChange} />
      <button type="button" className="icon" aria-label={words.removeAgent(profile.name)} onClick={onRemove}>
        ×
      </button>
    </li>
  );
}

/** A new room: its name, its workspace and its agents, each on the model chosen for it; what they may do waits under "More options". */
export function NewRoomDialog({
  workspaces,
  profiles,
  workspaceId: initialWorkspaceId,
  dispatch,
  onClose,
}: {
  workspaces: Workspace[];
  profiles: Profile[];
  workspaceId: string;
  dispatch: Dispatch<AppAction>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId);
  const [agents, setAgents] = useState<ChosenAgent[]>(() => {
    const profileId = workspaces.find(({ id }) => id === initialWorkspaceId)?.defaultLaunch.profileId;
    return profiles.some(({ id }) => id === profileId) ? [{ profileId: profileId!, ...PROFILES_MODEL }] : [];
  });
  const [permissions, setPermissions] = useState<PermissionPreset>(DEFAULT_PERMISSION_PRESET);
  const canCreate = name.trim() !== "" && workspaceId !== "";
  const changeAgent = (profileId: string, model: RoomAgentModel) => setAgents((before) => before.map((agent) => (agent.profileId === profileId ? { profileId, ...model } : agent)));
  const create = () => {
    if (!canCreate) return;
    const requestId = crypto.randomUUID();
    let stop: (() => void) | null = null;
    const done = () => {
      clearTimeout(timer);
      stop?.();
      stop = null;
    };
    const timer = setTimeout(done, 30_000);
    stop = connection.onMessage((message) => {
      if (message.type === "error") return done();
      if (message.type !== "room.created" || message.requestId !== requestId) return;
      done();
      dispatch({ type: "select-room", roomId: message.roomId });
    });
    const models = Object.fromEntries(agents.map(({ profileId, model, effort }) => [profileId, { model, effort }]));
    if (!connection.send({ type: "room.create", requestId, name, workspaceId, profileIds: agents.map(({ profileId }) => profileId), permissions, models })) done();
    onClose();
  };
  return (
    <Modal label={words.newRoom} className="room-dialog new-room-dialog" onClose={onClose}>
      <h2>{words.newRoom}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <label className="room-field">
          {words.name}
          <input autoFocus {...NAME_FIELD_ATTRIBUTES} value={name} onChange={(event) => setName(event.target.value)} />
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
        </label>
        <div className="room-field room-agents-field" role="group" aria-label={words.agents}>
          <span>{words.agents}</span>
          {profiles.length === 0 ? (
            <span className="hint">{words.noProfiles}</span>
          ) : (
            <>
              {agents.length > 0 && (
                <ul className="room-agent-chips" aria-label={words.agents}>
                  {agents.flatMap((agent) => {
                    const profile = profiles.find(({ id }) => id === agent.profileId);
                    return profile
                      ? [
                          <AgentChip
                            key={agent.profileId}
                            profile={profile}
                            agent={agent}
                            onChange={(model) => changeAgent(agent.profileId, model)}
                            onRemove={() => setAgents((before) => before.filter(({ profileId }) => profileId !== agent.profileId))}
                          />,
                        ]
                      : [];
                  })}
                </ul>
              )}
              <AgentSearch
                profiles={profiles}
                chosenIds={agents.map(({ profileId }) => profileId)}
                label={words.findAgent}
                onAdd={(profileId) => setAgents((before) => [...before, { profileId, ...PROFILES_MODEL }])}
              />
              <span className="hint">{words.agentsHint}</span>
            </>
          )}
        </div>
        <details className="room-more-options">
          <summary>{words.moreOptions}</summary>
          <fieldset className="room-field room-permissions-field">
            <legend>{words.permissions}</legend>
            {PERMISSION_PRESETS.map((preset) => (
              <label key={preset} className="room-agent-choice">
                <input type="radio" name="room-permissions" checked={permissions === preset} onChange={() => setPermissions(preset)} />
                {words.presets[preset]}
              </label>
            ))}
          </fieldset>
        </details>
        <div className="form-actions">
          <button type="button" className="link" onClick={onClose}>
            {words.cancel}
          </button>
          <button type="submit" className="primary" disabled={!canCreate}>
            {words.create}
          </button>
        </div>
      </form>
    </Modal>
  );
}
