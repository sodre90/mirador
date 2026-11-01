import { storedChoice } from "./stored-choice.ts";
import { t } from "./i18n/index.ts";

export type MachineColorStyle = "rail" | "strip";

export const machineColorStyleLabels: Record<MachineColorStyle, string> = t.labels.machineColorStyle;

const machineColorStyle = storedChoice<MachineColorStyle>("mirador-machine-colors", ["rail", "strip"], "strip");

export const setMachineColorStyle = machineColorStyle.set;
export const useMachineColorStyle = machineColorStyle.use;
