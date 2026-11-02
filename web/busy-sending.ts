import type { HarnessId } from "../shared/model.ts";
import { storedChoice } from "./stored-choice.ts";
import { t } from "./i18n/index.ts";

/** What Enter does with a message while the agent works; ⌥Enter does the other. */
export type EnterWhileBusy = "steer" | "after-turn";

export const enterWhileBusyLabels: Record<EnterWhileBusy, string> = t.labels.enterWhileBusy;

/** Claude Code, pi and Codex take messages into a running turn (ACP steering); opencode only between turns. */
export const harnessSteers: Record<HarnessId, boolean> = { claude: true, opencode: false, pi: true, codex: true, copilot: false };

const enterWhileBusy = storedChoice<EnterWhileBusy>("mirador-enter-while-busy", ["steer", "after-turn"], "steer");

export const setEnterWhileBusy = enterWhileBusy.set;
export const useEnterWhileBusy = enterWhileBusy.use;
