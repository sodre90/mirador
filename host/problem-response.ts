import { englishProblem, HostProblemError, PROBLEM_HEADER, type HostProblem } from "../shared/host-problems.ts";

/** A problem past this, as with a command's output in it, goes in the English body only, as headers have a size limit. */
const MAX_PROBLEM_HEADER_LENGTH = 4096;

/** A refusal the page can say in its own language: English in the body, for the phone app and scripts, and the problem in a header. */
export function problemResponse(problem: HostProblem, status: number, english = englishProblem(problem)) {
  const named = encodeURIComponent(JSON.stringify(problem));
  return new Response(english, { status, headers: named.length <= MAX_PROBLEM_HEADER_LENGTH ? { [PROBLEM_HEADER]: named } : {} });
}

export const errorResponse = (error: unknown, status: number) =>
  error instanceof HostProblemError ? problemResponse(error.problem, status, error.message) : new Response(error instanceof Error ? error.message : String(error), { status });
