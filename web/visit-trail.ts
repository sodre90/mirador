/** The conversations the user went through, as a browser's back and forward lists hold the pages it went through. */
export interface VisitTrail {
  back: string[];
  current: string | null;
  forward: string[];
}

export type Step = "back" | "forward";

export const isStep = (value: unknown): value is Step => value === "back" || value === "forward";

export const EMPTY_TRAIL: VisitTrail = { back: [], current: null, forward: [] };

export function visited(trail: VisitTrail, conversationId: string | null): VisitTrail {
  if (conversationId === trail.current) return trail;
  const back = trail.current === null ? trail.back : [...trail.back.filter((id) => id !== trail.current), trail.current];
  return { back: back.filter((id) => id !== conversationId), current: conversationId, forward: [] };
}

/** The trail after one step, past conversations that are gone; the same trail where there is nowhere to go. */
export function stepped(trail: VisitTrail, step: Step, exists: (conversationId: string) => boolean): VisitTrail {
  const ahead = (step === "back" ? trail.back : trail.forward).filter(exists);
  const behind = (step === "back" ? trail.forward : trail.back).filter(exists);
  const destination = ahead.at(-1);
  if (destination === undefined) return trail;
  const left = trail.current !== null && exists(trail.current) ? [...behind, trail.current] : behind;
  const rest = ahead.slice(0, -1);
  return step === "back" ? { back: rest, current: destination, forward: left } : { back: left, current: destination, forward: rest };
}
