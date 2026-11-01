import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

export interface InstanceLock {
  release(): void;
}

async function reachesRunningInstance(socketPath: string) {
  try {
    const socket = await Bun.connect({ unix: socketPath, socket: { data() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * Linux and Windows tell a running app nothing when it is launched again (macOS sends "reopen"), so a second launch
 * connects to the first one's socket, which opens its window, and gets null back so it can quit. The newcomer hangs up:
 * had the first one closed the connection, the newcomer could see it reset before it opened and start a second app.
 * Binding is the claim, so of two launches at the same moment only one gets the socket.
 */
export async function claimSingleInstance(socketPath: string, onLaunchedAgain: () => void): Promise<InstanceLock | null> {
  mkdirSync(dirname(socketPath), { recursive: true });
  const listener = listenAt(socketPath, onLaunchedAgain) ?? (await listenInPlaceOfCrashedApp(socketPath, onLaunchedAgain));
  if (!listener) return null;
  return {
    release() {
      listener.stop(true);
      rmSync(socketPath, { force: true });
    },
  };
}

/** Null when the socket file is taken, by a running app or one that crashed. */
function listenAt(socketPath: string, onLaunchedAgain: () => void) {
  try {
    return Bun.listen({ unix: socketPath, socket: { open: onLaunchedAgain, data() {} } });
  } catch (error) {
    if ((error as { code?: string }).code === "EADDRINUSE") return null;
    throw error;
  }
}

/** Two launches that both find a crashed app's socket can still both start: removing the file is not part of the claim. */
async function listenInPlaceOfCrashedApp(socketPath: string, onLaunchedAgain: () => void) {
  if (await reachesRunningInstance(socketPath)) return null;
  rmSync(socketPath, { force: true });
  return listenAt(socketPath, onLaunchedAgain);
}
