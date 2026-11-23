import { useEffect, useId, useState, type ReactNode } from "react";
import type { Conversation, Person, Profile, Workspace } from "../shared/model.ts";
import { personGoesBy } from "../shared/people.ts";
import { PERMISSION_PRESETS } from "../shared/room-permissions.ts";
import { ROOM_USAGE_PERIODS, sinceOf, type RoomUsage, type RoomUsagePeriod, type Spend } from "../shared/room-usage.ts";
import { relativeTimeOf } from "../shared/relative-time.ts";
import { ROOM_ROLES, type Room, type RoomInvite, type RoomJoiner, type RoomRole } from "../shared/rooms.ts";
import type { SandboxFolders, SandboxSetup } from "../shared/sandbox.ts";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { formatNumber, locale, t } from "./i18n/index.ts";
import type { RoomSettingsTab } from "./i18n/en/rooms.ts";
import { Modal } from "./Palette.tsx";
import { AgentsTab } from "./RoomAgentsSettings.tsx";
import { ControlRow, RoomSection, SwitchRow } from "./RoomSection.tsx";
import { SandboxField } from "./Sandbox.tsx";
import { useSentChoice } from "./sent-choice.ts";
import { SettingsPageList, settingsPanel } from "./SettingsPages.tsx";
import { NAME_FIELD_ATTRIBUTES } from "./typing-aids.ts";
import { compactTokenCount, formatCost } from "./usage.ts";

const words = t.rooms;

const ROOM_SETTINGS_TABS: RoomSettingsTab[] = ["general", "people", "agents", "permissions", "usage"];

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
 * Someone an invite took to the room's door, whom the owner lets in or turns away: with the role they would get, on a
 * line of its own the name of the device they came on, which they chose themselves, and a name of theirs that reads as
 * one already in the room marked as the room marks it.
 */
export function JoinerAtTheDoor({ joiner: { roomId, personId, role, name, nameClash, deviceName } }: { joiner: RoomJoiner }) {
  const shownName = name || words.nameless;
  return (
    <li>
      <div className="room-joiner-who">
        <div className="room-joiner-line">
          <span className="room-joiner-name">{shownName}</span>
          <span className="room-role-label room-joiner-role">{words.roles[role]}</span>
        </div>
        <div className="room-joiner-device">{words.cameFromDevice(deviceName)}</div>
        {nameClash && <div className="hint room-person-name-clash">{words.gaveNameInRoom(nameClash)}</div>}
      </div>
      <div className="room-joiner-actions">
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
      </div>
    </li>
  );
}

/** The people an invite took to the room's door, each to let in or turn away. */
export function WaitingToJoin({ joiners }: { joiners: RoomJoiner[] }) {
  if (joiners.length === 0) return null;
  return (
    <>
      <h3 className="room-joiners-heading">{words.waitingToJoin}</h3>
      <ul className="room-joiners" aria-label={words.waitingToJoin}>
        {joiners.map((joiner) => (
          <JoinerAtTheDoor key={joiner.personId} joiner={joiner} />
        ))}
      </ul>
    </>
  );
}

function DeleteRoom({ room, onDeleted }: { room: Room; onDeleted: () => void }) {
  return (
    <ConfirmButton
      className="link danger"
      label={words.deleteRoom}
      armedText={words.deleteArmed}
      armedHint={words.deleteArmedHint}
      onConfirm={() => {
        connection.send({ type: "room.delete", roomId: room.id });
        onDeleted();
      }}
    >
      {words.deleteRoom}
    </ConfirmButton>
  );
}

/** The room's name, taken on Enter or as the field loses focus, its workspace, and deleting it. */
function GeneralTab({ room, workspaces, onDeleted }: { room: Room; workspaces: Workspace[]; onDeleted: () => void }) {
  const [name, setName] = useState(room.name);
  const [workspaceId, moveTo] = useSentChoice(room.workspaceId, (workspaceId) => connection.send({ type: "room.set-workspace", roomId: room.id, workspaceId }));
  const rename = () => {
    if (name.trim() === "") return setName(room.name);
    if (name.trim() !== room.name) connection.send({ type: "room.rename", roomId: room.id, name });
  };
  return (
    <>
      <ul className="settings-rows">
        <ControlRow
          title={words.name}
          control={(id) => (
            <input
              {...NAME_FIELD_ATTRIBUTES}
              id={id}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={rename}
              onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
            />
          )}
        />
        <ControlRow
          title={words.workspace}
          note={words.workspaceHint}
          control={(id) => (
            <select id={id} value={workspaceId} onChange={(event) => moveTo(event.target.value)}>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          )}
        />
      </ul>
      <ul className="settings-rows">
        <li className="room-control-row">
          <span className="room-row-words">{words.deleteHint}</span>
          <DeleteRoom room={room} onDeleted={onDeleted} />
        </li>
      </ul>
    </>
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

export function RemovePerson({ roomId, personId, name }: { roomId: string; personId: string; name: string }) {
  return (
    <ConfirmButton
      className="link danger room-remove-person"
      label={words.removePerson(name)}
      armedText={words.removeArmed}
      armedHint={words.removePersonArmedHint}
      onConfirm={() => connection.send({ type: "room.remove-person", roomId, personId })}
    >
      {words.remove}
    </ConfirmButton>
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
      <RoomSection
        title={words.people}
        meaning={[words.peopleHint, `${words.peopleReach[room.permissions]} ${words.peopleReachBeyond}`]}
        action={
          <button type="button" className="primary" onClick={onInvite}>
            {words.inviteSomeone}
          </button>
        }
      >
        <ul className="settings-rows room-settings-rows" aria-label={words.people}>
          {room.people.length === 0 && <li className="room-none">{words.noPeople}</li>}
          {room.people.map(({ personId, role, nameClash }) => {
            const name = nameOf(personId);
            return (
              <li key={personId}>
                <span className="room-settings-row-name">{name}</span>
                <RoleSelect label={words.roleOf(name)} role={role} onChange={(next) => setRole(personId, next)} />
                <RemovePerson roomId={room.id} personId={personId} name={name} />
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
      </RoomSection>
      {joiners.length > 0 && (
        <RoomSection title={words.waitingToJoin}>
          <ul className="settings-rows" aria-label={words.waitingToJoin}>
            {joiners.map((joiner) => (
              <JoinerAtTheDoor key={joiner.personId} joiner={joiner} />
            ))}
          </ul>
        </RoomSection>
      )}
      {waiting.length > 0 && (
        <RoomSection title={words.waitingInvites}>
          <ul className="settings-rows" aria-label={words.waitingInvites}>
            {waiting.map((invite) => {
              const shown = waitingInviteText(invite);
              return (
                <li key={invite.id}>
                  <span className="room-row-words">{shown}</span>
                  <button type="button" className="link" aria-label={words.withdrawInviteOf(words.roles[invite.role], words.expiresIn(relativeTimeOf(invite.expiresAt, locale)))} onClick={() => connection.send({ type: "room.withdraw-invite", inviteId: invite.id })}>
                    {words.withdrawInvite}
                  </button>
                </li>
              );
            })}
          </ul>
        </RoomSection>
      )}
      <RoomSection title={words.reachesAgents} meaning={words.agentsReadGuestsHint}>
        <ul className="settings-rows">
          <SwitchRow title={words.peoplesTasksStart} note={words.peoplesTasksHint} checked={!peoplesTasksWait} onChange={(start) => setPeoplesTasksWait(!start)} />
          <SwitchRow title={words.agentsReadGuests} checked={agentsReadGuests} onChange={setAgentsReadGuests} />
        </ul>
      </RoomSection>
    </>
  );
}

/** What the room's agents may do without asking, then whether they run in a sandbox of their own. */
function PermissionsTab({
  room,
  profiles,
  roomConversations,
  sandboxSetup,
  sandboxFolders,
  homeDir,
}: {
  room: Room;
  profiles: Profile[];
  roomConversations: Conversation[];
  sandboxSetup: SandboxSetup;
  sandboxFolders: SandboxFolders;
  homeDir: string;
}) {
  const [permissions, choose] = useSentChoice(room.permissions, (permissions) => connection.send({ type: "room.set-permissions", roomId: room.id, permissions }));
  const setAsideId = useId();
  const setAside = room.sandbox.on && room.sandbox.workFreely;
  return (
    <>
      <RoomSection title={words.permissions} meaning={[words.permissionsHint, words.peopleReach[room.permissions]]}>
        <ul className="settings-rows" role="radiogroup" aria-label={words.permissions} aria-describedby={setAside ? setAsideId : undefined}>
          {PERMISSION_PRESETS.map((preset) => (
            <li key={preset} role="none">
              <label className="room-switch">
                <input type="radio" name="room-permissions" checked={permissions === preset} onChange={() => choose(preset)} />
                {words.presets[preset]}
              </label>
            </li>
          ))}
        </ul>
        {setAside && (
          <p className="hint" id={setAsideId}>
            {words.presetsAsideInSandbox}
          </p>
        )}
      </RoomSection>
      <RoomSection title={words.sandbox.legend} meaning={words.sandbox.meaning}>
        <SandboxField room={room} profiles={profiles} roomConversations={roomConversations} setup={sandboxSetup} folders={sandboxFolders} homeDir={homeDir} />
      </RoomSection>
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
    <RoomSection
      title={words.usage}
      meaning={words.usageHint}
      action={
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
      }
    >
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
    </RoomSection>
  );
}

/** A room's settings, each applied as it changes, on a page for each part. */
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
  sandboxFolders,
  homeDir,
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
  /** The folders of this computer the room gave its sandbox. */
  sandboxFolders: SandboxFolders;
  homeDir: string;
  onInvite: () => void;
  onClose: () => void;
}) {
  const [shownTab, setShownTab] = useState<RoomSettingsTab>(tab ?? "people");
  const [openedAgentId, setOpenedAgentId] = useState<string | null>(null);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && !event.defaultPrevented && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const choosePage = (chosen: RoomSettingsTab) => {
    setOpenedAgentId(null);
    setShownTab(chosen);
  };
  const pages: Record<RoomSettingsTab, () => ReactNode> = {
    general: () => <GeneralTab room={room} workspaces={workspaces} onDeleted={onClose} />,
    people: () => <PeopleTab room={room} people={people} ownerId={ownerId} invites={invites} joiners={joiners} onInvite={onInvite} />,
    agents: () => <AgentsTab room={room} profiles={profiles} people={people} roomConversations={roomConversations} openedId={openedAgentId} onOpen={setOpenedAgentId} />,
    permissions: () => <PermissionsTab room={room} profiles={profiles} roomConversations={roomConversations} sandboxSetup={sandboxSetup} sandboxFolders={sandboxFolders} homeDir={homeDir} />,
    usage: () => <UsageTab room={room} profiles={profiles} people={people} ownerId={ownerId} />,
  };
  return (
    <Modal label={words.editRoom} className="room-settings" onClose={onClose}>
      <header>
        <h2>{words.roomSettings(room.name)}</h2>
        <button type="button" className="icon" title={t.settings.close} aria-label={t.settings.close} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="settings-body">
        <SettingsPageList pages={ROOM_SETTINGS_TABS} labels={words.tabs} label={words.editRoom} page={shownTab} onChoose={choosePage} />
        <div className="settings-page" {...settingsPanel(shownTab)}>
          {pages[shownTab]()}
        </div>
      </div>
    </Modal>
  );
}
