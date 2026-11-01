import { DEFAULT_SHELL_OUTPUT_STYLE, SHELL_OUTPUT_STYLES, type ShellOutputStyle } from "../shared/shell-output.ts";
import { storedChoice } from "./stored-choice.ts";

const shellOutputStyle = storedChoice<ShellOutputStyle>("mirador-shell-output", SHELL_OUTPUT_STYLES, DEFAULT_SHELL_OUTPUT_STYLE);

export const setShellOutputStyle = shellOutputStyle.set;
export const useShellOutputStyle = shellOutputStyle.use;
