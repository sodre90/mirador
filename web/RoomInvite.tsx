import { useState, type FormEvent } from "react";
import { inviteConnectFor, machineAddress, ROOM_INVITE_CONNECTS, type RoomInviteConnect } from "../shared/machines.ts";
import type { Machine, Person } from "../shared/model.ts";
import { personGoesBy } from "../shared/people.ts";
import type { PeerToPeerStatus } from "../shared/protocol.ts";
import { relativeTimeOf } from "../shared/relative-time.ts";
import {
  DEFAULT_ROOM_INVITE_LIFETIME,
  defaultLetsIn,
  ROOM_INVITE_LETS_IN,
  ROOM_INVITE_LIFETIMES,
  ROOM_INVITE_SEATS,
  ROOM_ROLES,
  type Room,
  type RoomInvite,
  type RoomInviteLetsIn,
  type RoomInviteLifetime,
  type RoomInviteSeats,
  type RoomJoiner,
  type RoomRole,
} from "../shared/rooms.ts";
import { tunnelOrigin } from "../shared/tunnel.ts";
import { connection } from "./connection.ts";
import { CopyButton } from "./CopyButton.tsx";
import { replyProblemText } from "./host-error.ts";
import { locale, t } from "./i18n/index.ts";
import { useExpired } from "./invite-expiry.ts";
import { NameToJoinWith, useNameToJoinWith, type JoiningPerson } from "./name-to-join.tsx";
import { Modal } from "./Palette.tsx";
import { WaitingToJoin } from "./RoomSettings.tsx";
import type { DevicesListed } from "./state.ts";
import { NAME_FIELD_ATTRIBUTES } from "./typing-aids.ts";

const words = t.rooms;

/** Peer to peer that can't reach its server, or couldn't be downloaded, makes no invite until it works again. */
const peerToPeerWorks = (status: PeerToPeerStatus | null) => status !== null && status !== "broker-unreachable" && status !== "sidecar-unavailable";

/** Why peer to peer can't connect an invite now, in one line; null while it can. */
function whyNoPeerToPeer(status: PeerToPeerStatus | null) {
  if (status === null) return words.peerToPeerOff;
  if (status === "broker-unreachable") return t.devices.invite.peerToPeerUnreachable;
  if (status === "sidecar-unavailable") return t.devices.invite.peerToPeerUnavailable;
  return null;
}

/** Each adds one ability to the one before it. */
const ROLES_BY_ABILITY = [...ROOM_ROLES].reverse();

interface InviteChoices {
  role: RoomRole;
  seats: RoomInviteSeats;
  /** Null until picked, and then as suits how many people come. */
  letsIn: RoomInviteLetsIn | null;
  lifetime: RoomInviteLifetime;
  /** Null until picked, and then the way Settings name where it works, else the other. */
  connect: RoomInviteConnect | null;
}

const FIRST_CHOICES: InviteChoices = { role: "member", seats: 1, letsIn: null, lifetime: DEFAULT_ROOM_INVITE_LIFETIME, connect: null };

interface MadeInvite {
  invite: RoomInvite;
  text: string;
  copied: boolean;
  /** What it was made with, which changing it and then thinking better of that goes back to. */
  choices: InviteChoices;
  /** Those in the room or at its door before it was made, so that whoever comes after stands out. */
  alreadyThere: Set<string>;
}

interface WaysToConnect {
  works: Record<RoomInviteConnect, boolean>;
  preferred: RoomInviteConnect;
  addressHost: string;
  noPeerToPeer: string | null;
}

function waysToConnect({ reachability, peerToPeer, roomInvitesConnect }: DevicesListed): WaysToConnect {
  const publicOrigin = reachability.publicAddress?.origin ?? null;
  return {
    works: { "peer-to-peer": peerToPeerWorks(peerToPeer), address: publicOrigin !== null },
    preferred: roomInvitesConnect,
    addressHost: publicOrigin ? new URL(publicOrigin).host : "",
    noPeerToPeer: whyNoPeerToPeer(peerToPeer),
  };
}

const connectBy = (picked: RoomInviteConnect | null, { works, preferred }: WaysToConnect) => (picked && works[picked] ? picked : inviteConnectFor(preferred, works));

/** Whether it got there; a page that isn't a secure context has no clipboard at all. */
async function putOnClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const withdraw = ({ id }: RoomInvite) => connection.send({ type: "room.withdraw-invite", inviteId: id });

function RolePicker({ role, onChange }: { role: RoomRole; onChange: (role: RoomRole) => void }) {
  const lastGranted = ROLES_BY_ABILITY.indexOf(role);
  return (
    <fieldset className="room-field">
      <legend>{words.joinsAs}</legend>
      <div className="room-invite-roles">
        {ROLES_BY_ABILITY.map((each) => (
          <label key={each} data-chosen={role === each}>
            <input type="radio" name="room-invite-role" autoFocus={role === each} checked={role === each} onChange={() => onChange(each)} />
            {words.roles[each]}
          </label>
        ))}
      </div>
      <ul className="room-invite-abilities">
        {ROLES_BY_ABILITY.map((each, index) => (
          <li key={each} aria-hidden={index > lastGranted}>
            {words.roleAdds[each]}
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function ChoiceRow<Choice extends string | number>({
  label,
  chosen,
  among,
  labelOf,
  onChoose,
}: {
  label: string;
  chosen: Choice;
  among: readonly Choice[];
  labelOf: (choice: Choice) => string;
  onChoose: (choice: Choice) => void;
}) {
  return (
    <label className="room-invite-row">
      <span>{label}</span>
      <select value={chosen} onChange={({ target }) => onChoose(among.find((each) => String(each) === target.value)!)}>
        {among.map((each) => (
          <option key={each} value={each}>
            {labelOf(each)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Shown only where there is something to choose or to know: both ways work, neither does, or not the one Settings name. */
function ConnectRow({ ways, connect, onChoose }: { ways: WaysToConnect; connect: RoomInviteConnect | null; onChoose: (connect: RoomInviteConnect) => void }) {
  const { works, preferred, addressHost, noPeerToPeer } = ways;
  if (!connect)
    return (
      <p className="warning" role="alert">
        {noPeerToPeer} {words.noWayToConnect}
      </p>
    );
  if (ROOM_INVITE_CONNECTS.every((each) => works[each])) {
    const labels: Record<RoomInviteConnect, string> = { "peer-to-peer": words.connectChoices["peer-to-peer"], address: words.connectChoices.address(addressHost) };
    return <ChoiceRow label={words.connect} chosen={connect} among={ROOM_INVITE_CONNECTS} labelOf={(each) => labels[each]} onChoose={onChoose} />;
  }
  if (connect !== preferred && noPeerToPeer)
    return (
      <p className="hint room-invite-connect-instead">
        {noPeerToPeer} {words.connectsAtAddress(addressHost)}
      </p>
    );
  return null;
}

/** The role, how many come and how, for how long, and the one way it connects; once copied, the invite takes the form's place. */
function InviteForm({
  choices,
  ways,
  replaces,
  withdrawn,
  making,
  problem,
  onChange,
  onCopy,
  onCancel,
}: {
  choices: InviteChoices;
  ways: WaysToConnect | null;
  replaces: boolean;
  withdrawn: boolean;
  making: boolean;
  problem: string | null;
  onChange: (choices: InviteChoices) => void;
  onCopy: () => void;
  onCancel: () => void;
}) {
  const change = (changed: Partial<InviteChoices>) => onChange({ ...choices, ...changed });
  const connect = ways && connectBy(choices.connect, ways);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onCopy();
  };
  return (
    <form onSubmit={submit}>
      <RolePicker role={choices.role} onChange={(role) => change({ role })} />
      <div className="room-invite-rows">
        <ChoiceRow label={words.howMany} chosen={choices.seats} among={ROOM_INVITE_SEATS} labelOf={words.seatChoices} onChoose={(seats) => change({ seats })} />
        <ChoiceRow label={words.theyComeIn} chosen={choices.letsIn ?? defaultLetsIn(choices.seats)} among={ROOM_INVITE_LETS_IN} labelOf={(each) => words.letsInChoices[each]} onChoose={(letsIn) => change({ letsIn })} />
        <ChoiceRow label={words.inviteWorksFor} chosen={choices.lifetime} among={ROOM_INVITE_LIFETIMES} labelOf={(each) => words.inviteLifetimes[each]} onChoose={(lifetime) => change({ lifetime })} />
        {ways && <ConnectRow ways={ways} connect={connect} onChoose={(picked) => change({ connect: picked })} />}
      </div>
      {problem && <p className="warning">{problem}</p>}
      {replaces && <p className="hint">{words.replacesInvite}</p>}
      {withdrawn && (
        <p className="hint" role="status">
          {words.inviteWithdrawn}
        </p>
      )}
      <div className="form-actions">
        <button type="button" onClick={onCancel}>
          {words.cancel}
        </button>
        <button type="submit" disabled={!connect || making}>
          {words.copyInvite}
        </button>
      </div>
    </form>
  );
}

const whyOver = (expired: boolean) => (expired ? t.devices.invite.expired : words.inviteOver);

/** An invite while it waits for its people: what it is, how many came, how long it has left, and its text under "Show invite" alone. */
function WaitingInvite({ made, waiting, shown, onWithdraw }: { made: MadeInvite; waiting: RoomInvite; shown: boolean; onWithdraw: () => void }) {
  const { role, seats, letsIn, taken, expiresAt } = waiting;
  const soFar = seats === 1 ? words.waitingForThem : words.seatsTaken(taken, seats);
  return (
    <>
      <div className={`room-invite-sent ${made.copied ? "" : "uncopied"}`}>
        <strong role="status">{made.copied ? words.inviteCopied : words.sendInvite}</strong>
        <span className="hint">{words.whereToPasteInvite}</span>
      </div>
      <section className="room-invite-waiting" aria-label={words.invite}>
        <span>
          <strong>{words.roles[role]}</strong> · {words.seatChoices(seats)} · {words.letsInChoices[letsIn]}
        </span>
        <span className="room-invite-so-far">
          {soFar} · {words.expiresIn(relativeTimeOf(expiresAt, locale))}
        </span>
        <button type="button" className="link" onClick={onWithdraw}>
          {words.withdrawInvite}
        </button>
      </section>
      {shown && <textarea className="room-invite-text" readOnly aria-label={words.invite} value={made.text} onFocus={(event) => event.target.select()} />}
    </>
  );
}

/** A made invite from when it is copied until everyone it is for came, or it can't be used any more. */
function MadeInviteCard({
  made,
  room,
  people,
  invites,
  joiners,
  onWithdraw,
  onChange,
  onAnother,
  onClose,
}: {
  made: MadeInvite;
  room: Room;
  people: Person[];
  invites: RoomInvite[];
  joiners: RoomJoiner[];
  onWithdraw: () => void;
  onChange: () => void;
  onAnother: () => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(!made.copied);
  const { invite, alreadyThere } = made;
  const expired = useExpired(invite.expiresAt);
  const waiting = expired ? undefined : invites.find(({ id }) => id === invite.id);
  const cameSince = ({ personId, role }: { personId: string; role: RoomRole }) => role === invite.role && !alreadyThere.has(personId);
  const joined = room.people.filter(cameSince);
  const atTheDoor = joiners.filter(cameSince);
  const allCame = joined.length + atTheDoor.length >= invite.seats;
  const nameOf = (personId: string) => personGoesBy(people.find(({ id }) => id === personId), words.nameless);
  return (
    <>
      {waiting && <WaitingInvite made={made} waiting={waiting} shown={shown} onWithdraw={onWithdraw} />}
      {!waiting && !allCame && <p role="status">{whyOver(expired)}</p>}
      <div className="room-invite-joined" role="status">
        {joined.map(({ personId, role }) => (
          <p key={personId}>{words.joinedAs(nameOf(personId), words.roles[role])}</p>
        ))}
      </div>
      <WaitingToJoin joiners={atTheDoor} />
      <div className="form-actions">
        {waiting ? (
          <>
            <CopyButton className="link" text={made.text} label={made.copied ? words.copyInviteAgain : words.copyInvite} />
            <button type="button" className="link room-invite-show" aria-expanded={shown} onClick={() => setShown(!shown)}>
              {words.showInvite}
            </button>
            <button type="button" onClick={onChange}>
              {words.changeInvite}
            </button>
          </>
        ) : (
          <button type="button" onClick={onAnother}>
            {allCame ? words.inviteSomeoneElse : t.devices.invite.another}
          </button>
        )}
        <button type="button" className={atTheDoor.length > 0 ? undefined : "primary"} autoFocus onClick={onClose}>
          {words.done}
        </button>
      </div>
    </>
  );
}

/**
 * Makes an invite into the room: a single text, a secret until its last use, which "Copy invite" puts on the clipboard.
 * Then the dialog is that invite, until it is withdrawn, or changed, which makes another and withdraws it.
 */
export function RoomInviteDialog({
  room,
  people,
  devices,
  invites,
  joiners,
  onClose,
}: {
  room: Room;
  people: Person[];
  devices: DevicesListed | null;
  invites: RoomInvite[];
  joiners: RoomJoiner[];
  onClose: () => void;
}) {
  const [choices, setChoices] = useState(FIRST_CHOICES);
  const [made, setMade] = useState<MadeInvite | null>(null);
  const [choosing, setChoosing] = useState(true);
  const [withdrawn, setWithdrawn] = useState(false);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ways = devices && waysToConnect(devices);
  const connect = ways && connectBy(choices.connect, ways);
  const chooseAnew = () => {
    setMade(null);
    setChoosing(true);
  };
  const copyInvite = async () => {
    if (!connect || making) return;
    const { role, seats, lifetime } = choices;
    const letsIn = choices.letsIn ?? defaultLetsIn(seats);
    const alreadyThere = new Set([...room.people, ...joiners].map(({ personId }) => personId));
    setMaking(true);
    setProblem(null);
    setWithdrawn(false);
    try {
      const invited = await connection.sendAndAwait(
        (requestId) => ({ type: "room.invite", requestId, roomId: room.id, role, connect, seats, letsIn, lifetime }),
        (message, requestId) => (message.type === "room.invited" && message.requestId === requestId ? message : undefined),
      );
      if (!invited.text || !invited.invite) return setProblem(replyProblemText(invited));
      if (made) withdraw(made.invite);
      setMade({ invite: invited.invite, text: invited.text, copied: await putOnClipboard(invited.text), choices, alreadyThere });
      setChoosing(false);
    } catch {
      // Disconnected; the page says so, and the host made no invite
    } finally {
      setMaking(false);
    }
  };
  const cancel = () => {
    if (!made) return onClose();
    setChoices(made.choices);
    setProblem(null);
    setChoosing(false);
  };
  return (
    <Modal label={words.inviteTo(room.name)} className="room-dialog room-invite-dialog" onClose={onClose}>
      <header>
        <h2>{words.inviteTo(room.name)}</h2>
        <button type="button" className="icon" title={t.shell.close} aria-label={t.shell.close} onClick={onClose}>
          ×
        </button>
      </header>
      {made && !choosing ? (
        <MadeInviteCard
          key={made.invite.id}
          made={made}
          room={room}
          people={people}
          invites={invites}
          joiners={joiners}
          onWithdraw={() => {
            withdraw(made.invite);
            setWithdrawn(true);
            chooseAnew();
          }}
          onChange={() => setChoosing(true)}
          onAnother={chooseAnew}
          onClose={onClose}
        />
      ) : (
        <InviteForm choices={choices} ways={ways} replaces={made !== null} withdrawn={withdrawn} making={making} problem={problem} onChange={setChoices} onCopy={() => void copyInvite()} onCancel={cancel} />
      )}
    </Modal>
  );
}

/** The machines this computer has added that an invite's text names, by any of the ways it reaches them. */
function machineOfInvite(machines: Machine[], text: string) {
  const parsed = machineAddress(text);
  if (!parsed?.forRoom) return { parsed: null, known: undefined };
  const origins = [parsed.origin, ...(parsed.tunnel ? [tunnelOrigin(parsed.tunnel)] : [])];
  return { parsed, known: machines.find(({ origin }) => origins.includes(origin)) };
}

/**
 * Joins someone else's room with the invite they sent: a machine this computer has not added yet is added with it, as
 * under Machines; one it has, of another room there, is joined again with the new invite.
 */
export function JoinRoomDialog({
  machines,
  person,
  onJoined,
  onClose,
}: {
  machines: Machine[];
  person: JoiningPerson;
  onJoined: (machineId: string, roomId: string | null, waiting: boolean) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [joining, setJoining] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const nameToJoin = useNameToJoinWith(person, true);
  const join = async (event: FormEvent) => {
    event.preventDefault();
    const invite = text.trim();
    const { parsed, known } = machineOfInvite(machines, invite);
    if (!parsed) return setProblem(words.notAnInvite);
    if (nameToJoin.missing) return;
    setJoining(true);
    setProblem(null);
    try {
      const refusal = await nameToJoin.keep();
      if (refusal) return setProblem(refusal);
      const answer = known
        ? await connection.sendAndAwait(
            (requestId) => ({ type: "machine.join", requestId, machineId: known.id, invite }),
            (message, requestId) => (message.type === "machine.join-answered" && message.requestId === requestId ? { ...message, machineId: known.id } : undefined),
          )
        : await connection.sendAndAwait(
            (requestId) => ({ type: "machine.add", requestId, name: "", address: invite }),
            (message, requestId) => (message.type === "machine.added" && message.requestId === requestId ? message : undefined),
          );
      if (answer.problem || !answer.machineId) return setProblem(replyProblemText(answer));
      onJoined(answer.machineId, answer.roomId, answer.waiting);
    } catch {
      // Disconnected; the page says so
    } finally {
      setJoining(false);
    }
  };
  return (
    <Modal label={words.joinRoom} className="room-dialog join-room-dialog" onClose={onClose}>
      <h2>{words.joinRoom}</h2>
      <form onSubmit={(event) => void join(event)}>
        <label className="room-field">
          {words.pasteInvite}
          <input
            autoFocus
            {...NAME_FIELD_ATTRIBUTES}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setProblem(null);
            }}
          />
        </label>
        {nameToJoin.asked && (
          <NameToJoinWith
            typed={nameToJoin.typed}
            onChange={(typed) => {
              nameToJoin.setTyped(typed);
              setProblem(null);
            }}
          />
        )}
        {problem && <p className="warning join-room-problem">{problem}</p>}
        <div className="form-actions">
          <button type="button" className="link" onClick={onClose}>
            {words.cancel}
          </button>
          <button type="submit" className="primary" disabled={joining || text.trim() === "" || nameToJoin.missing}>
            {joining ? words.joining : words.join}
          </button>
        </div>
      </form>
    </Modal>
  );
}
