import { useEffect, useState } from "react";
import type { Conversation, Profile } from "../shared/model.ts";
import type { Room } from "../shared/rooms.ts";
import { HELD_CHANGES_MOST, narrowsSandbox, type HeldChange, type HeldChangeAnswer, type HeldChangeText, type RoomSandbox, type SandboxCheck, type SandboxSetup } from "../shared/sandbox.ts";
import { DiffView } from "./Chat.tsx";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { sandboxBlockerText, sandboxUnavailableText } from "./problem-text.ts";
import { nameOf, StartsAfreshWarning, useChangeStartingAfresh, workingThere } from "./RoomAgentSetup.tsx";

const words = t.rooms.sandbox;
const heldWords = t.rooms.held;

/** What the host's check of the room hangs on: its workspace, and its agents with what each is given. */
function checkedAgainst(room: Room, profiles: Profile[]) {
  const agents = room.agents.map(({ profileId, brought, variables, wholeHostEnvironment }) => {
    const profile = profiles.find(({ id }) => id === profileId);
    return [profileId, Boolean(brought), variables, wholeHostEnvironment, profile?.harness, profile?.environment];
  });
  return JSON.stringify([room.workspaceId, agents]);
}

/** Whether this computer and the room can have a sandbox, asked again whenever the room's workspace or agents change. */
function useSandboxCheck(room: Room, profiles: Profile[]) {
  const [check, setCheck] = useState<SandboxCheck | null>(null);
  const against = checkedAgainst(room, profiles);
  useEffect(() => {
    let wanted = true;
    connection
      .sendAndAwait(
        (requestId) => ({ type: "room.check-sandbox", requestId, roomId: room.id }),
        (message, requestId) => (message.type === "room.sandbox-checked" && message.requestId === requestId ? { availability: message.availability, blockers: message.blockers } : undefined),
      )
      .then(
        (got) => wanted && setCheck(got),
        () => {},
      );
    return () => {
      wanted = false;
    };
  }, [room.id, against]);
  return check;
}

/** What stands in the sandbox's way, in plain words: this computer's reason alone, or else the room's. */
const reasonsOf = ({ availability, blockers }: SandboxCheck) =>
  availability.available ? blockers.map((blocker) => sandboxBlockerText(blocker, t.problems)) : [sandboxUnavailableText(availability.why, t.problems)];

function SetupProgress({ setup }: { setup: SandboxSetup }) {
  const { stage, step, problem } = setup;
  return (
    <div className="room-sandbox-setup" role="status">
      <span>{stage === "failed" && problem ? words.setupFailed(problem) : stage === "building-image" && step ? words.buildingStep(step.at, step.of) : words.setup[stage]}</span>
      {stage === "building-image" && <progress value={step?.at} max={step?.of} aria-label={words.setup["building-image"]} />}
    </div>
  );
}

/**
 * The room's sandbox switch, which this computer or the room can keep off with a reason said under it; once on, how the
 * agents work inside and where setting it up on this computer stands. Changing it starts the agents at work afresh.
 */
export function SandboxField({ room, profiles, roomConversations, setup }: { room: Room; profiles: Profile[]; roomConversations: Conversation[]; setup: SandboxSetup }) {
  const check = useSandboxCheck(room, profiles);
  const { shown, change, pending, confirm, keep } = useChangeStartingAfresh(room.sandbox, (sandbox) => connection.send({ type: "room.set-sandbox", roomId: room.id, sandbox }));
  const startsAfresh = room.agents.filter((agent) => !agent.brought && workingThere(agent, roomConversations)).map(({ profileId }) => nameOf(profiles, profileId));
  const choose = (sandbox: RoomSandbox) => change(sandbox, startsAfresh, narrowsSandbox(room.sandbox, sandbox));
  const reasons = check ? reasonsOf(check) : [];
  const turnsOn = check !== null && reasons.length === 0;
  const reasonsId = `room-sandbox-reasons-${room.id}`;
  return (
    <fieldset className="room-field room-sandbox">
      <legend>{words.legend}</legend>
      <label className="room-agent-choice">
        <input
          type="checkbox"
          role="switch"
          checked={shown.on}
          disabled={pending !== null || (!shown.on && !turnsOn)}
          aria-describedby={reasons.length > 0 ? reasonsId : undefined}
          onChange={(event) => choose({ ...shown, on: event.target.checked })}
        />
        {words.turnOn}
      </label>
      {check === null && <p className="hint">{words.checking}</p>}
      {reasons.length > 0 && (
        <div className="room-sandbox-reasons" id={reasonsId}>
          {shown.on && <p>{words.turnsFailUntil}</p>}
          <ul>
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {shown.on && (
        <>
          <p className="hint">{words.network}</p>
          <div className="room-sandbox-work">
            <label className="room-agent-choice">
              <input type="radio" name="room-sandbox-work" checked={shown.workFreely} disabled={pending !== null} onChange={() => choose({ ...shown, workFreely: true })} />
              {words.workFreely}
            </label>
            <label className="room-agent-choice">
              <input type="radio" name="room-sandbox-work" checked={!shown.workFreely} disabled={pending !== null} onChange={() => choose({ ...shown, workFreely: false })} />
              {words.presetApplies}
            </label>
          </div>
          <SetupProgress setup={setup} />
        </>
      )}
      {pending && <StartsAfreshWarning agents={startsAfresh} stopsTurn={pending.narrows} onConfirm={confirm} onKeep={keep} />}
    </fieldset>
  );
}

/** The long story of the sandbox, under "What does this mean?". */
export function SandboxMeaning() {
  return words.meaning.map((paragraph) => <p key={paragraph}>{paragraph}</p>);
}

const heldTitles = { add: heldWords.wantsToAdd, change: heldWords.wantsToChange, delete: heldWords.wantsToDelete } satisfies Record<HeldChange["kind"], unknown>;

const answerHeld = ({ roomId, id }: HeldChange, answer: HeldChangeAnswer) => connection.send({ type: "room.answer-held-change", roomId, changeId: id, answer });

const UNSHOWN: HeldChangeText = { unshown: true };

/** A held change's text, asked for as the change is shown: null until it comes. */
function useHeldText({ roomId, id, at, unshown }: HeldChange) {
  const [text, setText] = useState<HeldChangeText | null>(null);
  useEffect(() => {
    let wanted = true;
    setText(unshown ? UNSHOWN : null);
    if (!unshown)
      connection
        .sendAndAwait(
          (requestId) => ({ type: "room.held-change-text", requestId, roomId, changeId: id }),
          (message, requestId): HeldChangeText | undefined => (message.type === "room.held-change-text" && message.requestId === requestId ? (message.text ?? UNSHOWN) : undefined),
        )
        .then(
          (got) => wanted && setText(got),
          () => {},
        );
    return () => {
      wanted = false;
    };
  }, [roomId, id, at, unshown]);
  return text;
}

function HeldText({ change }: { change: HeldChange }) {
  const text = useHeldText(change);
  if (text === null) return <p className="hint">{heldWords.loading}</p>;
  if ("unshown" in text) return <p className="room-held-unshown">{heldWords.unshown}</p>;
  return <DiffView path={change.path} oldText={text.before} newText={text.after ?? ""} />;
}

/**
 * The oldest agent config file change of a sandboxed room, put back as it was and held for the owner: which agents may
 * have made it, what it would write, and Allow or Discard; and, where the room holds as many as it may, that its VM
 * stopped until some are answered.
 */
export function HeldChangeCard({ changes, holdsTooMany, agentName, countOf }: { changes: HeldChange[]; holdsTooMany: boolean; agentName: (profileId: string) => string; countOf: (count: number) => string }) {
  const first = changes[0];
  if (!first) return null;
  return (
    <section className="room-held" aria-label={heldWords.label} data-held-path={first.path}>
      <div className="room-held-head">
        <span className="room-held-title">{heldTitles[first.kind](first.agents.map(agentName), first.path)}</span>
        {changes.length > 1 && <span className="room-approval-count">{countOf(changes.length)}</span>}
      </div>
      {holdsTooMany && (
        <p className="room-held-too-many" role="status">
          {heldWords.tooMany(HELD_CHANGES_MOST)}
        </p>
      )}
      <HeldText key={first.id} change={first} />
      <p className="room-held-kept">{heldWords.keptAsItWas}</p>
      <div className="permission-options">
        <button type="button" className="option-allow_once" onClick={() => answerHeld(first, "allow")}>
          {heldWords.allow}
        </button>
        <button type="button" onClick={() => answerHeld(first, "discard")}>
          {heldWords.discard}
        </button>
      </div>
    </section>
  );
}
