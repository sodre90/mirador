import { expect, test } from "bun:test";
import { isPrivateHostname, wayToMachine } from "../host/machine-trust.ts";
import { authorityFingerprintIn, inviteIn, inviteLink, isHidden, isRoomInviteLink, joinCodeIn, machineAddress, machinesSeen, roomInviteLink, tunnelIn } from "../shared/machines.ts";
import type { Machine, MachineSeen } from "../shared/model.ts";
import { checkedDeviceTunnel, tunnelOrigin, type InviteTunnel } from "../shared/tunnel.ts";

test("a machine is added by its name on the network, its address or an invite link from it", () => {
  expect(machineAddress("home-server.tailnet.ts.net")).toEqual({ origin: "https://home-server.tailnet.ts.net", joinCode: null, authorityFingerprint: null, forRoom: false, tunnel: null });
  expect(machineAddress(" https://home-server.tailnet.ts.net/some/page ")).toMatchObject({ origin: "https://home-server.tailnet.ts.net", joinCode: null });
  expect(machineAddress("http://192.168.1.20:4600")).toMatchObject({ origin: "http://192.168.1.20:4600", joinCode: null });
  expect(machineAddress("https://home-server.tailnet.ts.net/#/join/ABCD-EFGH-JKLM")).toEqual({
    origin: "https://home-server.tailnet.ts.net",
    joinCode: "ABCD-EFGH-JKLM",
    authorityFingerprint: null,
    forRoom: false,
    tunnel: null,
  });
});

const fingerprint = "q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x_-";

test("an invite link from a machine with its own certificate authority carries the authority's fingerprint after the code", () => {
  const link = inviteLink("https://box.local:4602", "ABCD-EFGH-JKLM", fingerprint);
  expect(link).toBe(`https://box.local:4602/#/join/ABCD-EFGH-JKLM/${fingerprint}`);
  expect(machineAddress(link)).toEqual({ origin: "https://box.local:4602", joinCode: "ABCD-EFGH-JKLM", authorityFingerprint: fingerprint, forRoom: false, tunnel: null });
  expect(joinCodeIn(`#/join/ABCD-EFGH-JKLM/${fingerprint}`)).toBe("ABCD-EFGH-JKLM");
  expect(authorityFingerprintIn(`#/join/ABCD-EFGH-JKLM/${fingerprint}`)).toBe(fingerprint);
  expect(inviteLink("https://box.example.ts.net", "ABCD-EFGH-JKLM")).toBe("https://box.example.ts.net/#/join/ABCD-EFGH-JKLM");
});

test("an invite link carries a fingerprint of any length, so a truncated one still gives the code and not the whole link", () => {
  expect(inviteIn(inviteLink("https://box.example", "ABCD-EFGH-JKLM", "short-fp"))).toEqual({ code: "ABCD-EFGH-JKLM", authorityFingerprint: "short-fp", tunnel: null });
  const truncated = fingerprint.slice(0, 42);
  expect(inviteIn(`https://box.example/#/join/ABCD-EFGH-JKLM/${truncated}`)).toEqual({ code: "ABCD-EFGH-JKLM", authorityFingerprint: truncated, tunnel: null });
});

test("a room invite's link says it is one, so the machine it adds is joined as a person, and gives its code and fingerprint like a device invite's", () => {
  const link = roomInviteLink("https://box.local:4602", "ABCD-EFGH-JKLM", fingerprint);
  expect(link).toBe(`https://box.local:4602/#/room-invite/ABCD-EFGH-JKLM/${fingerprint}`);
  expect(machineAddress(link)).toEqual({ origin: "https://box.local:4602", joinCode: "ABCD-EFGH-JKLM", authorityFingerprint: fingerprint, forRoom: true, tunnel: null });
  expect(machineAddress(roomInviteLink("https://box.example.ts.net", "ABCD-EFGH-JKLM"))).toEqual({
    origin: "https://box.example.ts.net",
    joinCode: "ABCD-EFGH-JKLM",
    authorityFingerprint: null,
    forRoom: true,
    tunnel: null,
  });
  expect(inviteIn(link)).toEqual({ code: "ABCD-EFGH-JKLM", authorityFingerprint: fingerprint, tunnel: null });
  expect(isRoomInviteLink(new URL(link).hash)).toBe(true);
  expect(isRoomInviteLink(new URL(inviteLink("https://box.local:4602", "ABCD-EFGH-JKLM", fingerprint)).hash)).toBe(false);
  expect(joinCodeIn(new URL(link).hash)).toBeNull();
});

const tunnel: InviteTunnel = {
  hostKey: "TfdU+RVSAYU/VwqNJh5dDtXFyyZCkHgiPG8knt29NU0=",
  hostAddress: "fd12:3456:789a:1::1",
  port: 4600,
  broker: { address: "203.0.113.7:47800", key: "3Q85Sl/Vr65bJz+OyEhIQtyAeBRDJQqqkVWJgryS2WE=" },
  joinKey: "tne9fR0CU9toO26+5x2ggHdtuq+Z0kfmk/nqAnFmkyg=",
  joinAddress: "fd12:3456:789a:1:8f1e:22c4:aa01:93b7",
  name: "studio",
};

test("an invite link from a machine that connects peer to peer carries how to reach it after the code, and still gives the code", () => {
  const link = inviteLink("https://box.local:4602", "ABCD-EFGH-JKLM", fingerprint, tunnel);
  const { hash } = new URL(link);
  expect(link).toMatch(/^https:\/\/box\.local:4602\/#\/join\/ABCD-EFGH-JKLM\/[\w-]+\?tunnel=[\w-]+$/);
  expect(tunnelIn(hash)).toEqual(tunnel);
  expect(joinCodeIn(hash)).toBe("ABCD-EFGH-JKLM");
  expect(authorityFingerprintIn(hash)).toBe(fingerprint);
  expect(inviteIn(link)).toEqual({ code: "ABCD-EFGH-JKLM", authorityFingerprint: fingerprint, tunnel: null });
  expect(tunnelIn(new URL(inviteLink("https://box.local", "ABCD-EFGH-JKLM", null, tunnel)).hash)).toEqual(tunnel);
  expect(tunnelIn("#/join/ABCD-EFGH-JKLM?tunnel=bm90LWEtdHVubmVs")).toBeNull();
  expect(tunnelIn("#/join/ABCD-EFGH-JKLM")).toBeNull();
  const misnamed = btoa(JSON.stringify({ ...tunnel, name: 7 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  expect(tunnelIn(`#/join/ABCD-EFGH-JKLM?tunnel=${misnamed}`)).toBeNull();
});

const encoded = (fields: object) => btoa(JSON.stringify(fields)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("a room invite's link carries the way through the machine's tunnel, at the machine's address in the tunnel or at an address of its own", () => {
  const throughTunnelOnly = roomInviteLink(tunnelOrigin(tunnel), "ROOM-ABCD-EFGH-JKLM", null, tunnel);
  expect(throughTunnelOnly).toMatch(/^http:\/\/\[fd12:3456:789a:1::1\]:4600\/#\/room-invite\/ROOM-ABCD-EFGH-JKLM\?tunnel=[\w-]+$/);
  expect(machineAddress(throughTunnelOnly)).toEqual({ origin: "http://[fd12:3456:789a:1::1]:4600", joinCode: "ROOM-ABCD-EFGH-JKLM", authorityFingerprint: null, forRoom: true, tunnel });
  const withAddress = roomInviteLink("https://box.local:4602", "ROOM-ABCD-EFGH-JKLM", fingerprint, tunnel);
  expect(machineAddress(withAddress)).toEqual({ origin: "https://box.local:4602", joinCode: "ROOM-ABCD-EFGH-JKLM", authorityFingerprint: fingerprint, forRoom: true, tunnel });
  expect(inviteIn(withAddress)).toEqual({ code: "ROOM-ABCD-EFGH-JKLM", authorityFingerprint: fingerprint, tunnel });
  expect(isRoomInviteLink(new URL(withAddress).hash)).toBe(true);
});

test("a room invite's link with a tunnel joins through it wherever this computer dials tunnels, even with an address of its own that answers", () => {
  const withAddress = machineAddress(roomInviteLink("https://box.local:4602", "ROOM-ABCD-EFGH-JKLM", fingerprint, tunnel))!;
  expect(wayToMachine(withAddress, true)).toEqual({ origin: tunnelOrigin(tunnel), tunnel, trustsOnFirstUse: false });
  expect(wayToMachine(machineAddress("https://box.local:4602")!, true)).toEqual({ origin: "https://box.local:4602", tunnel: null, trustsOnFirstUse: true });
});

test("where this computer can't dial the tunnel, the link's code goes to its address only over HTTPS trusted by more than first use, or plain HTTP within a private network", () => {
  const withoutTunnelHere = (origin: string, authorityFingerprint: string | null = null) => () =>
    wayToMachine(machineAddress(roomInviteLink(origin, "ROOM-ABCD-EFGH-JKLM", authorityFingerprint, tunnel))!, false);
  expect(withoutTunnelHere("https://box.local:4602", fingerprint)()).toEqual({ origin: "https://box.local:4602", tunnel: null, trustsOnFirstUse: false });
  expect(withoutTunnelHere("http://192.168.1.20:4600")()).toEqual({ origin: "http://192.168.1.20:4600", tunnel: null, trustsOnFirstUse: false });
  expect(withoutTunnelHere("http://203.0.113.7:4600")).toThrow("the invite's address, http://203.0.113.7:4600, is not protected by HTTPS");
  expect(withoutTunnelHere("http://box.example.com:4600")).toThrow("is not protected by HTTPS");
  expect(withoutTunnelHere(tunnelOrigin(tunnel))).toThrow("Peer to peer isn't available on this computer, and this invite needs it");
});

test("only loopback, private, Tailscale and link-local addresses are within a private network", () => {
  const privateOnes = ["localhost", "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "100.64.0.1", "100.127.255.254", "169.254.1.1", "[::1]", "[fd7a:115c:a1e0::1]", "[fe80::1]"];
  const publicOnes = ["8.8.8.8", "172.32.0.1", "192.169.0.1", "100.128.0.1", "11.0.0.1", "[2001:db8::1]", "box.local", "example.com", "[::ffff:c0a8:101]"];
  expect(privateOnes.filter((hostname) => !isPrivateHostname(hostname))).toEqual([]);
  expect(publicOnes.filter(isPrivateHostname)).toEqual([]);
});

test("a name in any script reaches the other end of an invite whole", () => {
  const named = { ...tunnel, name: "Zhāng 的电脑 🖥" };
  expect(tunnelIn(new URL(inviteLink("https://box.local", "ABCD-EFGH-JKLM", null, named)).hash)).toEqual(named);
});

test("an invite's tunnel is turned away unless every field is what a host makes, and keeps no field it does not know", () => {
  const roomLinkWith = (fields: object) => `https://box.local/#/room-invite/ROOM-ABCD-EFGH-JKLM?tunnel=${encoded(fields)}`;
  const tunnelOfLink = (fields: object) => machineAddress(roomLinkWith(fields))?.tunnel ?? null;
  expect(tunnelOfLink(tunnel)).toEqual(tunnel);
  expect(tunnelOfLink({ ...tunnel, extra: "kept?" })).toEqual(tunnel);
  const refused: object[] = [
    { ...tunnel, hostKey: "not a key" },
    { ...tunnel, hostKey: "TfdU+RVSAYU/VwqNJh5dDtXFyyZCkHgiPG8knt29NU1=" },
    { ...tunnel, hostKey: "TfdU-RVSAYU_VwqNJh5dDtXFyyZCkHgiPG8knt29NU0=" },
    { ...tunnel, joinKey: `${tunnel.joinKey}A` },
    { ...tunnel, broker: { ...tunnel.broker, key: "short=" } },
    { ...tunnel, hostAddress: "203.0.113.7" },
    { ...tunnel, hostAddress: "2001:db8::1" },
    { ...tunnel, hostAddress: "fd12::1%en0" },
    { ...tunnel, joinAddress: "fd12:3456:789a:1::1 --udp=0.0.0.0:1" },
    { ...tunnel, port: 0 },
    { ...tunnel, port: 4600.5 },
    { ...tunnel, port: "4600" },
    { ...tunnel, canvasPort: 70000 },
    { ...tunnel, broker: { ...tunnel.broker, address: "--broker-key=x:1" } },
    { ...tunnel, broker: { ...tunnel.broker, address: "203.0.113.7" } },
    { ...tunnel, broker: { ...tunnel.broker, address: "broker example:47800" } },
    { ...tunnel, broker: { ...tunnel.broker, address: "broker.example:99999" } },
    { ...tunnel, broker: "203.0.113.7:47800" },
    { ...tunnel, name: 7 },
    { ...tunnel, name: "x".repeat(201) },
  ];
  refused.forEach((fields) => expect(tunnelOfLink(fields)).toBeNull());
  expect(tunnelOfLink({ ...tunnel, broker: { ...tunnel.broker, address: "p2p.example.com:47800" } })?.broker.address).toBe("p2p.example.com:47800");
  expect(tunnelOfLink({ ...tunnel, broker: { ...tunnel.broker, address: "[fd00::5]:47800" } })?.broker.address).toBe("[fd00::5]:47800");
  expect(machineAddress("https://box.local/#/room-invite/ROOM-ABCD-EFGH-JKLM?tunnel=bm90LWEtdHVubmVs")).toBeNull();
});

test("a room invite's link whose tunnel isn't one is no link at all, so it never sends the code to the address in it", () => {
  const broken = { ...tunnel, hostKey: "not a key" };
  expect(machineAddress(`http://[${tunnel.hostAddress}]:4600/#/room-invite/ROOM-ABCD-EFGH-JKLM?tunnel=${encoded(broken)}`)).toBeNull();
  expect(inviteIn(`http://[${tunnel.hostAddress}]:4600/#/room-invite/ROOM-ABCD-EFGH-JKLM?tunnel=${encoded(broken)}`)).toEqual({ code: "ROOM-ABCD-EFGH-JKLM", authorityFingerprint: null, tunnel: null });
});

test("a device's place a host answered with is taken only with every field as a host makes it", () => {
  const { joinKey: _joinKey, joinAddress, name: _name, ...places } = tunnel;
  expect(checkedDeviceTunnel({ ...places, deviceAddress: joinAddress, token: "not kept" })).toEqual({ ...places, deviceAddress: joinAddress });
  expect(checkedDeviceTunnel({ ...places, deviceAddress: "127.0.0.1" })).toBeNull();
  expect(checkedDeviceTunnel({ ...places, hostKey: "nope", deviceAddress: joinAddress })).toBeNull();
  expect(checkedDeviceTunnel(null)).toBeNull();
});

test("what is not a web address is not a machine", () => {
  expect(machineAddress("")).toBeNull();
  expect(machineAddress("ftp://files.example")).toBeNull();
  expect(machineAddress("not a host name")).toBeNull();
});

test("only an invite link's #part carries a code", () => {
  expect(joinCodeIn("#/join/ABCD-EFGH-JKLM")).toBe("ABCD-EFGH-JKLM");
  expect(joinCodeIn("#/c/some-conversation")).toBeNull();
  expect(joinCodeIn("")).toBeNull();
});

test("takes the invite code and certificate authority's fingerprint out of a pasted invite link, or the code as typed", () => {
  expect(inviteIn("https://home-server.example.ts.net/#/join/ABCD-EFGH-JKLM")).toEqual({ code: "ABCD-EFGH-JKLM", authorityFingerprint: null, tunnel: null });
  expect(inviteIn(`https://home-server.local:4602/#/join/ABCD-EFGH-JKLM/${fingerprint}`)).toEqual({ code: "ABCD-EFGH-JKLM", authorityFingerprint: fingerprint, tunnel: null });
  expect(inviteIn("  ABCD-EFGH-JKLM \n")).toEqual({ code: "ABCD-EFGH-JKLM", authorityFingerprint: null, tunnel: null });
});

const machine = (id: string, origin: string, hostId: string | null = null): Machine => ({ id, name: id, origin, createdAt: 1, relayPort: 4620, joined: true, color: null, hostId, outOfRooms: false, asPerson: false, relayKey: null, peerToPeer: false });
const seen = (name: string, origin: string, hostId: string | null = null): MachineSeen => ({ name, origin, hostId });

test("the machines this computer's machines have joined are offered once each, through the first that lists them, unless added here", () => {
  const laptop = machine("laptop", "https://laptop.example.ts.net:4700");
  const server = machine("server", "https://server.example.ts.net");
  const statuses = [
    { machineId: "server", reachable: true, waiting: [], joinedThere: [seen("Pi", "https://pi.example.ts.net"), seen("Laptop", laptop.origin)] },
    { machineId: "laptop", reachable: false, waiting: [], joinedThere: [seen("Home server", server.origin), seen("Raspberry", "https://pi.example.ts.net"), seen("NAS", "https://nas.example.ts.net")] },
  ];
  expect(machinesSeen([laptop, server], statuses)).toEqual([
    { name: "Raspberry", origin: "https://pi.example.ts.net", hostId: null, throughMachineId: "laptop" },
    { name: "NAS", origin: "https://nas.example.ts.net", hostId: null, throughMachineId: "laptop" },
  ]);
  expect(machinesSeen([server], statuses)).toEqual([
    { name: "Pi", origin: "https://pi.example.ts.net", hostId: null, throughMachineId: "server" },
    { name: "Laptop", origin: laptop.origin, hostId: null, throughMachineId: "server" },
  ]);
});

test("a machine known at two addresses is one machine once its id is known, both when added here and when offered twice", () => {
  const laptop = machine("laptop", "https://laptop.example.ts.net:4700");
  const server = machine("server", "https://server.example.ts.net", "server-id");
  const statuses = [
    {
      machineId: "laptop",
      reachable: true,
      waiting: [],
      joinedThere: [seen("Home server", "https://192.168.1.20:4700", "server-id"), seen("NAS", "https://nas.example.ts.net", "nas-id"), seen("NAS on the LAN", "https://192.168.1.30:4700", "nas-id")],
    },
  ];
  expect(machinesSeen([laptop, server], statuses)).toEqual([{ name: "NAS", origin: "https://nas.example.ts.net", hostId: "nas-id", throughMachineId: "laptop" }]);
});

test("a hidden machine is the one at its address, or with its id at another", () => {
  const hidden = [seen("Pi", "https://pi.example.ts.net"), seen("NAS", "https://nas.example.ts.net", "nas-id")];
  expect(isHidden(seen("Raspberry", "https://pi.example.ts.net", "pi-id"), hidden)).toBe(true);
  expect(isHidden(seen("NAS on the LAN", "https://192.168.1.30:4700", "nas-id"), hidden)).toBe(true);
  expect(isHidden(seen("Build box", "https://build.example.ts.net"), hidden)).toBe(false);
  expect(isHidden(seen("Unknown", "https://other.example.ts.net", null), [seen("Other", "https://another.example.ts.net", null)])).toBe(false);
});
