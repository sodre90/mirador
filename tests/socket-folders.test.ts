import { afterAll, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeLeftSocketFolders } from "../host/sandbox/socket-folders.ts";

const parent = mkdtempSync(join(tmpdir(), "sf-"));
const listening: Server[] = [];
afterAll(() => {
  listening.forEach((server) => server.close());
  rmSync(parent, { recursive: true, force: true });
});

const HOUR_AGO = new Date(Date.now() - 3_600_000);

function folder(name: string) {
  const path = join(parent, name);
  mkdirSync(path);
  return path;
}

const madeLongAgo = (path: string) => utimesSync(path, HOUR_AGO, HOUR_AGO);

async function listenedOn(socket: string) {
  const server = createServer();
  await new Promise<void>((listened) => server.listen(socket, listened));
  listening.push(server);
}

/** A socket whose host was killed: still there, and refusing every connection. */
async function leftBehind(socket: string) {
  const host = Bun.spawn([process.execPath, "-e", `require("node:net").createServer().listen(${JSON.stringify(socket)}, () => console.log("listening"))`], { stdout: "pipe" });
  await host.stdout.getReader().read();
  host.kill("SIGKILL");
  await host.exited;
}

test.skipIf(process.platform === "win32")(
  "the socket folders hosts that are gone left are removed, and never one a running host listens on, a newly made one, or one that isn't Mirador's",
  async () => {
    const gone = folder("mirador-sandbox-gone");
    await leftBehind(join(gone, "c.sock"));
    madeLongAgo(gone);
    const emptyRoomsOfAnOldLayout = folder("mirador-sandbox-old");
    mkdirSync(join(emptyRoomsOfAnOldLayout, "82f3e9c6"));
    madeLongAgo(emptyRoomsOfAnOldLayout);
    const live = folder("mirador-sandbox-live");
    await leftBehind(join(live, "m.sock"));
    await listenedOn(join(live, "c.sock"));
    madeLongAgo(live);
    const newlyMade = folder("mirador-sandbox-new");
    await leftBehind(join(newlyMade, "c.sock"));
    const someoneElses = folder("mirador-sandbox-notes");
    writeFileSync(join(someoneElses, "notes.txt"), "mine");
    madeLongAgo(someoneElses);
    const otherName = folder("another-folder");
    madeLongAgo(otherName);
    const link = join(parent, "mirador-sandbox-link");
    symlinkSync(gone, link);

    await removeLeftSocketFolders(parent);

    expect([gone, emptyRoomsOfAnOldLayout].map(existsSync)).toEqual([false, false]);
    expect([live, newlyMade, someoneElses, otherName].map(existsSync)).toEqual([true, true, true, true]);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  },
);
