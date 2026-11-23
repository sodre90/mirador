import { useState } from "react";
import type { Conversation, Person, Profile } from "../shared/model.ts";
import { personGoesBy } from "../shared/people.ts";
import { heldToAskingInRooms } from "../shared/room-agent-setup.ts";
import { broughtAgentName, type Room, type RoomAgent } from "../shared/rooms.ts";
import { agentMarks } from "./Chat.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { textCutShort, useCutShort } from "./cut-short.tsx";
import { t } from "./i18n/index.ts";
import { AgentSearch, ModelChoice } from "./RoomAgents.tsx";
import { AgentValues, ClaudeSetupSection, environmentInWords, nameOf, UnconfinedLine } from "./RoomAgentSetup.tsx";
import { MeaningMark, RoomSection, SwitchRow } from "./RoomSection.tsx";
import { useSentChoice } from "./sent-choice.ts";

const words = t.rooms;

const ownAgentsOf = (room: Room) => room.agents.filter(({ brought }) => !brought);

const setAgents = (room: Room, profileIds: string[]) => connection.send({ type: "room.set-agents", roomId: room.id, profileIds });

function AgentAvatar({ profile }: { profile: Profile | undefined }) {
  return (
    <span className={`avatar agent-${profile?.harness ?? "gone"}`} aria-hidden="true">
      {profile ? agentMarks[profile.harness] : "?"}
    </span>
  );
}

/** An agent of the room with the model and effort it runs on, which apply at once; the rest of it opens on a click. */
function AgentRow({
  room,
  agent,
  profiles,
  conversation,
  takesFocus,
  onOpen,
}: {
  room: Room;
  agent: RoomAgent;
  profiles: Profile[];
  conversation: Conversation | undefined;
  takesFocus: boolean;
  onOpen: () => void;
}) {
  const { profileId, model, effort } = agent;
  const profile = profiles.find(({ id }) => id === profileId);
  const name = nameOf(profiles, profileId);
  const [nameElement, cutShort] = useCutShort<HTMLSpanElement>(textCutShort, name);
  return (
    <li>
      <button type="button" className="room-agent-open" aria-label={words.settingsOfAgent(name)} data-hint={cutShort ? name : undefined} autoFocus={takesFocus} onClick={onOpen}>
        <AgentAvatar profile={profile} />
        <span className="room-row-words">
          <span ref={nameElement} className="room-row-title room-settings-agent-name">
            {name}
          </span>
          {profile && (
            <span className="hint">
              {!heldToAskingInRooms(profile.harness) && (
                <>
                  <UnconfinedLine harness={profile.harness} /> ·{" "}
                </>
              )}
              {environmentInWords(agent, profile)}
            </span>
          )}
        </span>
      </button>
      <span className="room-settings-agent-choices">
        <ModelChoice
          agentName={name}
          profile={profile}
          conversation={conversation}
          chosen={{ model, effort }}
          onChange={(chosen) => connection.send({ type: "room.set-agent-model", roomId: room.id, profileId, ...chosen })}
        />
      </span>
    </li>
  );
}

/** One agent of the room: what it gets of its environment, and taking it out, which deletes its conversation in the room. */
function AgentPage({ room, agent, profiles, roomConversations, onBack }: { room: Room; agent: RoomAgent; profiles: Profile[]; roomConversations: Conversation[]; onBack: () => void }) {
  const profile = profiles.find(({ id }) => id === agent.profileId);
  const name = nameOf(profiles, agent.profileId);
  return (
    <>
      <div className="room-agent-page-head">
        <button type="button" className="link" autoFocus onClick={onBack}>
          <span aria-hidden="true">‹ </span>
          {words.agents}
        </button>
        <AgentAvatar profile={profile} />
        <h3>{name}</h3>
        <ConfirmButton
          className="link danger"
          label={words.removeAgent(name)}
          armedText={words.removeArmed}
          armedHint={words.removeAgentArmedHint}
          onConfirm={() => {
            const left = ownAgentsOf(room).filter(({ profileId }) => profileId !== agent.profileId);
            setAgents(room, left.map(({ profileId }) => profileId));
          }}
        >
          {words.remove}
        </ConfirmButton>
      </div>
      {profile && !heldToAskingInRooms(profile.harness) && (
        <p className="room-agent-unconfined-note">
          <UnconfinedLine harness={profile.harness} />
          <MeaningMark of={words.actsUnasked} text={words.actsUnaskedHint} />
        </p>
      )}
      {profile && <AgentValues room={room} agent={agent} profile={profile} roomConversations={roomConversations} />}
    </>
  );
}

/** Adds an agent of a profile not yet in the room: the button opens a box to find it by name. */
function AddAgent({ room, profiles }: { room: Room; profiles: Profile[] }) {
  const [searching, setSearching] = useState(false);
  const inRoom = ownAgentsOf(room).map(({ profileId }) => profileId);
  const add = (profileId: string) => {
    setAgents(room, [...inRoom, profileId]);
    setSearching(false);
  };
  if (searching) return <AgentSearch autoFocus profiles={profiles} chosenIds={inRoom} label={words.addAgent} onAdd={add} onLeave={() => setSearching(false)} />;
  return (
    <button type="button" className="primary" disabled={profiles.every(({ id }) => inRoom.includes(id))} onClick={() => setSearching(true)}>
      {words.addAgent}
    </button>
  );
}

/**
 * The room's agents, then what its Claude agents load of the owner's Claude Code setup and the agents members brought;
 * or the one agent opened, in their place.
 */
export function AgentsTab({
  room,
  profiles,
  people,
  roomConversations,
  openedId,
  onOpen,
}: {
  room: Room;
  profiles: Profile[];
  people: Person[];
  roomConversations: Conversation[];
  openedId: string | null;
  onOpen: (profileId: string | null) => void;
}) {
  const [leftId, setLeftId] = useState<string | null>(null);
  const ownAgents = ownAgentsOf(room);
  const opened = ownAgents.find(({ profileId }) => profileId === openedId);
  if (opened) {
    const back = () => {
      setLeftId(opened.profileId);
      onOpen(null);
    };
    return <AgentPage key={opened.profileId} room={room} agent={opened} profiles={profiles} roomConversations={roomConversations} onBack={back} />;
  }
  const someUnconfined = ownAgents.some(({ profileId }) => profiles.some(({ id, harness }) => id === profileId && !heldToAskingInRooms(harness)));
  return (
    <>
      <RoomSection title={words.agents} meaning={[words.agentsHint, ...(someUnconfined ? [words.actsUnaskedHint] : [])]} action={profiles.length > 0 && <AddAgent room={room} profiles={profiles} />}>
        {profiles.length === 0 && <p className="hint">{words.noProfiles}</p>}
        <ul className="settings-rows room-agent-rows" aria-label={words.agents}>
          {ownAgents.length === 0 && <li className="room-none">{words.noAgentsYet}</li>}
          {ownAgents.map((agent) => (
            <AgentRow
              key={agent.profileId}
              room={room}
              agent={agent}
              profiles={profiles}
              conversation={roomConversations.find(({ id }) => id === agent.conversationId)}
              takesFocus={agent.profileId === leftId}
              onOpen={() => onOpen(agent.profileId)}
            />
          ))}
        </ul>
      </RoomSection>
      <ClaudeSetupSection room={room} profiles={profiles} roomConversations={roomConversations} />
      <BroughtAgents room={room} people={people} />
    </>
  );
}

/** Whether members may bring agents from their own Miradors, and those they brought, which the owner takes out. */
function BroughtAgents({ room, people }: { room: Room; people: Person[] }) {
  const [membersBring, setMembersBring] = useSentChoice(room.membersBringAgents, (allowed) => connection.send({ type: "room.set-members-bring-agents", roomId: room.id, allowed }));
  const brought = room.agents.flatMap(({ profileId, brought }) => (brought ? [{ agentId: profileId, ...brought, bringer: personGoesBy(people.find(({ id }) => id === brought.personId), words.nameless) }] : []));
  return (
    <RoomSection title={words.broughtAgents} meaning={words.membersBringAgentsHint}>
      <ul className="settings-rows">
        <SwitchRow title={words.membersBringAgents} note={brought.length === 0 ? words.noneBroughtYet : undefined} checked={membersBring} onChange={setMembersBring} />
      </ul>
      {brought.length > 0 && (
        <ul className="settings-rows room-settings-rows" aria-label={words.broughtAgents}>
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
    </RoomSection>
  );
}
