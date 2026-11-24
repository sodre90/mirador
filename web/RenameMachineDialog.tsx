import { useState } from "react";
import { LONGEST_MACHINE_NAME } from "../shared/machines.ts";
import type { Machine } from "../shared/model.ts";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { Modal } from "./Palette.tsx";
import { NAME_FIELD_ATTRIBUTES } from "./typing-aids.ts";

const words = t.shell.machines;

/** Names a machine as this computer shows it, in its rail button and lists; the machine's own pages keep their name. */
export function RenameMachineDialog({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const [name, setName] = useState(machine.name);
  const rename = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== machine.name) connection.send({ type: "machine.rename", machineId: machine.id, name: trimmed });
    onClose();
  };
  return (
    <Modal label={words.renameLabel(machine.name)} className="rename-machine" onClose={onClose}>
      <h2>{words.renameLabel(machine.name)}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          rename();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <label>
          {words.name}
          <input autoFocus {...NAME_FIELD_ATTRIBUTES} maxLength={LONGEST_MACHINE_NAME} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="actions">
          <button type="submit" className="primary" disabled={name.trim() === ""}>
            {words.save}
          </button>
          <button type="button" onClick={onClose}>
            {words.cancel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
