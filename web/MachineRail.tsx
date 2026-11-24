import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { markInitials } from "../shared/marks.ts";
import { spacedNumber } from "../shared/join-requests.ts";
import { machineAddress, SOMEONE_ELSES_MACHINE_SANDBOX, type MachineToJoin } from "../shared/machines.ts";
import type { Machine, MachineSeen, MachineStatus, Pastel, WaitingFor } from "../shared/model.ts";
import type { ClientMessage } from "../shared/protocol.ts";
import { connection } from "./connection.ts";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { ContextMenu } from "./ContextMenu.tsx";
import { hints } from "./hints.ts";
import { replyProblemText } from "./host-error.ts";
import { t } from "./i18n/index.ts";
import { useMachineColorStyle } from "./machine-colors.ts";
import { placeIn, shownInAnotherMirador, tellTheMachineItIsShown } from "./machine-place.ts";
import { machineRemovalAsked, removeMachine } from "./machine-removal.ts";
import { giveMessageBoxToMachine, useFormatBar, useMessageBox } from "./message-box.ts";
import { NameToJoinWith, useNameToJoinWith, type JoiningPerson } from "./name-to-join.tsx";
import { pastelVariables } from "./pastels.ts";
import { RenameMachineDialog } from "./RenameMachineDialog.tsx";
import { giveThemeToMachine } from "./theme.ts";
import { NAME_FIELD_ATTRIBUTES } from "./typing-aids.ts";
import { mostUrgentTone } from "./waiting.ts";

const machineFromHash = () => location.hash.match(/^#\/m\/([\w-]+)$/)?.[1] ?? null;

/**
 * This host shows other machines at ports of this computer, which a page opened from elsewhere cannot reach. Neither can
 * a page shown in another Mirador's rail: its ports are this host's, but the computer it runs on is the other one's.
 */
export const showsMachinesHere = () => ["127.0.0.1", "localhost"].includes(location.hostname) && !shownInAnotherMirador();

const words = t.shell.machines;

/** Someone else's machine is shown under its relay's key, which its frame alone knows. */
const relayAddress = (machine: Machine) => `${location.protocol}//${location.hostname}:${machine.relayPort}/${machine.asPerson ? `${machine.relayKey ?? ""}/` : ""}`;

/**
 * Someone else's machine runs in an opaque origin, with no allow-same-origin: no cookie of 127.0.0.1, no storage or
 * service worker shared with anything, no microphone or clipboard, and no way to navigate this window or open one of
 * its own outside the sandbox. A machine of this computer's owner gets this window's microphone and clipboard.
 */
const frameTrust = (machine: Machine) => (machine.asPerson ? { sandbox: SOMEONE_ELSES_MACHINE_SANDBOX, "data-someone-elses": "" } : { allow: "clipboard-read; clipboard-write; microphone" });

/** For the stylesheet: the machine's pastel, which its rail button, mark and strip draw with. */
export const colorAttributes = (color: Pastel | null) => (color ? { "data-color": color, style: pastelVariables(color) } : {});

/** A place to open in a machine's frame, e.g. a conversation from that machine's notification, or a room; each request is a new object. */
export interface PlaceToOpen {
  machineId: string;
  /** The hash route on that machine, `#/c/<id>` or `#/r/<id>`. */
  place: string;
}

/** A machine's page keeps streaming what its conversations do while hidden, so a machine left for this long lets go of it. */
export const HIDDEN_MACHINE_STAYS_LOADED_MS = 10 * 60_000;

/** Every machine shown so far, which stay loaded until hidden for HIDDEN_MACHINE_STAYS_LOADED_MS. */
export function useKeptLoaded(shownId: string | null, onLetGo: (machineId: string) => void = () => {}) {
  const [visited, setVisited] = useState(() => new Set(shownId ? [shownId] : []));
  const lettingGo = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const keep = (machineId: string) => setVisited((before) => new Set(before).add(machineId));
  const letGo = (machineId: string) => {
    setVisited((before) => new Set([...before].filter((id) => id !== machineId)));
    onLetGo(machineId);
  };
  useEffect(() => {
    if (!shownId) return;
    keep(shownId);
    clearTimeout(lettingGo.current.get(shownId));
    return () => {
      lettingGo.current.set(shownId, setTimeout(() => letGo(shownId), HIDDEN_MACHINE_STAYS_LOADED_MS));
    };
  }, [shownId]);
  return { visited, keep };
}

/** Which machine of its owner's the window shows (null for this computer); one loaded again opens at the place its page showed last. */
export function useShownMachine(machines: Machine[], machinesLoaded: boolean) {
  const [shownId, setShownId] = useState(machineFromHash);
  const [opening, setOpening] = useState<PlaceToOpen | null>(null);
  const places = useRef(new Map<string, string>());
  const shown = machines.find(({ id }) => id === shownId) ?? null;
  const { visited, keep } = useKeptLoaded(shownId, (machineId) => setOpening((current) => (current?.machineId === machineId ? null : current)));
  useEffect(() => {
    if (machinesLoaded && shownId && !shown) setShownId(null);
  }, [machinesLoaded, shownId, shown]);
  const rememberPlace = useCallback((machineId: string, place: string) => places.current.set(machineId, place), []);
  const placeOf = useCallback((machineId: string) => places.current.get(machineId) ?? "", []);
  const show = useCallback((machineId: string | null) => {
    setShownId(machineId);
    if (machineId) keep(machineId);
  }, []);
  const openIn = useCallback((machineId: string, place: string) => {
    setOpening({ machineId, place });
    show(machineId);
  }, []);
  const addAndShow = useAddedMachineShown(machines, show);
  return { shownId, shown, visited, opening, show, openIn, addAndShow, rememberPlace, placeOf };
}

/** Adds a machine and shows it once the host lists it, where it offers to join; clicks before then add it only once. */
function useAddedMachineShown(machines: Machine[], show: (machineId: string) => void) {
  const addingOrigin = useRef<string | null>(null);
  const added = addingOrigin.current === null ? undefined : machines.find(({ origin }) => origin === addingOrigin.current);
  useEffect(() => {
    if (!added) return;
    addingOrigin.current = null;
    show(added.id);
  }, [added?.id]);
  return useCallback(({ name, origin }: MachineSeen) => {
    if (addingOrigin.current !== origin && connection.send({ type: "machine.add", requestId: crypto.randomUUID(), name, address: origin })) addingOrigin.current = origin;
  }, []);
}

function WaitingBadge({ waiting }: { waiting: WaitingFor[] }) {
  if (waiting.length === 0) return null;
  return <span className={`rail-waiting tone-${mostUrgentTone(waiting)}`}>{waiting.length}</span>;
}

/** Where the machine is reached, as a person reads it: its address, which a machine reached peer to peer has none of. */
export const reachedAt = (machine: Machine) => (machine.peerToPeer ? words.peerToPeer : machine.origin);

const machineHint = (machine: Machine, status: MachineStatus | undefined) =>
  [
    machine.name,
    reachedAt(machine),
    !machine.joined && words.notJoinedYet,
    status?.reachable === false && words.notAnswering,
    status?.waiting.length && words.waitingForYou(status.waiting.length),
  ]
    .filter(Boolean)
    .join(" · ");

const toJoinHint = (machine: MachineToJoin, machines: Machine[]) =>
  [machine.name, machine.origin, words.joinedBy(machines.find(({ id }) => id === machine.throughMachineId)!.name), words.notJoinedYet].join(" · ");

/** What the host keeps of a machine shown elsewhere, without where this computer saw it. */
export const seenPart = ({ name, origin, hostId }: MachineSeen): MachineSeen => ({ name, origin, hostId });

function useMenuAtPointer() {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const openMenu = (event: MouseEvent) => {
    event.preventDefault();
    setMenuAt({ x: event.clientX, y: event.clientY });
  };
  return { menuAt, openMenu, closeMenu: () => setMenuAt(null) };
}

function MachineButton({ machine, status, shown, onShow }: { machine: Machine; status: MachineStatus | undefined; shown: boolean; onShow: () => void }) {
  const { menuAt, openMenu, closeMenu } = useMenuAtPointer();
  const [renaming, setRenaming] = useState(false);
  const away = !machine.joined || status?.reachable === false;
  return (
    <>
      <button
        type="button"
        className={`rail-machine ${shown ? "shown" : ""} ${away ? "away" : ""}`}
        {...colorAttributes(machine.color)}
        aria-label={machine.name}
        aria-current={shown}
        data-hint={machineHint(machine, status)}
        onClick={onShow}
        onContextMenu={openMenu}
      >
        {markInitials(machine.name)}
        <WaitingBadge waiting={status?.waiting ?? []} />
      </button>
      {menuAt && (
        <ContextMenu
          name={machine.name}
          at={menuAt}
          entries={[
            { label: words.open, icon: "open", onChoose: onShow },
            { label: words.rename, icon: "pencil", onChoose: () => setRenaming(true) },
            { label: words.remove, icon: "trash", asked: machineRemovalAsked(machine), onChoose: () => removeMachine(machine.id) },
          ]}
          onClose={closeMenu}
        />
      )}
      {renaming && <RenameMachineDialog machine={machine} onClose={() => setRenaming(false)} />}
    </>
  );
}

function MachineToJoinButton({ machine, hint, onAdd }: { machine: MachineToJoin; hint: string; onAdd: (machine: MachineToJoin) => void }) {
  const { menuAt, openMenu, closeMenu } = useMenuAtPointer();
  const hide = () => connection.send({ type: "machine.hide", machine: seenPart(machine) });
  return (
    <>
      <button type="button" className="rail-machine away" aria-label={machine.name} data-hint={hint} onClick={() => onAdd(machine)} onContextMenu={openMenu}>
        {markInitials(machine.name)}
      </button>
      {menuAt && <ContextMenu name={machine.name} at={menuAt} entries={[{ label: words.hideFromRail, icon: "eyeOff", onChoose: hide }]} onClose={closeMenu} />}
    </>
  );
}

export function MachineRail({
  machines,
  statuses,
  toJoin,
  waitingHere,
  shownId,
  onShow,
  onAdd,
  onManage,
}: {
  machines: Machine[];
  statuses: MachineStatus[];
  /** Machines this computer's machines have joined, which it can add and join with a click. */
  toJoin: MachineToJoin[];
  waitingHere: WaitingFor[];
  shownId: string | null;
  onShow: (machineId: string | null) => void;
  onAdd: (machine: MachineToJoin) => void;
  onManage: () => void;
}) {
  const thisComputerHint = [hints.thisComputer, waitingHere.length > 0 && words.waitingForYou(waitingHere.length)].filter(Boolean).join(" · ");
  return (
    <nav className="machine-rail" aria-label={words.title}>
      <button
        type="button"
        className={`rail-machine this-computer ${shownId === null ? "shown" : ""}`}
        aria-label={words.thisComputer}
        aria-current={shownId === null}
        data-hint={thisComputerHint}
        onClick={() => onShow(null)}
      >
        ⌂
        <WaitingBadge waiting={waitingHere} />
      </button>
      {machines.map((machine) => (
        <MachineButton
          key={machine.id}
          machine={machine}
          status={statuses.find(({ machineId }) => machineId === machine.id)}
          shown={machine.id === shownId}
          onShow={() => onShow(machine.id)}
        />
      ))}
      {toJoin.map((machine) => (
        <MachineToJoinButton key={machine.origin} machine={machine} hint={toJoinHint(machine, machines)} onAdd={onAdd} />
      ))}
      <button type="button" className="rail-manage" aria-label={words.manage} data-hint={hints.manageMachines} onClick={onManage}>
        +
      </button>
    </nav>
  );
}


function MachineFrame({
  machine,
  shown,
  opening,
  striped,
  place,
  onPlace,
}: {
  machine: Machine;
  shown: boolean;
  opening: PlaceToOpen | null;
  striped: boolean;
  place: string;
  onPlace: (machineId: string, place: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const openedWith = useRef(opening);
  const [address] = useState(() => `${relayAddress(machine)}${opening?.place ?? place}`);
  useEffect(() => {
    if (opening && opening !== openedWith.current) frame.current!.contentWindow!.location.href = `${relayAddress(machine)}${opening.place}`;
  }, [opening]);
  useEffect(() => tellTheMachineItIsShown(frame.current, shown), [shown]);
  useEffect(() => {
    const chosen = new MutationObserver(() => giveThemeToMachine(frame.current));
    chosen.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => chosen.disconnect();
  }, []);
  const messageBox = useMessageBox();
  const formatBar = useFormatBar();
  const giveMessageBox = () => {
    if (machine.asPerson) giveMessageBoxToMachine(frame.current);
  };
  useEffect(giveMessageBox, [messageBox, formatBar]);
  useEffect(() => {
    if (machine.asPerson) return;
    const rememberPlace = (event: MessageEvent) => {
      const sent = placeIn(event.data);
      if (sent !== null && event.source === frame.current?.contentWindow && event.origin === new URL(address).origin) onPlace(machine.id, sent);
    };
    window.addEventListener("message", rememberPlace);
    return () => window.removeEventListener("message", rememberPlace);
  }, []);
  return (
    <iframe
      ref={frame}
      className={`machine-frame ${shown ? "shown" : ""}`}
      {...colorAttributes(striped ? machine.color : null)}
      title={machine.name}
      src={address}
      {...frameTrust(machine)}
      onLoad={() => {
        tellTheMachineItIsShown(frame.current, shown);
        giveThemeToMachine(frame.current);
        giveMessageBox();
      }}
    />
  );
}

/**
 * In a machine's place until this computer has joined it, as the machine shows nothing to a computer without an invite.
 * Asking to join, which its owner approves, makes this computer one of the owner's own devices, so it is offered only
 * for a machine this computer has no record of joining as a person: one added from a room invite's link, joined with
 * a room invite before, or whose owner signed this computer out of their rooms there takes an invite alone. A machine
 * reached peer to peer takes the invite's whole link, as only the link carries the way through its tunnel.
 */
function JoinMachinePanel({ machine, person, onJoinedRoom }: { machine: Machine; person: JoiningPerson; onJoinedRoom: (machineId: string, roomId: string, waiting: boolean) => void }) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [askedNumber, setAskedNumber] = useState<string | null>(null);
  const nameToJoin = useNameToJoinWith(person, machine.asPerson || machineAddress(text)?.forRoom === true);

  /** Follows the host's answers until the last, as asking to join waits there until someone approves it. */
  const tryToJoin = (send: (requestId: string) => ClientMessage) => {
    const requestId = crypto.randomUUID();
    const stopListening = connection.onMessage((message) => {
      if (message.type === "machine.join-asked" && message.requestId === requestId) return setAskedNumber(message.number);
      if (message.type !== "machine.join-answered" || message.requestId !== requestId) return;
      stopListening();
      setProblem(replyProblemText(message));
      setJoining(false);
      setAskedNumber(null);
      if (message.roomId) onJoinedRoom(machine.id, message.roomId, message.waiting);
    });
    if (!connection.send(send(requestId))) {
      stopListening();
      return setJoining(false);
    }
    setProblem(null);
    setJoining(true);
  };
  const join = async (event: FormEvent) => {
    event.preventDefault();
    if (joining || nameToJoin.missing) return;
    setJoining(true);
    setProblem(null);
    const refusal = await nameToJoin.keep();
    if (refusal) {
      setProblem(refusal);
      return setJoining(false);
    }
    tryToJoin((requestId) => ({ type: "machine.join", requestId, machineId: machine.id, invite: text }));
  };
  const askToJoin = () => tryToJoin((requestId) => ({ type: "machine.ask-to-join", requestId, machineId: machine.id }));

  return (
    <section className="machine-join gate join-machine" aria-label={words.join(machine.name)}>
      <h1>{words.join(machine.name)}</h1>
      {askedNumber ? (
        <div className="join-asked" role="status" aria-label={words.waitingForApproval}>
          <p>
            {words.waitingOn} <strong>{machine.name}</strong>
            {words.typeNumberThere}
          </p>
          <p className="join-number">{spacedNumber(askedNumber)}</p>
          <p className="hint">
            {words.requestShowsBefore} <code>mirador approve</code>
            {words.requestShowsAfter}
          </p>
        </div>
      ) : (
        <>
          {machine.outOfRooms ? (
            <p className="join-out-of-rooms">{words.outOfRooms}</p>
          ) : machine.asPerson ? (
            <p className="join-room-invite">{words.roomInviteFirst}</p>
          ) : (
            <>
              <p>
                {words.notJoinedBefore} <strong>{machine.name}</strong>
                {words.notJoinedAfter(new URL(machine.origin).host)}
              </p>
              <button type="button" className="primary" disabled={joining} onClick={askToJoin}>
                {words.askToJoin}
              </button>
              <p>
                {words.inviteBefore} <code>mirador invite</code>
                {words.inviteAfter}
              </p>
            </>
          )}
          <form onSubmit={(event) => void join(event)}>
            <label>
              {machine.asPerson ? t.rooms.pasteInvite : machine.peerToPeer ? words.inviteLink : words.inviteCode}
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={machine.asPerson || machine.peerToPeer ? undefined : "ABCD-EFGH-JKLM"}
                autoFocus
                {...NAME_FIELD_ATTRIBUTES}
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
            <button type="submit" className="primary" disabled={joining || !text.trim() || nameToJoin.missing}>
              {joining ? words.joining : words.joinButton}
            </button>
          </form>
        </>
      )}
      {problem && <p className="join-problem">{problem}</p>}
      {machine.outOfRooms && (
        <ConfirmButton className="danger" {...machineRemovalAsked(machine)} onConfirm={() => removeMachine(machine.id)}>
          {words.removeLabel(machine.name)}
        </ConfirmButton>
      )}
    </section>
  );
}

/** Every frame shares one cell, and moving an iframe in the page reloads what it showed, so they keep one order whatever they are named. */
const framesInOneOrder = (machines: Machine[]) => machines.toSorted((one, other) => one.id.localeCompare(other.id));

/** Each machine's own Mirador, as its host serves it; shown again within HIDDEN_MACHINE_STAYS_LOADED_MS, it is still loaded and back at once. */
export function MachineFrames({
  machines,
  person,
  shownId,
  visited,
  opening,
  placeOf,
  onPlace,
  onJoinedRoom,
}: {
  machines: Machine[];
  person: JoiningPerson;
  shownId: string | null;
  visited: Set<string>;
  opening: PlaceToOpen | null;
  placeOf: (machineId: string) => string;
  onPlace: (machineId: string, place: string) => void;
  /** An invite pasted in a machine's place took this computer's owner into this room of it, or to its door. */
  onJoinedRoom: (machineId: string, roomId: string, waiting: boolean) => void;
}) {
  const striped = useMachineColorStyle() === "strip";
  return framesInOneOrder(machines)
    .filter((machine) => visited.has(machine.id) && machine.relayPort !== null)
    .map((machine) =>
      machine.joined ? (
        <MachineFrame
          key={`${machine.id} ${machine.relayKey ?? "own"}`}
          machine={machine}
          shown={machine.id === shownId}
          opening={opening?.machineId === machine.id ? opening : null}
          striped={striped && !machine.asPerson}
          place={placeOf(machine.id)}
          onPlace={onPlace}
        />
      ) : (
        machine.id === shownId && <JoinMachinePanel key={machine.id} machine={machine} person={person} onJoinedRoom={onJoinedRoom} />
      ),
    );
}
