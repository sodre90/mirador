import { useEffect, useState } from "react";

/** How often the time an invite has left is told afresh. */
const EXPIRY_TOLD_EVERY_MS = 30_000;

export function useExpired(expiresAt: number) {
  const [now, setNow] = useState(Date.now);
  const expired = now >= expiresAt;
  useEffect(() => {
    if (expired) return;
    const timer = setTimeout(() => setNow(Date.now()), expiresAt - Date.now());
    const clock = setInterval(() => setNow(Date.now()), EXPIRY_TOLD_EVERY_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [expired, expiresAt]);
  return expired;
}
