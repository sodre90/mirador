import { useEffect, useState, type ReactNode } from "react";
import type { Conversation, Person, Profile, Workspace } from "../shared/model.ts";
import { personGoesBy } from "../shared/people.ts";
import { PERMISSION_PRESETS } from "../shared/room-permissions.ts";
import { ROOM_USAGE_PERIODS, sinceOf, type RoomUsage, type RoomUsagePeriod, type Spend } from "../shared/room-usage.ts";
import { ROOM_ROLES, type Room, type RoomAgent, type RoomInvite, type RoomRole } from "../shared/rooms.ts";
import { agentMarks } from "./Chat.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { timeOf } from "./Devices.tsx";
import { formatNumber, t } from "./i18n/index.ts";
import type { RoomSettingsTab } from "./i18n/en/rooms.ts";
import { Modal } from "./Palette.tsx";
import { AgentSearch, ModelChoice } from "./RoomAgents.tsx";
import { AgentSetupMeaning, AgentValues, ClaudeSetupField, UnconfinedLine } from "./RoomAgentSetup.tsx";
import { useSentChoice } from "./sent-choice.ts";
import { NAME_FIELD_ATTRIBUTES } from "./typing-aids.ts";
import { compactTokenCount, formatCost } from "./usage.ts";

const words = t.rooms;

export const ROOM_SETTINGS_TABS: RoomSettingsTab[] = ["people", "agents", "permissions", "usage"];

/** The long story behind a setting, folded away under "What does this mean?". */
function WhatItMeans({ children }: { children: ReactNode }) {
  return (
    <details className="what-it-means">
      <summary>{words.whatDoesThisMean}</summary>
      {children}
    </details>
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

/** The room's name, taken on Enter or as the field loses focus; its workspace; and deleting it. */
function RoomGeneral({ room, workspaces, onDeleted }: { room: Room; workspaces: Workspace[]; onDeleted: () => void }) {
  const [name, setName] = useState(room.name);
  const [workspaceId, moveTo] = useSentChoice(room.workspaceId, (workspaceId) => connection.send({ type: "room.set-workspace", roomId: room.id, workspaceId }));
  const rename = () => {
    if (name.trim() === "") return setName(room.name);
    if (name.trim() !== room.name) connection.send({ type: "room.rename", roomId: room.id, name });
  };
  return (
    <div className="room-general">
      <label className="room-field">
        {words.name}
        <input
          {...NAME_FIELD_ATTRIBUTES}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={rename}
          onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
        />
      </label>
      <label className="room-field">
        {words.workspace}
        <select value={workspaceId} onChange={(event) => moveTo(event.target.value)}>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </label>
      <WhatItMeans>
        <p>{words.workspaceHint}</p>
      </WhatItMeans>
      <ConfirmButton
        className="link danger room-delete"
        label={words.deleteRoom}
        hint={words.deleteHint}
        armedText={words.deleteArmed}
        armedHint={words.deleteArmedHint}
        onConfirm={() => {
          connection.send({ type: "room.delete", roomId: room.id });
          onDeleted();
        }}
      >
        {words.deleteRoom}
      </ConfirmButton>
    </div>
  );
}

function RoleSelect({ label, role, onChange }: { label: string; role: RoomRole; onChange: (role: RoomRole) => void }) {
  const [shown, choose] = useSentChoice(role, onChange);
  return (
    <select aria-label={label} value={shown} onChange={(event) => choose(event.target.value as RoomRole)}>
      {ROOM_ROLES.map((each) => (
        <option key={each} value={each}>
          {words.roles[each]}
        </option>
      ))}
    </select>
  );
}

/** Who is in the room and as what, whether their tasks start unasked, the invites still waiting, and inviting someone. */
function PeopleTab({ room, people, ownerId, invites, onInvite }: { room: Room; people: Person[]; ownerId: string | null; invites: RoomInvite[]; onInvite: () => void }) {
  const waiting = useUnexpired(invites.filter(({ roomId }) => roomId === room.id));
  const nameOf = (personId: string) => personGoesBy(people.find(({ id }) => id === personId), words.nameless);
  const inRoom = new Set(room.people.map(({ personId }) => personId));
  const [peoplesTasksWait, setPeoplesTasksWait] = useSentChoice(room.peoplesTasksWait, (wait) => connection.send({ type: "room.set-peoples-tasks-wait", roomId: room.id, wait }));
  const [agentsReadGuests, setAgentsReadGuests] = useSentChoice(room.agentsReadGuests, (read) => connection.send({ type: "room.set-agents-read-guests", roomId: room.id, read }));
  const letInBefore = people.filter(({ id }) => id !== ownerId && !inRoom.has(id));
  const setRole = (personId: string, role: RoomRole) => connection.send({ type: "room.set-person-role", roomId: room.id, personId, role });
  return (
    <>
      {room.people.length === 0 && <p className="hint">{words.noPeople}</p>}
      <ul className="room-settings-rows" aria-label={words.people}>
        {room.people.map(({ personId, role, nameClash }) => {
          const name = nameOf(personId);
          return (
            <li key={personId}>
              <span className="room-settings-row-name">{name}</span>
              <RoleSelect label={words.roleOf(name)} role={role} onChange={(next) => setRole(personId, next)} />
              <ConfirmButton
                className="link danger"
                label={words.removePerson(name)}
                armedText={words.removeArmed}
                armedHint={words.removePersonArmedHint}
                onConfirm={() => connection.send({ type: "room.remove-person", roomId: room.id, personId })}
              >
                {words.remove}
              </ConfirmButton>
              {nameClash && <span className="hint room-person-name-clash">{words.nameClash(nameClash)}</span>}
            </li>
          );
        })}
      </ul>
      {letInBefore.length > 0 && (
        <select className="room-add-person" aria-label={words.addPerson} value="" onChange={(event) => event.target.value && setRole(event.target.value, "member")}>
          <option value="">{words.addPerson}</option>
          {letInBefore.map((person) => (
            <option key={person.id} value={person.id}>
              {personGoesBy(person, words.nameless)}
            </option>
          ))}
        </select>
      )}
      <label className="room-agent-choice room-tasks-unasked">
        <input type="checkbox" role="switch" checked={!peoplesTasksWait} onChange={(event) => setPeoplesTasksWait(!event.target.checked)} />
        {words.peoplesTasksStart}
      </label>
      <label className="room-agent-choice room-agents-read-guests">
        <input type="checkbox" role="switch" checked={agentsReadGuests} onChange={(event) => setAgentsReadGuests(event.target.checked)} />
        {words.agentsReadGuests}
      </label>
      <WhatItMeans>
        <p>{words.peoplesTasksHint}</p>
        <p>{words.agentsReadGuestsHint}</p>
        <p>{words.peopleHint}</p>
        <p className="room-people-reach">
          {words.peopleReach[room.permissions]} {words.peopleReachBeyond}
        </p>
      </WhatItMeans>
      {waiting.length > 0 && <h3 className="room-invites-heading">{words.waitingInvites}</h3>}
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
      <button type="button" className="room-invite-someone" onClick={onInvite}>
        {words.inviteSomeone}
      </button>
    </>
  );
}

/**
 * The room's agents, each on its model and effort, which apply at once, with the values of its profile it gets; taking
 * one out deletes its conversation in the room. Then what its Claude agents load of the owner's Claude Code setup.
 */
function AgentsTab({ room, profiles, roomConversations }: { room: Room; profiles: Profile[]; roomConversations: Conversation[] }) {
  const profileIds = room.agents.map(({ profileId }) => profileId);
  const setAgents = (ids: string[]) => connection.send({ type: "room.set-agents", roomId: room.id, profileIds: ids });
  const row = (agent: RoomAgent) => {
    const { profileId, conversationId, model, effort } = agent;
    const profile = profiles.find(({ id }) => id === profileId);
    const name = profile?.name ?? words.agentGone;
    return (
      <li key={profileId}>
        <span className={`avatar agent-${profile?.harness ?? "gone"}`} aria-hidden="true">
          {profile ? agentMarks[profile.harness] : "?"}
        </span>
        <span className="room-settings-row-name">{name}</span>
        <ModelChoice
          agentName={name}
          profile={profile}
          conversation={roomConversations.find(({ id }) => id === conversationId)}
          chosen={{ model, effort }}
          onChange={(chosen) => connection.send({ type: "room.set-agent-model", roomId: room.id, profileId, ...chosen })}
        />
        <ConfirmButton
          className="link danger"
          label={words.removeAgent(name)}
          armedText={words.removeArmed}
          armedHint={words.removeAgentArmedHint}
          onConfirm={() => setAgents(profileIds.filter((id) => id !== profileId))}
        >
          {words.remove}
        </ConfirmButton>
        {profile && <UnconfinedLine harness={profile.harness} />}
        {profile && <AgentValues room={room} agent={agent} profile={profile} roomConversations={roomConversations} />}
      </li>
    );
  };
  return (
    <>
      {room.agents.length === 0 && <p className="hint">{words.noAgentsYet}</p>}
      <ul className="room-settings-rows" aria-label={words.agents}>
        {room.agents.map(row)}
      </ul>
      {profiles.length === 0 ? <p className="hint">{words.noProfiles}</p> : <AgentSearch profiles={profiles} chosenIds={profileIds} label={words.addAgent} onAdd={(profileId) => setAgents([...profileIds, profileId])} />}
      <p className="hint">{words.agentsHint}</p>
      <ClaudeSetupField room={room} profiles={profiles} roomConversations={roomConversations} />
      <WhatItMeans>
        <AgentSetupMeaning room={room} profiles={profiles} />
      </WhatItMeans>
    </>
  );
}

function PermissionsTab({ room }: { room: Room }) {
  const [permissions, choose] = useSentChoice(room.permissions, (permissions) => connection.send({ type: "room.set-permissions", roomId: room.id, permissions }));
  return (
    <>
      <fieldset className="room-field room-permissions-field">
        <legend>{words.permissions}</legend>
        {PERMISSION_PRESETS.map((preset) => (
          <label key={preset} className="room-agent-choice">
            <input type="radio" name="room-permissions" checked={permissions === preset} onChange={() => choose(preset)} />
            {words.presets[preset]}
          </label>
        ))}
      </fieldset>
      <WhatItMeans>
        <p>{words.permissionsHint}</p>
        <p>{words.peopleReach[room.permissions]}</p>
      </WhatItMeans>
    </>
  );
}

const USAGE_PERIODS = Object.keys(ROOM_USAGE_PERIODS) as RoomUsagePeriod[];

function SpendRow({ name, spend, withCost }: { name: string; spend: Spend; withCost: boolean }) {
  const { inputTokens, outputTokens, cachedReadTokens, cachedWriteTokens } = spend.tokens;
  const cached = cachedReadTokens + cachedWriteTokens;
  return (
    <tr>
      <th scope="row">{name}</th>
      <td>{formatNumber(spend.turns)}</td>
      <td data-hint={formatNumber(inputTokens)}>{compactTokenCount(inputTokens)}</td>
      <td data-hint={formatNumber(outputTokens)}>{compactTokenCount(outputTokens)}</td>
      <td data-hint={formatNumber(cached)}>{compactTokenCount(cached)}</td>
      {withCost && <td>{spend.cost ? formatCost(spend.cost) : "–"}</td>}
    </tr>
  );
}

/**
 * What the room's agents took for their turns over a period, for the owner alone: in all, by agent, and by the person
 * whose message started each turn.
 */
function UsageTab({ room, profiles, people, ownerId }: { room: Room; profiles: Profile[]; people: Person[]; ownerId: string | null }) {
  const [period, setPeriod] = useState<RoomUsagePeriod>("month");
  const [usage, setUsage] = useState<RoomUsage | null>(null);
  useEffect(() => {
    let wanted = true;
    setUsage(null);
    connection
      .sendAndAwait(
        (requestId) => ({ type: "room.usage.get", requestId, roomId: room.id, since: sinceOf(period, Date.now()) }),
        (message, requestId) => (message.type === "room.usage.got" && message.requestId === requestId ? message.usage : undefined),
      )
      .then(
        (got) => wanted && setUsage(got),
        () => {},
      );
    return () => {
      wanted = false;
    };
  }, [room.id, period]);
  const agentName = (profileId: string) => profiles.find(({ id }) => id === profileId)?.name ?? words.agentGone;
  const personName = (personId: string) => personGoesBy(people.find(({ id }) => id === personId), personId === ownerId ? t.chat.author.you : words.nameless);
  const withCost = Boolean(usage?.total.cost);
  const heading = (
    <tr>
      <td />
      <th scope="col">{words.usageTurns}</th>
      <th scope="col">{words.usageInput}</th>
      <th scope="col">{words.usageOutput}</th>
      <th scope="col">{words.usageCached}</th>
      {withCost && <th scope="col">{words.usageCost}</th>}
    </tr>
  );
  return (
    <div className="room-usage-field">
      <label className="room-usage-period">
        {words.usagePeriod}
        <select value={period} onChange={(event) => setPeriod(event.target.value as RoomUsagePeriod)}>
          {USAGE_PERIODS.map((each) => (
            <option key={each} value={each}>
              {words.usagePeriods[each]}
            </option>
          ))}
        </select>
      </label>
      {!usage && <span className="hint">{words.loading}</span>}
      {usage && usage.total.turns === 0 && <span className="hint">{words.usageNone}</span>}
      {usage && usage.total.turns > 0 && (
        <>
          <table className="room-usage" aria-label={words.usageByAgent}>
            <caption>{words.usageByAgent}</caption>
            <thead>{heading}</thead>
            <tbody>
              {usage.agents.map(({ profileId, spend }) => (
                <SpendRow key={profileId} name={agentName(profileId)} spend={spend} withCost={withCost} />
              ))}
            </tbody>
            <tfoot>
              <SpendRow name={words.usageTotal} spend={usage.total} withCost={withCost} />
            </tfoot>
          </table>
          {usage.people.length > 0 && (
            <table className="room-usage" aria-label={words.usageByPerson}>
              <caption>{words.usageByPerson}</caption>
              <thead>{heading}</thead>
              <tbody>
                {usage.people.map(({ personId, spend }) => (
                  <SpendRow key={personId} name={personName(personId)} spend={spend} withCost={withCost} />
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <WhatItMeans>
        <p>{words.usageHint}</p>
      </WhatItMeans>
    </div>
  );
}

/** A room's settings, each applied as it changes: its name, workspace and deletion first, then a tab for each part. */
export function RoomSettingsDialog({
  room,
  tab,
  workspaces,
  profiles,
  people,
  ownerId,
  invites,
  roomConversations,
  onInvite,
  onClose,
}: {
  room: Room;
  tab: RoomSettingsTab | undefined;
  workspaces: Workspace[];
  profiles: Profile[];
  people: Person[];
  ownerId: string | null;
  invites: RoomInvite[];
  roomConversations: Conversation[];
  onInvite: () => void;
  onClose: () => void;
}) {
  const [shownTab, setShownTab] = useState<RoomSettingsTab>(tab ?? "people");
  return (
    <Modal label={words.editRoom} className="room-dialog room-settings" onClose={onClose}>
      <h2>{words.roomSettings(room.name)}</h2>
      <RoomGeneral room={room} workspaces={workspaces} onDeleted={onClose} />
      <div className="room-tabs" role="tablist" aria-label={words.editRoom}>
        {ROOM_SETTINGS_TABS.map((each) => (
          <button key={each} type="button" role="tab" id={`room-tab-${each}`} aria-selected={shownTab === each} aria-controls="room-tab-panel" onClick={() => setShownTab(each)}>
            {words.tabs[each]}
          </button>
        ))}
      </div>
      <div className="room-tab-panel" id="room-tab-panel" role="tabpanel" aria-labelledby={`room-tab-${shownTab}`}>
        {shownTab === "people" && <PeopleTab room={room} people={people} ownerId={ownerId} invites={invites} onInvite={onInvite} />}
        {shownTab === "agents" && <AgentsTab room={room} profiles={profiles} roomConversations={roomConversations} />}
        {shownTab === "permissions" && <PermissionsTab room={room} />}
        {shownTab === "usage" && <UsageTab room={room} profiles={profiles} people={people} ownerId={ownerId} />}
      </div>
      <div className="form-actions">
        <button type="button" className="primary" onClick={onClose}>
          {words.done}
        </button>
      </div>
    </Modal>
  );
}
