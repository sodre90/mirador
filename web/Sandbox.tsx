import { useEffect, useState, type ReactNode } from "react";
import type { Conversation, Profile } from "../shared/model.ts";
import type { Room } from "../shared/rooms.ts";
import {
  HELD_CHANGES_MOST,
  narrowsSandbox,
  sharesKernel,
  type HeldChange,
  type HeldChangeAnswer,
  type HeldChangeText,
  type SandboxCheck,
  type SandboxFolders,
  type SandboxKind,
  type SandboxSetting,
  type SandboxSetup,
} from "../shared/sandbox.ts";
import { DiffView } from "./Chat.tsx";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { sandboxBlockerText, sandboxUnavailableText } from "./problem-text.ts";
import { SandboxFolderList } from "./SandboxFolders.tsx";
import { nameOf, roomStartsAfreshText, StartsAfreshWarning, useChangeStartingAfresh, workingThere } from "./RoomAgentSetup.tsx";

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
function useRoomSandboxCheck(room: Room, profiles: Profile[]) {
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

/** What stands in the sandbox's way, in plain words: this computer's reason alone, or else the room's or workspace's. */
const reasonsOf = ({ availability, blockers }: SandboxCheck) =>
  availability.available ? blockers.map((blocker) => sandboxBlockerText(blocker, t.problems)) : [sandboxUnavailableText(availability.why, t.problems)];

/** The kind of sandbox this computer gives, where it gives any. */
const kindOf = (check: SandboxCheck | null): SandboxKind | null => (check?.availability.available ? check.availability.kind : null);

/** Whether this computer's sandbox runs outside the SELinux confinement Linux enforces here. */
const outsideSelinux = (check: SandboxCheck | null) => check?.availability.available === true && check.availability.kind === "podman" && check.availability.selinuxEnforcing;

function SetupProgress({ setup, kind }: { setup: SandboxSetup; kind: SandboxKind }) {
  const { stage, step, problem } = setup;
  const stages = words.setup[kind];
  return (
    <div className="room-sandbox-setup" role="status">
      <span>{stage === "failed" && problem ? words.setupFailed(problem) : stage === "building-image" && step ? words.buildingStep[kind](step.at, step.of) : stages[stage]}</span>
      {stage === "building-image" && <progress value={step?.at} max={step?.of} aria-label={stages["building-image"]} />}
    </div>
  );
}

/** What a sandbox sharing this computer's kernel keeps the agents from, and what not, said before it is turned on. */
function SharedKernelWarning({ withoutSelinux, confirmation, onConfirm, onKeepOff }: { withoutSelinux: boolean; confirmation: string; onConfirm: () => void; onKeepOff?: () => void }) {
  return (
    <div className="room-sandbox-shared-kernel" role="alert">
      <p>{words.sharedKernel.warning}</p>
      {withoutSelinux && <p className="room-sandbox-without-selinux">{words.sharedKernel.withoutSelinux}</p>}
      {!onKeepOff && <p>{words.sharedKernel.turnsFailUntilAllowed}</p>}
      <button type="button" className="primary" onClick={onConfirm}>
        {confirmation}
      </button>
      {onKeepOff && (
        <button type="button" className="link" onClick={onKeepOff}>
          {words.sharedKernel.keepOff}
        </button>
      )}
    </div>
  );
}

/** What a room's or workspace's sandbox switch says of its own. */
export interface SandboxSwitchWords {
  turnOn: string;
  checking: string;
  /** The option under which the agents still ask: the room's preset, or their profile's mode. */
  stillAsks: string;
}

/**
 * A room's or workspace's sandbox switch, which this computer or the room or workspace can keep off with a reason said
 * under it, and the kind of sandbox this computer gives; once on, how the agents work inside and where setting it up on
 * this computer stands, and the folders of this computer it sees. A sandbox that shares this computer's kernel is said
 * to before it is turned on, and taken only once the owner allows it. A change that starts conversations at work
 * afresh waits for the owner to confirm it.
 */
export function SandboxSwitch({
  id,
  setting,
  check,
  setup,
  switchWords,
  startsAfresh,
  startsAfreshText,
  send,
  folders,
}: {
  id: string;
  setting: SandboxSetting;
  check: SandboxCheck | null;
  setup: SandboxSetup;
  switchWords: SandboxSwitchWords;
  /** What starts afresh on a change: the agents or conversations at work. */
  startsAfresh: string[];
  startsAfreshText: (startsAfresh: string[], stopsTurn: boolean) => string;
  send: (sandbox: SandboxSetting) => void;
  folders: ReactNode;
}) {
  const { shown, change, pending, confirm, keep } = useChangeStartingAfresh(setting, send);
  const [askingToShareKernel, setAskingToShareKernel] = useState(false);
  const choose = (sandbox: SandboxSetting) => change(sandbox, startsAfresh, narrowsSandbox(setting, sandbox));
  const reasons = check ? reasonsOf(check) : [];
  const turnsOn = check !== null && reasons.length === 0;
  const reasonsId = `${id}-sandbox-reasons`;
  const kind = kindOf(check);
  const kernelShared = kind !== null && sharesKernel(kind);
  const withoutSelinux = outsideSelinux(check);
  const turn = (on: boolean) => {
    setAskingToShareKernel(on && kernelShared);
    if (!on || !kernelShared) choose({ ...shown, on, allowsSharedKernel: false });
  };
  const turnOnSharingKernel = () => {
    setAskingToShareKernel(false);
    choose({ ...shown, on: true, allowsSharedKernel: true });
  };
  return (
    <fieldset className="room-field room-sandbox">
      <legend>{words.legend}</legend>
      <label className="room-agent-choice">
        <input
          type="checkbox"
          role="switch"
          checked={shown.on}
          disabled={pending !== null || askingToShareKernel || (!shown.on && !turnsOn)}
          aria-describedby={reasons.length > 0 ? reasonsId : undefined}
          onChange={(event) => turn(event.target.checked)}
        />
        {switchWords.turnOn}
      </label>
      {check === null && <p className="hint">{switchWords.checking}</p>}
      {kind !== null && <p className={`hint room-sandbox-kind${kernelShared ? " shares-kernel" : ""}`}>{words.kinds[kind]}</p>}
      {askingToShareKernel && <SharedKernelWarning withoutSelinux={withoutSelinux} confirmation={words.sharedKernel.turnOn} onConfirm={turnOnSharingKernel} onKeepOff={() => setAskingToShareKernel(false)} />}
      {shown.on && kernelShared && !shown.allowsSharedKernel && pending === null && (
        <SharedKernelWarning withoutSelinux={withoutSelinux} confirmation={words.sharedKernel.allow} onConfirm={() => choose({ ...shown, allowsSharedKernel: true })} />
      )}
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
              <input type="radio" name={`${id}-sandbox-work`} checked={shown.workFreely} disabled={pending !== null} onChange={() => choose({ ...shown, workFreely: true })} />
              {words.workFreely}
            </label>
            <label className="room-agent-choice">
              <input type="radio" name={`${id}-sandbox-work`} checked={!shown.workFreely} disabled={pending !== null} onChange={() => choose({ ...shown, workFreely: false })} />
              {switchWords.stillAsks}
            </label>
          </div>
          {kind !== null && <SetupProgress setup={setup} kind={kind} />}
          {folders}
        </>
      )}
      {pending && <StartsAfreshWarning text={startsAfreshText(startsAfresh, pending.narrows)} onConfirm={confirm} onKeep={keep} />}
    </fieldset>
  );
}

const roomSwitchWords: SandboxSwitchWords = { turnOn: words.turnOn, checking: words.checking, stillAsks: words.presetApplies };

/** The room's sandbox switch; changing it starts the room's agents at work afresh. */
export function SandboxField({
  room,
  profiles,
  roomConversations,
  setup,
  folders,
  homeDir,
}: {
  room: Room;
  profiles: Profile[];
  roomConversations: Conversation[];
  setup: SandboxSetup;
  folders: SandboxFolders;
  homeDir: string;
}) {
  const check = useRoomSandboxCheck(room, profiles);
  const startsAfresh = room.agents.filter((agent) => !agent.brought && workingThere(agent, roomConversations)).map(({ profileId }) => nameOf(profiles, profileId));
  return (
    <SandboxSwitch
      id={`room-${room.id}`}
      setting={room.sandbox}
      check={check}
      setup={setup}
      switchWords={roomSwitchWords}
      startsAfresh={startsAfresh}
      startsAfreshText={roomStartsAfreshText}
      send={(sandbox) => connection.send({ type: "room.set-sandbox", roomId: room.id, sandbox })}
      folders={<SandboxFolderList folders={folders} homeDir={homeDir} />}
    />
  );
}

/** The long story of the room's sandbox, under "What does this mean?". */
export function SandboxMeaning() {
  return words.meaning.map((paragraph) => <p key={paragraph}>{paragraph}</p>);
}

const heldTitles = { add: heldWords.wantsToAdd, change: heldWords.wantsToChange, delete: heldWords.wantsToDelete } satisfies Record<HeldChange["kind"], unknown>;

const answerHeld = ({ owner, id }: HeldChange, answer: HeldChangeAnswer) => connection.send({ type: "sandbox.answer-held-change", owner, changeId: id, answer });

const UNSHOWN: HeldChangeText = { unshown: true };

/** A held change's text, asked for as the change is shown: null until it comes. */
function useHeldText({ owner, id, at, unshown }: HeldChange) {
  const [text, setText] = useState<HeldChangeText | null>(null);
  const { kind, id: ownerId } = owner;
  useEffect(() => {
    let wanted = true;
    setText(unshown ? UNSHOWN : null);
    if (!unshown)
      connection
        .sendAndAwait(
          (requestId) => ({ type: "sandbox.held-change-text", requestId, owner: { kind, id: ownerId }, changeId: id }),
          (message, requestId): HeldChangeText | undefined => (message.type === "sandbox.held-change-text" && message.requestId === requestId ? (message.text ?? UNSHOWN) : undefined),
        )
        .then(
          (got) => wanted && setText(got),
          () => {},
        );
    return () => {
      wanted = false;
    };
  }, [kind, ownerId, id, at, unshown]);
  return text;
}

function HeldText({ change }: { change: HeldChange }) {
  const text = useHeldText(change);
  if (text === null) return <p className="hint">{heldWords.loading}</p>;
  if ("unshown" in text) return <p className="room-held-unshown">{heldWords.unshown}</p>;
  return <DiffView path={change.path} oldText={text.before} newText={text.after ?? ""} />;
}

/**
 * The oldest agent config file change of a sandbox, put back as it was and held for the owner: which agents may have
 * made it, what it would write, and Allow or Discard; and, where the sandbox holds as many as it may, that its VM
 * stopped until some are answered. Where none of its agents was at work, `unknownAgent` says who may have made it.
 */
export function HeldChangeCard({
  changes,
  holdsTooMany,
  agentName,
  countOf,
  unknownAgent,
}: {
  changes: HeldChange[];
  holdsTooMany: boolean;
  agentName: (profileId: string) => string;
  countOf: (count: number) => string;
  unknownAgent?: string;
}) {
  const first = changes[0];
  if (!first) return null;
  const agents = first.agents.length === 0 && unknownAgent ? [unknownAgent] : first.agents.map(agentName);
  return (
    <section className="room-held" aria-label={heldWords.label} data-held-path={first.path}>
      <div className="room-held-head">
        <span className="room-held-title">{heldTitles[first.kind](agents, first.path)}</span>
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
