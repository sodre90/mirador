// Inside a sandbox's VM, which has no network: each port on the VM's own 127.0.0.1 passes its connections, byte for byte,
// to a unix socket of Mirador's on this computer forwarded in, once Mirador has said by a first byte that it took it. Once
// those sockets stop answering, as when Mirador is gone, the relays end, and the VM with them.
// usage: relays.mjs <port>=<socket> ...
import { connect, createServer } from "node:net";

const LOOK_EVERY_MS = Number(process.env.RELAYS_LOOK_EVERY_MS ?? 5_000);
const GIVE_UP_AFTER_MS = Number(process.env.RELAYS_GIVE_UP_AFTER_MS ?? 30_000);
const TAKEN_WITHIN_MS = 10_000;
const MOST_TRIES = 5;
const AGAIN_AFTER_MS = 30;

const relays = process.argv.slice(2).map((spec) => {
  const [port, socket] = spec.split("=");
  return { port: Number(port), socket };
});

const takenOnFirstTry = (socket) =>
  new Promise((taken, lost) => {
    const outgoing = connect(socket);
    const end = () => {
      outgoing.destroy();
      lost(new Error(`Mirador took no connection to ${socket}`));
    };
    outgoing.setTimeout(TAKEN_WITHIN_MS, end);
    outgoing.on("error", end);
    outgoing.on("close", end);
    outgoing.once("data", (said) => {
      outgoing.setTimeout(0);
      outgoing.pause();
      if (said.length > 1) outgoing.unshift(said.subarray(1));
      taken(outgoing);
    });
  });

/** A connection Mirador hasn't said it took in time is made again, as nothing was said on it yet. */
async function taken(socket) {
  for (let tries = 1; ; tries++) {
    try {
      return await takenOnFirstTry(socket);
    } catch (lost) {
      if (tries === MOST_TRIES) throw lost;
      await new Promise((again) => setTimeout(again, AGAIN_AFTER_MS * tries));
    }
  }
}

async function answers(socket) {
  const probe = await taken(socket).catch(() => null);
  probe?.destroy();
  return probe !== null;
}

async function pass(incoming, socket) {
  incoming.on("error", () => incoming.destroy());
  const outgoing = await taken(socket).catch(() => null);
  const end = () => {
    incoming.destroy();
    outgoing?.destroy();
  };
  if (!outgoing || incoming.destroyed) return end();
  incoming.on("error", end);
  outgoing.on("error", end);
  incoming.pipe(outgoing).pipe(incoming);
}

function endOnceMiradorIsGone() {
  let lastAnswered = Date.now();
  setInterval(async () => {
    const answered = await Promise.all(relays.map(({ socket }) => answers(socket)));
    if (answered.every(Boolean)) lastAnswered = Date.now();
    else if (Date.now() - lastAnswered >= GIVE_UP_AFTER_MS) {
      console.log("Mirador's sockets stopped answering");
      process.exit(1);
    }
  }, LOOK_EVERY_MS);
}

await Promise.all(
  relays.map(
    ({ port, socket }) =>
      new Promise((listening) => {
        const server = createServer((incoming) => void pass(incoming, socket));
        server.listen(port, "127.0.0.1", listening);
      }),
  ),
);
endOnceMiradorIsGone();
console.log("relays ready");
