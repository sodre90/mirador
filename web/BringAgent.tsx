import { useState, type FormEvent } from "react";
import { defaultBroughtProfileId, OTHERS_TASKS, worksInRoomsWorkspaces, type OthersTasks } from "../shared/brought-agents.ts";
import type { JoinedRoom, Machine, Profile, Workspace } from "../shared/model.ts";
import { connection } from "./connection.ts";
import { replyProblemText } from "./host-error.ts";
import { t } from "./i18n/index.ts";
import { Modal } from "./Palette.tsx";
import { WhatItMeans } from "./RoomSection.tsx";

const words = t.rooms;

const THE_ROOMS_WORKSPACE = "";

/** Brings an agent of one of your profiles into a room of someone else's machine, to work here in one of your workspaces, or there in the room's. */
export function BringAgentDialog({
  machine,
  room,
  profiles,
  workspaces,
  onClose,
}: {
  machine: Machine;
  room: JoinedRoom;
  profiles: Profile[];
  workspaces: Workspace[];
  onClose: () => void;
}) {
  const ownWorkspaces = workspaces.filter(({ forBroughtAgents }) => !forBroughtAgents);
  const [profileId, setProfileId] = useState(() => defaultBroughtProfileId(profiles));
  const [workspaceId, setWorkspaceId] = useState(THE_ROOMS_WORKSPACE);
  const [othersTasks, setOthersTasks] = useState<OthersTasks>("after-ok");
  const [bringing, setBringing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const profile = profiles.find(({ id }) => id === profileId);
  const inRoomsWorkspace = workspaceId === THE_ROOMS_WORKSPACE;
  const worksThere = profile !== undefined && (!inRoomsWorkspace || worksInRoomsWorkspaces(profile.harness));
  const bring = async (event: FormEvent) => {
    event.preventDefault();
    setBringing(true);
    setProblem(null);
    try {
      const answer = await connection.sendAndAwait(
        (requestId) => ({ type: "machine.bring-agent", requestId, machineId: machine.id, roomId: room.id, profileId, workspaceId: inRoomsWorkspace ? null : workspaceId, othersTasks }),
        (message, requestId) => (message.type === "machine.agent-brought" && message.requestId === requestId ? message : undefined),
      );
      if (answer.problem) return setProblem(replyProblemText(answer));
      onClose();
    } catch {
      // Disconnected; the page says so
    } finally {
      setBringing(false);
    }
  };
  return (
    <Modal label={words.bringAgentInto(room.name)} className="room-dialog bring-agent-dialog" onClose={onClose}>
      <h2>{words.bringAgentInto(room.name)}</h2>
      <p className="hint">{words.onMachine(machine.name)}</p>
      <form onSubmit={(event) => void bring(event)}>
        <label className="room-field">
          {words.agent}
          <select autoFocus value={profileId} onChange={(event) => setProfileId(event.target.value)}>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <p className="hint brought-name-seen">{words.broughtNameSeen}</p>
        <label className="room-field">
          {words.workspace}
          <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
            <option value={THE_ROOMS_WORKSPACE}>{words.roomsWorkspaceOf(machine.name)}</option>
            {ownWorkspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        {profile && !worksThere && <p className="hint">{words.onlyClaudeInRoomsWorkspace}</p>}
        <fieldset className="room-field">
          <legend>{words.othersTasks}</legend>
          {OTHERS_TASKS.map((each) => (
            <label key={each} className="room-agent-choice">
              <input type="radio" name="brought-others-tasks" checked={othersTasks === each} onChange={() => setOthersTasks(each)} />
              {words.othersTasksChoices[each]}
            </label>
          ))}
        </fieldset>
        <WhatItMeans text={inRoomsWorkspace ? words.bringIntoWorkspaceMeaning : words.bringMeaning} />
        {profiles.length === 0 && <p className="hint">{words.noProfiles}</p>}
        {problem && <p className="warning bring-agent-problem">{problem}</p>}
        <div className="form-actions">
          <button type="button" className="link" onClick={onClose}>
            {words.cancel}
          </button>
          <button type="submit" className="primary" disabled={bringing || !worksThere}>
            {bringing ? words.bringing : words.bring}
          </button>
        </div>
      </form>
    </Modal>
  );
}
