import type { HostProblem } from "../shared/host-problems.ts";
import { t } from "./i18n/index.ts";
import { errorText, problemText } from "./problem-text.ts";

/** What a failed request says, in the page's language when the host described the problem. */
/** A problem a reply carries, in the page's language when the host described it, else as the host said it. */
export const describedText = (english: string, about: HostProblem | undefined) => (about ? problemText(about, t.problems) : english);

/** A reply's optional problem in the page's language, keeping null for none. */
export const replyProblemText = ({ problem, problemAbout }: { problem: string | null; problemAbout?: HostProblem }) => problem && describedText(problem, problemAbout);

export const hostErrorText = (reply: { message: string; problem?: HostProblem }) => errorText(reply, t.problems);
