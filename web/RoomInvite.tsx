import { useState, type FormEvent } from "react";
import { inviteConnectFor, machineAddress, type RoomInviteConnect } from "../shared/machines.ts";
import type { Machine, Person } from "../shared/model.ts";
import { LONGEST_PERSON_NAME, nameRefused, personName } from "../shared/people.ts";
import type { PeerToPeerStatus } from "../shared/protocol.ts";
import { defaultLetsIn, ROOM_INVITE_LETS_IN, ROOM_INVITE_SEATS, ROOM_ROLES, type Room, type RoomInviteLetsIn, type RoomInviteSeats, type RoomRole } from "../shared/rooms.ts";
import { tunnelOrigin } from "../shared/tunnel.ts";
import { connection } from "./connection.ts";
import { timeOf } from "./Devices.tsx";
import { replyProblemText } from "./host-error.ts";
import { t } from "./i18n/index.ts";
import { Modal } from "./Palette.tsx";
import { problemText } from "./problem-text.ts";
import { saveSetting } from "./saved-setting.ts";
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

interface MadeInvite {
  text: string;
  expiresAt: number;
  seats: RoomInviteSeats;
  copied: boolean;
}

/**
 * Makes an invite into the room for one person or several, with the role they join as, whether they come in at once or
 * after the owner's OK, and the one way it connects: a single text, a secret until its last use, which "Copy invite"
 * puts on the clipboard and "Show invite" alone shows.
 */
export function RoomInviteDialog({ room, devices, onClose }: { room: Room; devices: DevicesListed | null; onClose: () => void }) {
  const publicOrigin = devices?.reachability.publicAddress?.origin ?? null;
  const peerToPeer = devices?.peerToPeer ?? null;
  const works: Record<RoomInviteConnect, boolean> = { "peer-to-peer": peerToPeerWorks(peerToPeer), address: publicOrigin !== null };
  const [role, setRole] = useState<RoomRole>("member");
  const [seats, setSeats] = useState<RoomInviteSeats>(1);
  const [pickedLetsIn, setLetsIn] = useState<RoomInviteLetsIn | null>(null);
  const letsIn = pickedLetsIn ?? defaultLetsIn(seats);
  const [picked, setConnect] = useState<RoomInviteConnect | null>(null);
  const connect = picked && works[picked] ? picked : inviteConnectFor(devices?.roomInvitesConnect ?? "peer-to-peer", works);
  const [made, setMade] = useState<MadeInvite | null>(null);
  const [shown, setShown] = useState(false);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const noPeerToPeer = whyNoPeerToPeer(peerToPeer);
  const connectLabels: Record<RoomInviteConnect, string> = {
    "peer-to-peer": words.connectChoices["peer-to-peer"],
    address: words.connectChoices.address(publicOrigin ? new URL(publicOrigin).host : ""),
  };
  const choose = (change: () => void) => {
    change();
    setMade(null);
    setShown(false);
    setProblem(null);
  };
  const copyInvite = async () => {
    if (!connect || making) return;
    setMaking(true);
    setProblem(null);
    try {
      const invited = await connection.sendAndAwait(
        (requestId) => ({ type: "room.invite", requestId, roomId: room.id, role, connect, seats, letsIn }),
        (message, requestId) => (message.type === "room.invited" && message.requestId === requestId ? message : undefined),
      );
      if (!invited.text || !invited.invite) return setProblem(replyProblemText(invited));
      const copied = await navigator.clipboard.writeText(invited.text).then(
        () => true,
        () => false,
      );
      setMade({ text: invited.text, expiresAt: invited.invite.expiresAt, seats: invited.invite.seats, copied });
      setShown(!copied);
    } catch {
      // Disconnected; the page says so, and the host made no invite
    } finally {
      setMaking(false);
    }
  };
  return (
    <Modal label={words.inviteTo(room.name)} className="room-dialog room-invite-dialog" onClose={onClose}>
      <h2>{words.inviteTo(room.name)}</h2>
      <fieldset className="room-field">
        <legend>{words.joinsAs}</legend>
        {ROOM_ROLES.map((each) => (
          <label key={each} className="room-agent-choice">
            <input type="radio" name="room-invite-role" checked={role === each} onChange={() => choose(() => setRole(each))} />
            {words.roleChoices[each]}
          </label>
        ))}
      </fieldset>
      <div className="room-invite-seats">
        <label>
          {words.howMany}
          <select value={seats} onChange={(event) => choose(() => setSeats(Number(event.target.value) as RoomInviteSeats))}>
            {ROOM_INVITE_SEATS.map((each) => (
              <option key={each} value={each}>
                {words.seatChoices(each)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {words.letThemIn}
          <select value={letsIn} onChange={(event) => choose(() => setLetsIn(event.target.value as RoomInviteLetsIn))}>
            {ROOM_INVITE_LETS_IN.map((each) => (
              <option key={each} value={each}>
                {words.letsInChoices[each]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details className="room-more-options room-invite-connect" open={!connect}>
        <summary>{connect ? words.connectsBy(connectLabels[connect]) : words.connect}</summary>
        <fieldset className="room-field">
          <legend>{words.connect}</legend>
          <label className="room-agent-choice">
            <input type="radio" name="room-invite-connect" disabled={!works["peer-to-peer"]} checked={connect === "peer-to-peer"} onChange={() => choose(() => setConnect("peer-to-peer"))} />
            {connectLabels["peer-to-peer"]}
          </label>
          {publicOrigin && (
            <label className="room-agent-choice">
              <input type="radio" name="room-invite-connect" checked={connect === "address"} onChange={() => choose(() => setConnect("address"))} />
              {connectLabels.address}
            </label>
          )}
          {noPeerToPeer && <span className="hint room-invite-no-peer-to-peer">{noPeerToPeer}</span>}
          {!connect && <span className="warning">{words.noWayToConnect}</span>}
        </fieldset>
      </details>
      <div className="room-invite-copy">
        <button type="button" className="primary" disabled={!connect || making} onClick={() => void copyInvite()}>
          {made?.copied ? words.inviteCopied : words.copyInvite}
        </button>
        {made && (
          <button type="button" className="link" aria-expanded={shown} onClick={() => setShown(!shown)}>
            {words.showInvite}
          </button>
        )}
      </div>
      {made && (
        <div className="room-invite-made" role="status">
          <p>{words.sendInvite}</p>
          <p className="hint">{words.inviteWorksUntil(made.seats, timeOf(made.expiresAt))}</p>
          {shown && <textarea className="room-invite-text" readOnly aria-label={words.invite} value={made.text} onFocus={(event) => event.target.select()} />}
        </div>
      )}
      {problem && <p className="warning">{problem}</p>}
      <div className="form-actions">
        <button type="button" onClick={onClose}>
          {words.done}
        </button>
      </div>
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
 * under Machines; one it has, of another room there, is joined again with the new invite. The room shows the name of
 * the joiner's profile beside what they write, so while they have none, it is asked for here and kept before joining.
 */
export function JoinRoomDialog({
  machines,
  person,
  onJoined,
  onClose,
}: {
  machines: Machine[];
  /** This machine's owner, whose name the room shows beside what they write; none until the host's snapshot. */
  person: Pick<Person, "name" | "color"> | undefined;
  onJoined: (machineId: string, roomId: string | null, waiting: boolean) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const needsName = !person?.name;
  const named = personName(name);
  const join = async (event: FormEvent) => {
    event.preventDefault();
    const invite = text.trim();
    const { parsed, known } = machineOfInvite(machines, invite);
    if (!parsed) return setProblem(words.notAnInvite);
    if (needsName && named === "") return;
    const refused = needsName && nameRefused(named);
    if (refused) return setProblem(problemText({ code: refused }, t.problems));
    setJoining(true);
    setProblem(null);
    try {
      if (needsName) {
        const refusal = await saveSetting((requestId) => ({ type: "person.set-own-profile", requestId, name: named, color: person?.color ?? null }));
        if (refusal) return setProblem(refusal);
      }
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
        {needsName && (
          <label className="room-field">
            {words.yourName}
            <input
              {...NAME_FIELD_ATTRIBUTES}
              value={name}
              maxLength={LONGEST_PERSON_NAME}
              onChange={(event) => {
                setName(event.target.value);
                setProblem(null);
              }}
            />
            <span className="hint">{words.yourNameHint}</span>
          </label>
        )}
        {problem && <p className="warning join-room-problem">{problem}</p>}
        <div className="form-actions">
          <button type="button" className="link" onClick={onClose}>
            {words.cancel}
          </button>
          <button type="submit" className="primary" disabled={joining || text.trim() === "" || (needsName && named === "")}>
            {joining ? words.joining : words.join}
          </button>
        </div>
      </form>
    </Modal>
  );
}
