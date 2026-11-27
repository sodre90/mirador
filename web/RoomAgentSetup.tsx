import { useMemo, useState } from "react";
import type { Conversation, HarnessId, Profile } from "../shared/model.ts";
import {
  ALL_OF_CLAUDE_SETUP,
  CLAUDE_SETUP_CHOICES,
  CLAUDE_SETUP_PARTS,
  claudeSetupChoiceOf,
  heldToAskingInRooms,
  narrows,
  narrowsClaudeSetup,
  NONE_OF_CLAUDE_SETUP,
  profileVariablesInRoom,
  type ClaudeSetup,
  type ClaudeSetupChoice,
  type ClaudeSetupPart,
  type ProfileVariable,
  type VariablesChosen,
} from "../shared/room-agent-setup.ts";
import type { Room, RoomAgent } from "../shared/rooms.ts";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { ControlRow, RoomSection, SwitchRow } from "./RoomSection.tsx";
import { useSentChoice } from "./sent-choice.ts";

const words = t.rooms;

export const workingThere = (agent: RoomAgent, roomConversations: Conversation[]) =>
  agent.answering !== null || roomConversations.some(({ id, acpSessionId, status }) => id === agent.conversationId && (acpSessionId !== null || status === "running"));

const choiceChanged = (before: VariablesChosen, after: VariablesChosen) => Object.entries(after).find(([name, given]) => !Object.hasOwn(before, name) || before[name] !== given);

export const nameOf = (profiles: Profile[], profileId: string) => profiles.find(({ id }) => id === profileId)?.name ?? words.agentGone;

/** A marker on an agent chip whose room sessions the host can't hold to asking. */
export function UnconfinedMark({ harness }: { harness: HarnessId }) {
  if (heldToAskingInRooms(harness)) return null;
  return (
    <span className="room-agent-unconfined" role="img" aria-label={words.actsUnasked} data-hint={words.actsUnasked}>
      ⚠
    </span>
  );
}

/** The same warning in words, under the agent in the room's settings. */
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
export function useChangeStartingAfresh<T>(kept: T, send: (value: T) => void) {
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

/** What a change costs the room's agents at work: they start afresh, and, where it leaves them with less, stop their turns. */
export const roomStartsAfreshText = (agents: string[], stopsTurn: boolean) => (stopsTurn ? words.stopsAndStartsAfresh(agents) : words.startsAfresh(agents));

export function StartsAfreshWarning({ text, onConfirm, onKeep }: { text: string; onConfirm: () => void; onKeep: () => void }) {
  return (
    <div className="room-starts-afresh" role="alert">
      <span>{text}</span>
      <button type="button" className="primary" onClick={onConfirm}>
        {words.applyChange}
      </button>
      <button type="button" className="link" onClick={onKeep}>
        {words.cancel}
      </button>
    </div>
  );
}

/** How much an agent gets of its environment in the room, in a few words. */
export function environmentInWords({ variables: chosen, wholeHostEnvironment }: RoomAgent, { harness, environment }: Profile) {
  const variables = profileVariablesInRoom(harness, environment, chosen);
  const values = variables.length === 0 ? words.profileSetsNoValues : words.profileValuesGiven(variables.filter(({ given }) => given).length, variables.length);
  return wholeHostEnvironment ? `${values} · ${words.wholeHostEnvironment}` : values;
}

function ValueList({ label, variables, disabled, onChange }: { label: string; variables: ProfileVariable[]; disabled: boolean; onChange: (name: string, given: boolean) => void }) {
  return (
    <ul aria-label={label}>
      {variables.map(({ name, given, fixed }) => (
        <li key={name}>
          <label className="room-agent-choice" data-hint={fixed ? words.alwaysGiven : undefined}>
            <input type="checkbox" role="switch" checked={given} disabled={fixed || disabled} onChange={(event) => onChange(name, event.target.checked)} />
            <code>{name}</code>
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the agent gets of its environment in the room: which of its profile's values, by name alone as the owner never
 * sees a value here, and whether everything from this computer's environment besides. The values held back as this
 * opens come first, and a value changed stays where it is, so it can be changed back.
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
  const [heldBackAtFirst] = useState(() => new Set(variables.filter(({ given }) => !given).map(({ name }) => name)));
  const listedHeldBack = variables.filter(({ name }) => heldBackAtFirst.has(name));
  const listedGiven = variables.filter(({ name }) => !heldBackAtFirst.has(name));
  const givenCount = variables.filter(({ given }) => given).length;
  const startsAfresh = workingThere(agent, roomConversations) ? [profile.name] : [];
  const chooseVariable = (name: string, given: boolean) =>
    change({ ...kept, variables: { ...agent.variables, [name]: given } }, startsAfresh, narrows(variables.find((variable) => variable.name === name)?.given ?? false, given));
  const chooseWholeHostEnvironment = (given: boolean) => change({ ...kept, wholeHostEnvironment: given }, startsAfresh, narrows(agent.wholeHostEnvironment, given));
  return (
    <>
      <RoomSection title={words.profileValues} meaning={[words.valuesReadable, words.valuesHint]}>
        {variables.length === 0 && <p className="hint">{words.profileSetsNoValues}</p>}
        {variables.length > 0 && (
          <div className="room-agent-values">
            {listedHeldBack.length > 0 && (
              <div className="room-values-held-back">
                <span className="hint">{words.valuesHeldBack(variables.length - givenCount)}</span>
                <ValueList label={words.valuesHeldBackFrom(profile.name)} variables={listedHeldBack} disabled={pending !== null} onChange={chooseVariable} />
              </div>
            )}
            {listedGiven.length > 0 && (
              <details className="room-values-given">
                <summary>{words.valuesGiven(givenCount)}</summary>
                <ValueList label={words.valuesOf(profile.name)} variables={listedGiven} disabled={pending !== null} onChange={chooseVariable} />
              </details>
            )}
          </div>
        )}
      </RoomSection>
      <ul className="settings-rows">
        <SwitchRow
          title={words.wholeHostEnvironment}
          note={room.sandbox.on ? words.sandbox.wholeEnvironmentIgnored : words.wholeHostEnvironmentNote}
          hint={words.wholeHostEnvironmentHint}
          checked={shown.wholeHostEnvironment}
          disabled={pending !== null}
          onChange={chooseWholeHostEnvironment}
        />
      </ul>
      {pending && <StartsAfreshWarning text={roomStartsAfreshText(startsAfresh, pending.narrows)} onConfirm={confirm} onKeep={keep} />}
    </>
  );
}

/** What the room's Claude Code agents load of the owner's own Claude Code setup: all of it, none of it, or the parts chosen. */
export function ClaudeSetupSection({ room, profiles, roomConversations }: { room: Room; profiles: Profile[]; roomConversations: Conversation[] }) {
  const { shown, change, pending, confirm, keep } = useChangeStartingAfresh(room.claudeSetup, (setup) => connection.send({ type: "room.set-claude-setup", roomId: room.id, setup }));
  const [choosingParts, setChoosingParts] = useState(false);
  const claudeAgents = room.agents.filter(({ profileId }) => profiles.find(({ id }) => id === profileId)?.harness === "claude");
  if (claudeAgents.length === 0) return null;
  const startsAfresh = claudeAgents.filter((agent) => workingThere(agent, roomConversations)).map(({ profileId }) => nameOf(profiles, profileId));
  const load = (setup: ClaudeSetup) => change(setup, startsAfresh, narrowsClaudeSetup(room.claudeSetup, setup));
  const choice = choosingParts ? "parts" : claudeSetupChoiceOf(shown);
  const choose = (chosen: ClaudeSetupChoice) => {
    setChoosingParts(chosen === "parts");
    if (chosen !== "parts" && chosen !== claudeSetupChoiceOf(shown)) load(chosen === "all" ? ALL_OF_CLAUDE_SETUP : NONE_OF_CLAUDE_SETUP);
  };
  const choosePart = (part: ClaudeSetupPart, loaded: boolean) => {
    setChoosingParts(true);
    load({ ...shown, [part]: loaded });
  };
  return (
    <RoomSection title={words.claudeSetup} meaning={words.claudeSetupHint}>
      <ul className="settings-rows">
        <ControlRow
          title={words.claudeAgentsLoad}
          note={choice === "parts" ? undefined : words.claudeSetupNotes[choice]}
          control={(id) => (
            <select id={id} value={choice} disabled={pending !== null} onChange={(event) => choose(event.target.value as ClaudeSetupChoice)}>
              {CLAUDE_SETUP_CHOICES.map((each) => (
                <option key={each} value={each}>
                  {words.claudeSetupChoices[each]}
                </option>
              ))}
            </select>
          )}
        />
        {choice === "parts" && (
          <li className="room-claude-setup-parts" role="group" aria-label={words.claudeSetup}>
            {CLAUDE_SETUP_PARTS.map((part) => (
              <label key={part} className="room-agent-choice">
                <input type="checkbox" checked={shown[part]} disabled={pending !== null} onChange={(event) => choosePart(part, event.target.checked)} />
                {words.claudeSetupParts[part]}
              </label>
            ))}
          </li>
        )}
      </ul>
      {pending && <StartsAfreshWarning text={roomStartsAfreshText(startsAfresh, pending.narrows)} onConfirm={confirm} onKeep={keep} />}
    </RoomSection>
  );
}
