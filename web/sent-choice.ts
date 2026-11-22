import { useState } from "react";

/** A choice sent to the host, over the value the host kept when it was sent. */
export interface SentChoice<T> {
  value: T;
  over: T;
}

/** What a control shows: the choice sent, while the host still keeps the value it was sent over; else the host's own. */
export const shownChoice = <T>(sent: SentChoice<T> | null, kept: T): T => (sent && Object.is(sent.over, kept) ? sent.value : kept);

/**
 * A choice the host keeps, shown as made from the moment it is sent: the sent value stands in for the host's until the
 * host's changes, so a radio, switch or select doesn't flick back while the host's answer is on its way.
 */
export function useSentChoice<T>(kept: T, send: (value: T) => void): [T, (value: T) => void] {
  const [sent, setSent] = useState<SentChoice<T> | null>(null);
  if (sent && !Object.is(sent.over, kept)) setSent(null);
  const choose = (value: T) => {
    setSent({ value, over: kept });
    send(value);
  };
  return [shownChoice(sent, kept), choose];
}
