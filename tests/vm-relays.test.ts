import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "vm-relays-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const freePort = () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const { port } = server;
  server.stop(true);
  return port!;
};

test("a room's VM relays end once Mirador's sockets stop answering, which stops the VM, and not while they answer", async () => {
  const socket = join(scratch, "model.sock");
  const mirador = createServer((connection) => connection.end()).listen(socket);
  const relays = Bun.spawn([process.execPath, join(import.meta.dir, "../host/sandbox/in-vm/relays.mjs"), `${freePort()}=${socket}`], {
    env: { ...process.env, RELAYS_LOOK_EVERY_MS: "50", RELAYS_GIVE_UP_AFTER_MS: "300" },
    stdout: "pipe",
  });
  try {
    await Bun.sleep(600);
    expect(relays.exitCode).toBeNull();

    await new Promise((closed) => mirador.close(closed));
    const exitCode = await Promise.race([relays.exited, Bun.sleep(3_000).then(() => "still running")]);
    expect(exitCode).toBe(1);
    expect(await new Response(relays.stdout).text()).toContain("Mirador's sockets stopped answering");
  } finally {
    relays.kill();
  }
});
