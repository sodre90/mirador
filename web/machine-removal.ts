import type { Machine } from "../shared/model.ts";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";

const words = t.shell.machines;

/** Says what stays at the machine, where this computer may be one of its owner's devices, a person's in its rooms, or no longer signed in. */
export function removeMachineArmedHint({ joined, asPerson }: Pick<Machine, "joined" | "asPerson">) {
  if (!joined) return hints.removeMachineNotJoinedArmed;
  return asPerson ? hints.removeSomeoneElsesMachineArmed : hints.removeMachineArmed;
}

/** How removing the machine asks again, wherever it is offered. */
export const machineRemovalAsked = (machine: Machine) => ({
  label: words.removeLabel(machine.name),
  armedText: words.removeArmed,
  armedHint: removeMachineArmedHint(machine),
});

export const removeMachine = (machineId: string) => connection.send({ type: "machine.remove", machineId });
