import { PROBLEM_HEADER, problemInHeader, type HostProblem } from "../shared/host-problems.ts";
import { t } from "./i18n/index.ts";
import { errorText } from "./problem-text.ts";

/** A problem a reply carries, in the page's language when the host described it, else as the host said it. */
export const describedText = (english: string, about: HostProblem | undefined) => errorText({ message: english, problem: about }, t.problems);

/** A reply's optional problem in the page's language, keeping null for none. */
export const replyProblemText = ({ problem, problemAbout }: { problem: string | null; problemAbout?: HostProblem }) => problem && describedText(problem, problemAbout);

/** What a failed request says, in the page's language when the host described the problem. */
export const hostErrorText = (reply: { message: string; problem?: HostProblem }) => errorText(reply, t.problems);

/** Why the host refused a request, in the page's language when its reply names the problem; else its English, or `otherwise` when it said nothing. */
export async function refusalText(response: Response, otherwise: string) {
  const english = await response.text();
  return describedText(english || otherwise, problemInHeader(response.headers.get(PROBLEM_HEADER)));
}
