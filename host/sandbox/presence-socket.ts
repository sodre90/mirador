import { chmod, rm } from "node:fs/promises";
import type { RunningSocket } from "./model-proxy.ts";

/** A unix socket that closes each connection as it opens, reading and writing nothing: whoever connects only learns that Mirador is there. */
export async function startPresenceSocket(socketPath: string): Promise<RunningSocket> {
  await rm(socketPath, { force: true });
  const listener = Bun.listen({ unix: socketPath, socket: { open: (connection) => connection.terminate(), data: () => {} } });
  await chmod(socketPath, 0o600);
  return {
    async stop() {
      listener.stop(true);
      await rm(socketPath, { force: true });
    },
  };
}
