import { HostNotifications, openWebSocket } from "../desktop/src/core/host-notifications.ts";
import { newerVersionLabel } from "../shared/newer-version.ts";

/** Listens to a test host the way the desktop app does, printing a line when connected and one per notification it would show. */
const [origin, token, builtFromCode = null] = process.argv.slice(2) as [string, string, string?];

/** Stdin ends when the spec's worker goes away, as it does after a test times out without stopping this notifier. */
process.stdin.on("end", () => process.exit());
process.stdin.resume();

new HostNotifications({
  origin,
  token: () => token,
  show: (notification) => console.log(JSON.stringify(notification)),
  showWaiting: ({ count, mostUrgent }) => console.log(`waiting ${count}${mostUrgent ? ` ${mostUrgent}` : ""}`),
  showRunningTurnsCount: (count) => console.log(`running-turns ${count}`),
  showNewerVersion: (newerVersion) => newerVersion && console.log(`newer: ${newerVersionLabel(newerVersion)}`),
  builtFromCode,
  open: (url, headers) => {
    const socket = openWebSocket(url, headers) as WebSocket;
    socket.addEventListener("open", () => console.log("connected"));
    return socket;
  },
}).start();
