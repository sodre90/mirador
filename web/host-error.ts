import type { HostProblem } from "../shared/host-problems.ts";
import { t } from "./i18n/index.ts";
import { errorText } from "./problem-text.ts";

/** What a failed request says, in the page's language when the host described the problem. */
export const hostErrorText = (reply: { message: string; problem?: HostProblem }) => errorText(reply, t.problems);
