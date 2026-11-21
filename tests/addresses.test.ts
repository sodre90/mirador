import { expect, test } from "bun:test";
import { addressesThatAnswer, addressesUsed, loopbackNameFromAfar, rememberAddressUsed } from "../host/addresses.ts";

/** Stands in for one of this host's two servers: it answers the marker, or does not. */
function serverThatAnswers(answering = true) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      answering && new URL(request.url).pathname === "/mirador-here" ? Response.json({ mirador: true }) : new Response("not found", { status: 404 }),
  });
  const port = server.port!;
  return { port, origin: `http://127.0.0.1:${port}`, stop: () => server.stop(true) };
}

test("an address is offered only when it answers as this Mirador on both of its ports", async () => {
  const bothPorts = serverThatAnswers();
  const pageOnly = serverThatAnswers();
  const neither = serverThatAnswers(false);
  try {
    expect(await addressesThatAnswer([{ origin: bothPorts.origin, how: "devices" }], bothPorts.port)).toEqual([
      { origin: bothPorts.origin, canvasOrigin: bothPorts.origin, how: "devices" },
    ]);
    expect(await addressesThatAnswer([{ origin: pageOnly.origin, how: "devices" }], neither.port)).toEqual([]);
    expect(await addressesThatAnswer([{ origin: neither.origin, how: "tailnet" }], neither.port)).toEqual([]);
  } finally {
    for (const server of [bothPorts, pageOnly, neither]) server.stop();
  }
});

test("the canvas address is offered on the canvas port, alongside the address that answered", async () => {
  const pages = serverThatAnswers();
  const canvas = serverThatAnswers();
  try {
    expect(await addressesThatAnswer([{ origin: pages.origin, how: "tailnet" }], canvas.port)).toEqual([
      { origin: pages.origin, canvasOrigin: canvas.origin, how: "tailnet" },
    ]);
  } finally {
    pages.stop();
    canvas.stop();
  }
});

test("the addresses devices reached this host at are remembered, newest first, without this machine's own", () => {
  rememberAddressUsed("127.0.0.1:4600");
  rememberAddressUsed("localhost:4600");
  rememberAddressUsed(null);
  rememberAddressUsed("macbook.example.ts.net:4600");
  rememberAddressUsed("macbook.example.ts.net:4600");
  rememberAddressUsed("box.example.ts.net");

  expect(addressesUsed()).toEqual(["box.example.ts.net", "macbook.example.ts.net:4600"]);
  expect(addressesUsed()).not.toContain("127.0.0.1:4600");
});

test("a request names a loopback address of this host only from this computer, as every machine has one", () => {
  expect(["127.0.0.1:4600", "localhost:4600", "[::1]:4600"].map((host) => loopbackNameFromAfar(host, "192.168.1.20"))).toEqual([true, true, true]);
  expect(["127.0.0.1", "::1", "::ffff:127.0.0.1"].map((peer) => loopbackNameFromAfar("127.0.0.1:4600", peer))).toEqual([false, false, false]);
  expect(loopbackNameFromAfar("box.tailnet.ts.net", "100.64.0.7")).toBe(false);
});
