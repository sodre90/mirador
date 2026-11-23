import { useEffect, useState, type ReactNode } from "react";
import type { Conversation, Person, Profile, Workspace } from "../shared/model.ts";
import { personGoesBy } from "../shared/people.ts";
import { PERMISSION_PRESETS } from "../shared/room-permissions.ts";
import { ROOM_USAGE_PERIODS, sinceOf, type RoomUsage, type RoomUsagePeriod, type Spend } from "../shared/room-usage.ts";
import { relativeTimeOf } from "../shared/relative-time.ts";
import { broughtAgentName, ROOM_ROLES, type Room, type RoomAgent, type RoomInvite, type RoomJoiner, type RoomRole } from "../shared/rooms.ts";
import type { SandboxSetup } from "../shared/sandbox.ts";
import { agentMarks } from "./Chat.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { HintedWhenCutShort } from "./cut-short.tsx";
import { formatNumber, locale, t } from "./i18n/index.ts";
import type { RoomSettingsTab } from "./i18n/en/rooms.ts";
import { Modal } from "./Palette.tsx";
import { AgentSearch, ModelChoice } from "./RoomAgents.tsx";
import { AgentSetupMeaning, AgentValues, ClaudeSetupField, UnconfinedLine } from "./RoomAgentSetup.tsx";
import { SandboxField, SandboxMeaning } from "./RoomSandbox.tsx";
import { useSentChoice } from "./sent-choice.ts";
import { NAME_FIELD_ATTRIBUTES } from "./typing-aids.ts";
import { compactTokenCount, formatCost } from "./usage.ts";

const words = t.rooms;

export const ROOM_SETTINGS_TABS: RoomSettingsTab[] = ["people", "agents", "permissions", "usage"];

/** The long story behind a setting, folded away under "What does this mean?". */
export function WhatItMeans({ children }: { children: ReactNode }) {
  return (
    <details className="what-it-means">
      <summary>{words.whatDoesThisMean}</summary>
      {children}
    </details>
  );
}

/** How often the time an invite has left is told afresh. */
const EXPIRY_TOLD_EVERY_MS = 30_000;

/**
 * The invites not yet expired, which drop out each as it expires, with the time they have left told afresh now and then:
 * the host lists them again only when they change otherwise.
 */
function useUnexpired(invites: RoomInvite[]) {
  const [now, setNow] = useState(Date.now);
  const unexpired = invites.filter(({ expiresAt }) => expiresAt > now);
  const soonestExpiry = Math.min(...unexpired.map(({ expiresAt }) => expiresAt));
  useEffect(() => {
    if (!Number.isFinite(soonestExpiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), soonestExpiry - Date.now());
    const clock = setInterval(() => setNow(Date.now()), EXPIRY_TOLD_EVERY_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [soonestExpiry]);
  return unexpired;
}

/** An invite as the owner sees it waiting: the role it gives, how many of its people came when it is for several, and when it expires. */
function waitingInviteText({ role, seats, taken, expiresAt }: RoomInvite) {
  return [words.roles[role], seats > 1 && words.seatsTaken(taken, seats), words.expiresIn(relativeTimeOf(expiresAt, locale))].filter(Boolean).join(" · ");
}

/**
 * The people an invite took to the room's door, whom the owner lets in or turns away: each with the role they would get,
 * apart from the name of the device they came on, which they chose themselves, and a name of theirs that reads as one
 * already in the room marked as the room marks it.
 */
export function WaitingToJoin({ joiners }: { joiners: RoomJoiner[] }) {
  if (joiners.length === 0) return null;
  return (
    <>
      <h3 className="room-joiners-heading">{words.waitingToJoin}</h3>
      <ul className="room-joiners" aria-label={words.waitingToJoin}>
        {joiners.map(({ roomId, personId, role, name, nameClash, deviceName }) => {
          const shownName = name || words.nameless;
          return (
            <li key={personId}>
              <span className="room-joiner-name">{shownName}</span>
              <span className="room-role-label room-joiner-role">{words.roles[role]}</span>
              <span className="room-joiner-device">{words.cameFromDevice(deviceName)}</span>
              <button type="button" className="primary" aria-label={words.letInWho(shownName)} onClick={() => connection.send({ type: "room.let-in", roomId, personId })}>
                {words.letIn}
              </button>
              <ConfirmButton
                className="link danger"
                label={words.turnAwayWho(shownName)}
                armedText={words.turnAwayArmed}
                armedHint={words.turnAwayArmedHint}
                onConfirm={() => connection.send({ type: "room.turn-away", roomId, personId })}
              >
                {words.turnAway}
              </ConfirmButton>
              {nameClash && <span className="hint room-person-name-clash">{words.gaveNameInRoom(nameClash)}</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
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

/** Who is in the room and as what, who waits at its door, whether their tasks start unasked, the invites still waiting, and inviting someone. */
function PeopleTab({ room, people, ownerId, invites, joiners, onInvite }: { room: Room; people: Person[]; ownerId: string | null; invites: RoomInvite[]; joiners: RoomJoiner[]; onInvite: () => void }) {
  const waiting = useUnexpired(invites.filter(({ roomId }) => roomId === room.id));
  const nameOf = (personId: string) => personGoesBy(people.find(({ id }) => id === personId), words.nameless);
  const inRoom = new Set([...room.people, ...joiners].map(({ personId }) => personId));
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
      <WaitingToJoin joiners={joiners} />
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
            const shown = waitingInviteText(invite);
            return (
              <li key={invite.id}>
                <span>{shown}</span>
                <button type="button" className="link" aria-label={words.withdrawInviteOf(words.roles[invite.role], words.expiresIn(relativeTimeOf(invite.expiresAt, locale)))} onClick={() => connection.send({ type: "room.withdraw-invite", inviteId: invite.id })}>
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
function AgentsTab({ room, profiles, people, roomConversations }: { room: Room; profiles: Profile[]; people: Person[]; roomConversations: Conversation[] }) {
  const ownAgents = room.agents.filter(({ brought }) => !brought);
  const profileIds = ownAgents.map(({ profileId }) => profileId);
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
        <HintedWhenCutShort className="room-settings-row-name room-settings-agent-name" whole={name}>
          {name}
        </HintedWhenCutShort>
        <span className="room-settings-agent-choices">
          <ModelChoice
            agentName={name}
            profile={profile}
            conversation={roomConversations.find(({ id }) => id === conversationId)}
            chosen={{ model, effort }}
            onChange={(chosen) => connection.send({ type: "room.set-agent-model", roomId: room.id, profileId, ...chosen })}
          />
        </span>
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
      {ownAgents.length === 0 && <p className="hint">{words.noAgentsYet}</p>}
      <ul className="room-settings-rows" aria-label={words.agents}>
        {ownAgents.map(row)}
      </ul>
      {profiles.length === 0 ? <p className="hint">{words.noProfiles}</p> : <AgentSearch profiles={profiles} chosenIds={profileIds} label={words.addAgent} onAdd={(profileId) => setAgents([...profileIds, profileId])} />}
      <p className="hint">{words.agentsHint}</p>
      <ClaudeSetupField room={room} profiles={profiles} roomConversations={roomConversations} />
      <WhatItMeans>
        <AgentSetupMeaning room={room} profiles={profiles} />
      </WhatItMeans>
      <BroughtAgents room={room} people={people} />
    </>
  );
}

/** The agents members brought from their own Miradors, which the owner takes out, and whether members may bring them. */
function BroughtAgents({ room, people }: { room: Room; people: Person[] }) {
  const [membersBring, setMembersBring] = useSentChoice(room.membersBringAgents, (allowed) => connection.send({ type: "room.set-members-bring-agents", roomId: room.id, allowed }));
  const brought = room.agents.flatMap(({ profileId, brought }) => (brought ? [{ agentId: profileId, ...brought, bringer: personGoesBy(people.find(({ id }) => id === brought.personId), words.nameless) }] : []));
  return (
    <>
      <h3 className="room-brought-heading">{words.broughtAgents}</h3>
      {brought.length > 0 && (
        <ul className="room-settings-rows" aria-label={words.broughtAgents}>
          {brought.map(({ agentId, name, harness, here, bringer }) => {
            const shownName = broughtAgentName(bringer, name);
            return (
              <li key={agentId}>
                <span className={`avatar agent-${harness}`} aria-hidden="true">
                  {agentMarks[harness]}
                </span>
                <span className="room-settings-row-name">{shownName}</span>
                <span className={`room-agent-brought${here ? "" : " away"}`}>{here ? words.onComputerOf(bringer) : words.awayFrom(bringer)}</span>
                <ConfirmButton
                  className="link danger"
                  label={words.takeOutAgent(shownName)}
                  armedText={words.takeOutArmed}
                  armedHint={words.takeOutArmedHint}
                  onConfirm={() => connection.send({ type: "room.take-agent-out", roomId: room.id, agentId })}
                >
                  {words.takeOut}
                </ConfirmButton>
              </li>
            );
          })}
        </ul>
      )}
      <label className="room-agent-choice room-members-bring-agents">
        <input type="checkbox" role="switch" checked={membersBring} onChange={(event) => setMembersBring(event.target.checked)} />
        {words.membersBringAgents}
      </label>
      <p className="hint">{words.membersBringAgentsHint}</p>
    </>
  );
}

/** What the room's agents may do without asking, then whether they run in a sandbox of their own. */
function PermissionsTab({ room, profiles, roomConversations, sandboxSetup }: { room: Room; profiles: Profile[]; roomConversations: Conversation[]; sandboxSetup: SandboxSetup }) {
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
        {room.sandbox.on && room.sandbox.workFreely && <p className="hint">{words.presetsAsideInSandbox}</p>}
      </fieldset>
      <WhatItMeans>
        <p>{words.permissionsHint}</p>
        <p>{words.peopleReach[room.permissions]}</p>
      </WhatItMeans>
      <SandboxField room={room} profiles={profiles} roomConversations={roomConversations} setup={sandboxSetup} />
      <WhatItMeans>
        <SandboxMeaning />
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
  joiners,
  roomConversations,
  sandboxSetup,
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
  /** Who waits at the room's door. */
  joiners: RoomJoiner[];
  roomConversations: Conversation[];
  sandboxSetup: SandboxSetup;
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
        {shownTab === "people" && <PeopleTab room={room} people={people} ownerId={ownerId} invites={invites} joiners={joiners} onInvite={onInvite} />}
        {shownTab === "agents" && <AgentsTab room={room} profiles={profiles} people={people} roomConversations={roomConversations} />}
        {shownTab === "permissions" && <PermissionsTab room={room} profiles={profiles} roomConversations={roomConversations} sandboxSetup={sandboxSetup} />}
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
