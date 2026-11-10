import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { markInitials } from "../shared/marks.ts";
import { spacedNumber } from "../shared/join-requests.ts";
import { inviteIn } from "../shared/machines.ts";
import type { Machine, MachineStatus, Pastel, WaitingFor } from "../shared/model.ts";
import type { ClientMessage } from "../shared/protocol.ts";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { replyProblemText } from "./host-error.ts";
import { t } from "./i18n/index.ts";
import { useMachineColorStyle } from "./machine-colors.ts";
import { placeIn } from "./machine-place.ts";
import { pastelVariables } from "./pastels.ts";
import { mostUrgentTone } from "./waiting.ts";

const machineFromHash = () => location.hash.match(/^#\/m\/([\w-]+)$/)?.[1] ?? null;

/** This host shows other machines at ports of this computer, which a page opened from elsewhere cannot reach. */
export const showsMachinesHere = () => ["127.0.0.1", "localhost"].includes(location.hostname);

const words = t.shell.machines;

const relayAddress = (machine: Machine) => `${location.protocol}//${location.hostname}:${machine.relayPort}/`;

/** For the stylesheet: the machine's pastel, which its rail button, mark and strip draw with. */
export const colorAttributes = (color: Pastel | null) => (color ? { "data-color": color, style: pastelVariables(color) } : {});

/** A conversation to open in a machine's frame, e.g. from that machine's notification; each request is a new object. */
export interface ConversationToOpen {
  machineId: string;
  conversationId: string;
}

/** A machine's page keeps streaming what its conversations do while hidden, so a machine left for this long lets go of it. */
export const HIDDEN_MACHINE_STAYS_LOADED_MS = 10 * 60_000;

/**
 * Which machine the window shows (null for this computer), and every machine it has shown, which stay loaded until
 * hidden for HIDDEN_MACHINE_STAYS_LOADED_MS; a machine loaded again opens at the place its page showed last.
 */
export function useShownMachine(machines: Machine[], machinesLoaded: boolean) {
  const [shownId, setShownId] = useState(machineFromHash);
  const [visited, setVisited] = useState(() => new Set(shownId ? [shownId] : []));
  const [opening, setOpening] = useState<ConversationToOpen | null>(null);
  const places = useRef(new Map<string, string>());
  const lettingGo = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const shown = machines.find(({ id }) => id === shownId) ?? null;
  useEffect(() => {
    if (machinesLoaded && shownId && !shown) setShownId(null);
  }, [machinesLoaded, shownId, shown]);
  useEffect(() => {
    if (!shownId) return;
    clearTimeout(lettingGo.current.get(shownId));
    return () => {
      lettingGo.current.set(shownId, setTimeout(() => letGo(shownId), HIDDEN_MACHINE_STAYS_LOADED_MS));
    };
  }, [shownId]);
  const letGo = (machineId: string) => {
    setVisited((before) => new Set([...before].filter((id) => id !== machineId)));
    setOpening((current) => (current?.machineId === machineId ? null : current));
  };
  const rememberPlace = useCallback((machineId: string, place: string) => places.current.set(machineId, place), []);
  const placeOf = useCallback((machineId: string) => places.current.get(machineId) ?? "", []);
  const show = useCallback((machineId: string | null) => {
    setShownId(machineId);
    if (machineId) setVisited((before) => new Set(before).add(machineId));
  }, []);
  const openIn = useCallback((machineId: string, conversationId: string) => {
    setOpening({ machineId, conversationId });
    show(machineId);
  }, []);
  return { shownId, shown, visited, opening, show, openIn, rememberPlace, placeOf };
}

function WaitingBadge({ waiting }: { waiting: WaitingFor[] }) {
  if (waiting.length === 0) return null;
  return <span className={`rail-waiting tone-${mostUrgentTone(waiting)}`}>{waiting.length}</span>;
}

const machineHint = (machine: Machine, status: MachineStatus | undefined) =>
  [
    machine.name,
    machine.origin,
    !machine.joined && words.notJoinedYet,
    status?.reachable === false && words.notAnswering,
    status?.waiting.length && words.waitingForYou(status.waiting.length),
  ]
    .filter(Boolean)
    .join(" · ");

export function MachineRail({
  machines,
  statuses,
  waitingHere,
  shownId,
  onShow,
  onManage,
}: {
  machines: Machine[];
  statuses: MachineStatus[];
  waitingHere: WaitingFor[];
  shownId: string | null;
  onShow: (machineId: string | null) => void;
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
      {machines.map((machine) => {
        const status = statuses.find(({ machineId }) => machineId === machine.id);
        const away = !machine.joined || status?.reachable === false;
        return (
          <button
            key={machine.id}
            type="button"
            className={`rail-machine ${machine.id === shownId ? "shown" : ""} ${away ? "away" : ""}`}
            {...colorAttributes(machine.color)}
            aria-label={machine.name}
            aria-current={machine.id === shownId}
            data-hint={machineHint(machine, status)}
            onClick={() => onShow(machine.id)}
          >
            {markInitials(machine.name)}
            <WaitingBadge waiting={status?.waiting ?? []} />
          </button>
        );
      })}
      <button type="button" className="rail-manage" aria-label={words.manage} data-hint={hints.manageMachines} onClick={onManage}>
        +
      </button>
    </nav>
  );
}

const conversationAddress = (machine: Machine, conversationId: string) => `${relayAddress(machine)}#/c/${conversationId}`;

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
  opening: ConversationToOpen | null;
  striped: boolean;
  place: string;
  onPlace: (machineId: string, place: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const openedWith = useRef(opening);
  const [address] = useState(() => (opening ? conversationAddress(machine, opening.conversationId) : `${relayAddress(machine)}${place}`));
  useEffect(() => {
    if (opening && opening !== openedWith.current) frame.current!.contentWindow!.location.href = conversationAddress(machine, opening.conversationId);
  }, [opening]);
  useEffect(() => {
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
      allow="clipboard-read; clipboard-write; microphone"
    />
  );
}

/** In a machine's place until this computer has joined it, as the machine shows nothing to a computer without an invite. */
function JoinMachinePanel({ machine }: { machine: Machine }) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [askedNumber, setAskedNumber] = useState<string | null>(null);

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
    });
    if (!connection.send(send(requestId))) return stopListening();
    setProblem(null);
    setJoining(true);
  };
  const join = (event: FormEvent) => {
    event.preventDefault();
    tryToJoin((requestId) => ({ type: "machine.join", requestId, machineId: machine.id, ...inviteIn(text) }));
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
          <form onSubmit={join}>
            <label>
              {words.inviteCode}
              <input value={text} onChange={(event) => setText(event.target.value)} placeholder="ABCD-EFGH-JKLM" autoFocus autoComplete="off" spellCheck={false} />
            </label>
            <button type="submit" className="primary" disabled={joining || !text.trim()}>
              {joining ? words.joining : words.joinButton}
            </button>
          </form>
        </>
      )}
      {problem && <p className="join-problem">{problem}</p>}
    </section>
  );
}

/** Each machine's own Mirador, as its host serves it; shown again within HIDDEN_MACHINE_STAYS_LOADED_MS, it is still loaded and back at once. */
export function MachineFrames({
  machines,
  shownId,
  visited,
  opening,
  placeOf,
  onPlace,
}: {
  machines: Machine[];
  shownId: string | null;
  visited: Set<string>;
  opening: ConversationToOpen | null;
  placeOf: (machineId: string) => string;
  onPlace: (machineId: string, place: string) => void;
}) {
  const striped = useMachineColorStyle() === "strip";
  return machines
    .filter((machine) => visited.has(machine.id) && machine.relayPort !== null)
    .map((machine) =>
      machine.joined ? (
        <MachineFrame
          key={machine.id}
          machine={machine}
          shown={machine.id === shownId}
          opening={opening?.machineId === machine.id ? opening : null}
          striped={striped}
          place={placeOf(machine.id)}
          onPlace={onPlace}
        />
      ) : (
        machine.id === shownId && <JoinMachinePanel key={machine.id} machine={machine} />
      ),
    );
}
