import { useMemo, useState } from "react";
import type { Conversation, HarnessId, Profile } from "../shared/model.ts";
import {
  ALL_OF_CLAUDE_SETUP,
  CLAUDE_SETUP_PARTS,
  heldToAskingInRooms,
  narrows,
  narrowsClaudeSetup,
  profileVariablesInRoom,
  type ClaudeSetup,
  type VariablesChosen,
} from "../shared/room-agent-setup.ts";
import type { Room, RoomAgent } from "../shared/rooms.ts";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { useSentChoice } from "./sent-choice.ts";

const words = t.rooms;

const CLEAN_CLAUDE_SETUP = Object.fromEntries(CLAUDE_SETUP_PARTS.map((part) => [part, false])) as unknown as ClaudeSetup;

const isClean = (setup: ClaudeSetup) => CLAUDE_SETUP_PARTS.every((part) => !setup[part]);

const workingThere = (agent: RoomAgent, roomConversations: Conversation[]) => roomConversations.some(({ id, acpSessionId }) => id === agent.conversationId && acpSessionId !== null);

const choiceChanged = (before: VariablesChosen, after: VariablesChosen) => Object.entries(after).find(([name, given]) => !Object.hasOwn(before, name) || before[name] !== given);

const nameOf = (profiles: Profile[], profileId: string) => profiles.find(({ id }) => id === profileId)?.name ?? words.agentGone;

/** A marker on an agent chip whose room sessions the host can't hold to asking; the details wait under "What does this mean?". */
export function UnconfinedMark({ harness }: { harness: HarnessId }) {
  if (heldToAskingInRooms(harness)) return null;
  return (
    <span className="room-agent-unconfined" role="img" aria-label={words.actsUnasked} data-hint={words.actsUnasked}>
      ⚠
    </span>
  );
}

/** The same warning as a line of its own under the agent in the room's settings. */
export function UnconfinedLine({ harness }: { harness: HarnessId }) {
  if (heldToAskingInRooms(harness)) return null;
  return (
    <span className="room-agent-unconfined-line">
      <span aria-hidden="true">⚠</span> {words.actsUnasked}
    </span>
  );
}

/**
 * A change that starts agents at work in the room afresh waits for the owner to confirm it, told what it costs, and
 * whether it stops their turns under way because it leaves them with less; one that costs nothing is sent at once.
 */
function useChangeStartingAfresh<T>(kept: T, send: (value: T) => void) {
  const [shown, choose] = useSentChoice(kept, send);
  const [pending, setPending] = useState<{ value: T; narrows: boolean } | null>(null);
  return {
    shown: pending ? pending.value : shown,
    change: (value: T, startsAfresh: string[], narrows: boolean) => (startsAfresh.length > 0 ? setPending({ value, narrows }) : choose(value)),
    pending,
    confirm: () => {
      if (pending) choose(pending.value);
      setPending(null);
    },
    keep: () => setPending(null),
  };
}

function StartsAfreshWarning({ agents, stopsTurn, onConfirm, onKeep }: { agents: string[]; stopsTurn: boolean; onConfirm: () => void; onKeep: () => void }) {
  return (
    <div className="room-starts-afresh" role="alert">
      <span>{stopsTurn ? words.stopsAndStartsAfresh(agents) : words.startsAfresh(agents)}</span>
      <button type="button" className="primary" onClick={onConfirm}>
        {words.applyChange}
      </button>
      <button type="button" className="link" onClick={onKeep}>
        {words.cancel}
      </button>
    </div>
  );
}

/**
 * What the agent gets of its environment in the room: which of its profile's values, by name alone as the owner never
 * sees a value here, and whether everything from this computer's environment besides.
 */
export function AgentValues({ room, agent, profile, roomConversations }: { room: Room; agent: RoomAgent; profile: Profile; roomConversations: Conversation[] }) {
  const kept = useMemo(() => ({ variables: agent.variables, wholeHostEnvironment: agent.wholeHostEnvironment }), [agent.variables, agent.wholeHostEnvironment]);
  const send = ({ variables, wholeHostEnvironment }: typeof kept) => {
    const changed = choiceChanged(agent.variables, variables);
    if (changed) connection.send({ type: "room.set-agent-variable", roomId: room.id, profileId: profile.id, name: changed[0], given: changed[1] });
    if (wholeHostEnvironment !== agent.wholeHostEnvironment) connection.send({ type: "room.set-agent-host-environment", roomId: room.id, profileId: profile.id, given: wholeHostEnvironment });
  };
  const { shown, change, pending, confirm, keep } = useChangeStartingAfresh(kept, send);
  const variables = profileVariablesInRoom(profile.harness, profile.environment, shown.variables);
  const startsAfresh = workingThere(agent, roomConversations) ? [profile.name] : [];
  const chooseVariable = (name: string, given: boolean) =>
    change({ ...kept, variables: { ...agent.variables, [name]: given } }, startsAfresh, narrows(variables.find((variable) => variable.name === name)?.given ?? false, given));
  const chooseWholeHostEnvironment = (given: boolean) => change({ ...kept, wholeHostEnvironment: given }, startsAfresh, narrows(agent.wholeHostEnvironment, given));
  return (
    <details className="room-agent-values">
      <summary>{words.environmentGiven(variables.filter(({ given }) => given).length, variables.length, shown.wholeHostEnvironment)}</summary>
      {variables.length > 0 && (
        <ul aria-label={words.valuesOf(profile.name)}>
          {variables.map(({ name, given, fixed }) => (
            <li key={name}>
              <label className="room-agent-choice" data-hint={fixed ? words.alwaysGiven : undefined}>
                <input type="checkbox" role="switch" checked={given} disabled={fixed || pending !== null} onChange={(event) => chooseVariable(name, event.target.checked)} />
                <code>{name}</code>
              </label>
            </li>
          ))}
        </ul>
      )}
      <label className="room-agent-choice room-agent-host-environment">
        <input type="checkbox" role="switch" checked={shown.wholeHostEnvironment} disabled={pending !== null} onChange={(event) => chooseWholeHostEnvironment(event.target.checked)} />
        {words.wholeHostEnvironment}
      </label>
      {pending && <StartsAfreshWarning agents={startsAfresh} stopsTurn={pending.narrows} onConfirm={confirm} onKeep={keep} />}
      <p className="hint room-values-warning">{words.wholeHostEnvironmentHint}</p>
      <p className="hint room-values-warning">{words.valuesReadable}</p>
    </details>
  );
}

/** What the room's Claude Code agents load of the owner's own Claude Code setup: all of it, none of it, or the parts chosen. */
export function ClaudeSetupField({ room, profiles, roomConversations }: { room: Room; profiles: Profile[]; roomConversations: Conversation[] }) {
  const { shown, change, pending, confirm, keep } = useChangeStartingAfresh(room.claudeSetup, (setup) => connection.send({ type: "room.set-claude-setup", roomId: room.id, setup }));
  const claudeAgents = room.agents.filter(({ profileId }) => profiles.find(({ id }) => id === profileId)?.harness === "claude");
  if (claudeAgents.length === 0) return null;
  const startsAfresh = claudeAgents.filter((agent) => workingThere(agent, roomConversations)).map(({ profileId }) => nameOf(profiles, profileId));
  const choose = (setup: ClaudeSetup) => change(setup, startsAfresh, narrowsClaudeSetup(room.claudeSetup, setup));
  return (
    <fieldset className="room-field room-claude-setup">
      <legend>{words.claudeSetup}</legend>
      <label className="room-agent-choice">
        <input type="checkbox" role="switch" checked={isClean(shown)} disabled={pending !== null} onChange={(event) => choose(event.target.checked ? CLEAN_CLAUDE_SETUP : ALL_OF_CLAUDE_SETUP)} />
        {words.startClean}
      </label>
      {!isClean(shown) && (
        <div className="room-claude-setup-parts">
          {CLAUDE_SETUP_PARTS.map((part) => (
            <label key={part} className="room-agent-choice">
              <input type="checkbox" checked={shown[part]} disabled={pending !== null} onChange={(event) => choose({ ...shown, [part]: event.target.checked })} />
              {words.claudeSetupParts[part]}
            </label>
          ))}
        </div>
      )}
      {pending && <StartsAfreshWarning agents={startsAfresh} stopsTurn={pending.narrows} onConfirm={confirm} onKeep={keep} />}
    </fieldset>
  );
}

/** The long story of what the room's agents are given, for the agent kinds the room has. */
export function AgentSetupMeaning({ room, profiles }: { room: Room; profiles: Profile[] }) {
  const harnesses = room.agents.flatMap(({ profileId }) => profiles.find(({ id }) => id === profileId)?.harness ?? []);
  return (
    <>
      <p>{words.valuesHint}</p>
      {harnesses.some((harness) => !heldToAskingInRooms(harness)) && <p>{words.actsUnaskedHint}</p>}
      {harnesses.includes("claude") && <p>{words.claudeSetupHint}</p>}
    </>
  );
}
