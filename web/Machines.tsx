import { useEffect, useState, type FormEvent } from "react";
import { machineAddress, type MachineToJoin } from "../shared/machines.ts";
import { markInitials } from "../shared/marks.ts";
import type { Machine, Pastel } from "../shared/model.ts";
import { tunnelOrigin } from "../shared/tunnel.ts";
import { ColorSwatches } from "./ColorSwatches.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { machineRemovalAsked, removeMachine } from "./machine-removal.ts";
import { colorAttributes, reachedAt, seenPart } from "./MachineRail.tsx";
import { NameToJoinWith, useNameToJoinWith, type JoiningPerson } from "./name-to-join.tsx";
import { RenameMachineDialog } from "./RenameMachineDialog.tsx";

/** Where this host cannot show the machine (a page opened from another device), a tab of its own, used again next time. */
export function openMachine(origin: string, conversationId: string | null = null) {
  window.open(`${origin}/${conversationId ? `#/c/${conversationId}` : ""}`, `mirador-machine-${origin}`);
}

const words = t.shell.machines;

/**
 * Adds a machine, and with an invite link joins it at once: one joined with a room invite's link opens in that room at
 * once, while the machines of one's own stay listed here, to open or colour.
 * A link that reaches the machine peer to peer names the machine, so its name may stay empty.
 */
function AddMachine({ machines, person, onJoined }: { machines: Machine[]; person: JoiningPerson; onJoined: (machineId: string, roomId: string | null, waiting: boolean) => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [adding, setAdding] = useState(false);
  const [nameRefusal, setNameRefusal] = useState<string | null>(null);
  const parsed = machineAddress(address);
  const origins = parsed ? [parsed.origin, ...(parsed.tunnel ? [tunnelOrigin(parsed.tunnel)] : [])] : [];
  const known = machines.some(({ origin }) => origins.includes(origin));
  const nameToJoin = useNameToJoinWith(person, parsed?.forRoom === true);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsed || known || adding || nameToJoin.missing) return;
    setAdding(true);
    try {
      const refusal = await nameToJoin.keep();
      setNameRefusal(refusal);
      if (refusal) return;
      const added = await connection.sendAndAwait(
        (requestId) => ({ type: "machine.add", requestId, name, address }),
        (message, requestId) => (message.type === "machine.added" && message.requestId === requestId ? message : undefined),
      );
      if (added.machineId) {
        setName("");
        setAddress("");
      }
      if (added.machineId && !added.problem && parsed.forRoom) onJoined(added.machineId, added.roomId, added.waiting);
    } catch {
      // Disconnected; the page says so
    } finally {
      setAdding(false);
    }
  };

  return (
    <form className="add-machine" onSubmit={(event) => void add(event)}>
      <label>
        {words.name}
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder={parsed?.tunnel?.name ?? words.namePlaceholder} />
      </label>
      <label>
        {words.address}
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="home-server.your-tailnet.ts.net"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <button type="submit" className="primary" disabled={!parsed || known || adding || nameToJoin.missing}>
        {adding && parsed?.joinCode ? words.joining : parsed?.joinCode ? words.addAndJoin : words.add}
      </button>
      {nameToJoin.asked && (
        <NameToJoinWith
          typed={nameToJoin.typed}
          onChange={(typed) => {
            nameToJoin.setTyped(typed);
            setNameRefusal(null);
          }}
        />
      )}
      {nameRefusal && (
        <p className="hint name-to-join-refused" role="alert">
          {nameRefusal}
        </p>
      )}
      {known && <p className="hint">{words.alreadyListed}</p>}
    </form>
  );
}

function MachineRow({ machine, onOpen }: { machine: Machine; onOpen: (machine: Machine) => void }) {
  const [pickingColor, setPickingColor] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const choose = (color: Pastel | null) => {
    connection.send({ type: "machine.set-color", machineId: machine.id, color });
    setPickingColor(false);
  };
  return (
    <li>
      <button
        type="button"
        className="machine-mark"
        {...colorAttributes(machine.color)}
        aria-label={words.colour}
        aria-expanded={pickingColor}
        data-hint={hints.machineColor}
        onClick={() => setPickingColor(!pickingColor)}
      >
        {markInitials(machine.name)}
      </button>
      <span className="machine-name">{machine.name}</span>
      <span className="machine-origin">{reachedAt(machine)}</span>
      {!machine.joined && <span className="machine-not-joined">{words.notJoinedYet}</span>}
      <button type="button" onClick={() => onOpen(machine)}>
        {words.open}
      </button>
      <button type="button" onClick={() => setRenaming(true)}>
        {words.rename}
      </button>
      <ConfirmButton className="danger" {...machineRemovalAsked(machine)} onConfirm={() => removeMachine(machine.id)}>
        {words.remove}
      </ConfirmButton>
      {pickingColor && <ColorSwatches label={words.colourOf(machine.name)} chosen={machine.color} onChoose={choose} />}
      {renaming && <RenameMachineDialog machine={machine} onClose={() => setRenaming(false)} />}
    </li>
  );
}

/** Machines this computer's machines have joined, kept out of the rail, each with a way back into it. */
function HiddenMachines({ hidden, machines }: { hidden: MachineToJoin[]; machines: Machine[] }) {
  if (hidden.length === 0) return null;
  const throughName = (machine: MachineToJoin) => machines.find(({ id }) => id === machine.throughMachineId)!.name;
  return (
    <section className="hidden-machines" aria-label={words.hidden}>
      <h3>{words.hidden}</h3>
      <p className="hint">{words.hiddenAbout}</p>
      <ul className="machine-list">
        {hidden.map((machine) => (
          <li key={machine.origin}>
            <span className="machine-name">{machine.name}</span>
            <span className="machine-origin">{machine.origin}</span>
            <span className="machine-seen-through">{words.joinedBy(throughName(machine))}</span>
            <button
              type="button"
              aria-label={words.showInRailLabel(machine.name)}
              onClick={() => connection.send({ type: "machine.show-again", machine: seenPart(machine) })}
            >
              {words.showInRail}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MachinesDialog({
  machines,
  hidden,
  person,
  onOpen,
  onJoined,
  onClose,
}: {
  machines: Machine[];
  hidden: MachineToJoin[];
  person: JoiningPerson;
  onOpen: (machine: Machine) => void;
  onJoined: (machineId: string, roomId: string | null, waiting: boolean) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal machines" role="dialog" aria-label={words.title}>
        <header>
          <h2>{words.title}</h2>
          <button className="icon" title={t.shell.close} aria-label={t.shell.close} onClick={onClose}>
            ×
          </button>
        </header>
        <p className="hint">
          {words.about} <code>mirador invite</code>
          {words.aboutAfterCommand}
        </p>
        <ul className="machine-list" aria-label={words.title}>
          {machines.map((machine) => (
            <MachineRow key={machine.id} machine={machine} onOpen={onOpen} />
          ))}
          {machines.length === 0 && <li className="machine-none">{words.noneYet}</li>}
        </ul>
        <HiddenMachines hidden={hidden} machines={machines} />
        <AddMachine machines={machines} person={person} onJoined={onJoined} />
      </div>
    </div>
  );
}
