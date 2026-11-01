import { useSyncExternalStore } from "react";

/** A request to a pane that may first have to be shown: it waits here until the pane takes it. */
export function waitingRequest<Request>() {
  let waiting: Request | null = null;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return {
    request(request: Request) {
      waiting = request;
      changed();
    },
    take() {
      const request = waiting;
      waiting = null;
      changed();
      return request;
    },
    useWaiting: () => useSyncExternalStore(subscribe, () => waiting),
  };
}
