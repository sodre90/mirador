import { useEffect, useState, type FormEvent } from "react";
import { machineAddress } from "../shared/machines.ts";
import { markInitials } from "../shared/marks.ts";
import type { Machine, Pastel } from "../shared/model.ts";
import { ColorSwatches } from "./ColorSwatches.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { colorAttributes } from "./MachineRail.tsx";

/** Where this host cannot show the machine (a page opened from another device), a tab of its own, used again next time. */
export function openMachine(origin: string, conversationId: string | null = null) {
  window.open(`${origin}/${conversationId ? `#/c/${conversationId}` : ""}`, `mirador-machine-${origin}`);
}

const words = t.shell.machines;

function AddMachine({ machines }: { machines: Machine[] }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const parsed = machineAddress(address);
  const known = parsed && machines.some(({ origin }) => origin === parsed.origin);

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!parsed || known || !connection.send({ type: "machine.add", name, address })) return;
    setName("");
    setAddress("");
  };

  return (
    <form className="add-machine" onSubmit={add}>
      <label>
        {words.name}
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder={words.namePlaceholder} />
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
      <button type="submit" className="primary" disabled={!parsed || !!known}>
        {parsed?.joinCode ? words.addAndJoin : words.add}
      </button>
      {known && <p className="hint">{words.alreadyListed}</p>}
    </form>
  );
}

function MachineRow({ machine, onOpen }: { machine: Machine; onOpen: (machine: Machine) => void }) {
  const [pickingColor, setPickingColor] = useState(false);
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
      <span className="machine-origin">{machine.origin}</span>
      {!machine.joined && <span className="machine-not-joined">{words.notJoinedYet}</span>}
      <button type="button" onClick={() => onOpen(machine)}>
        {words.open}
      </button>
      <ConfirmButton
        className="danger"
        label={words.removeLabel(machine.name)}
        armedText={words.removeArmed}
        armedHint={hints.removeMachineArmed}
        onConfirm={() => connection.send({ type: "machine.remove", machineId: machine.id })}
      >
        {words.remove}
      </ConfirmButton>
      {pickingColor && <ColorSwatches label={words.colourOf(machine.name)} chosen={machine.color} onChoose={choose} />}
    </li>
  );
}

export function MachinesDialog({ machines, onOpen, onClose }: { machines: Machine[]; onOpen: (machine: Machine) => void; onClose: () => void }) {
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
        <AddMachine machines={machines} />
      </div>
    </div>
  );
}
