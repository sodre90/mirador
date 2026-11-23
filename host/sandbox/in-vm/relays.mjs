// Inside a room's VM, which has no network: each port on the VM's own 127.0.0.1 passes its connections, byte for byte,
// to a unix socket of Mirador's on the Mac forwarded in. Once those sockets stop answering, as when Mirador is gone, the
// relays end, and the VM with them. usage: relays.mjs <port>=<socket> ...
import { connect, createServer } from "node:net";

const LOOK_EVERY_MS = Number(process.env.RELAYS_LOOK_EVERY_MS ?? 5_000);
const GIVE_UP_AFTER_MS = Number(process.env.RELAYS_GIVE_UP_AFTER_MS ?? 30_000);

const relays = process.argv.slice(2).map((spec) => {
  const [port, socket] = spec.split("=");
  return { port: Number(port), socket };
});

const answers = (socket) =>
  new Promise((answered) => {
    const probe = connect(socket);
    probe.setTimeout(LOOK_EVERY_MS, () => {
      probe.destroy();
      answered(false);
    });
    probe.on("connect", () => {
      probe.destroy();
      answered(true);
    });
    probe.on("error", () => answered(false));
  });

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
        const server = createServer((incoming) => {
          const outgoing = connect(socket);
          incoming.pipe(outgoing).pipe(incoming);
          const end = () => {
            incoming.destroy();
            outgoing.destroy();
          };
          incoming.on("error", end);
          outgoing.on("error", end);
        });
        server.listen(port, "127.0.0.1", listening);
      }),
  ),
);
endOnceMiradorIsGone();
console.log("relays ready");
