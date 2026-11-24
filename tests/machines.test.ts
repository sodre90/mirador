import { expect, test } from "bun:test";
import { isPrivateHostname, wayToMachine } from "../host/machine-trust.ts";
import {
  authorityFingerprintIn,
  fittedMachineName,
  hashOfMiradorLink,
  inviteConnectFor,
  inviteIn,
  inviteLink,
  isHidden,
  isRoomInviteLink,
  joinCodeIn,
  joinedRoomsIn,
  machineAddress,
  machinesSeen,
  MOST_JOINED_ROOMS,
  roomInviteLink,
  roomInviteText,
  tunnelIn,
  withJoinedRoom,
  withoutJoinedRoom,
  withReadings,
} from "../shared/machines.ts";
import { MOST_COUNTED } from "../shared/room-reading.ts";
import type { Machine, MachineSeen } from "../shared/model.ts";
import { checkedDeviceTunnel, tunnelOrigin, type InviteTunnel } from "../shared/tunnel.ts";

test("a machine's name is kept on one line, trimmed, and no longer than a device's lists fit", () => {
  expect(fittedMachineName("  Home\nserver  ")).toBe("Home server");
  expect(fittedMachineName("x".repeat(60))).toBe("x".repeat(40));
  expect(fittedMachineName(`${"x".repeat(39)} tail`)).toBe("x".repeat(39));
  expect(fittedMachineName("   ")).toBe("");
});

test("a machine is added by its name on the network, its address or an invite link from it", () => {
  expect(machineAddress("home-server.tailnet.ts.net")).toEqual({ origin: "https://home-server.tailnet.ts.net", joinCode: null, authorityFingerprint: null, forRoom: false, tunnel: null, name: null });
  expect(machineAddress(" https://home-server.tailnet.ts.net/some/page ")).toMatchObject({ origin: "https://home-server.tailnet.ts.net", joinCode: null });
  expect(machineAddress("http://192.168.1.20:4600")).toMatchObject({ origin: "http://192.168.1.20:4600", joinCode: null });
  expect(machineAddress("https://home-server.tailnet.ts.net/#/join/ABCD-EFGH-JKLM")).toEqual({
    origin: "https://home-server.tailnet.ts.net",
    joinCode: "ABCD-EFGH-JKLM",
    authorityFingerprint: null,
    forRoom: false,
    tunnel: null,
    name: null,
  });
});

const fingerprint = "q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x_-";

test("an invite link from a machine with its own certificate authority carries the authority's fingerprint after the code", () => {
  const link = inviteLink("https://box.local:4602", "ABCD-EFGH-JKLM", fingerprint);
  expect(link).toBe(`https://box.local:4602/#/join/ABCD-EFGH-JKLM/${fingerprint}`);
  expect(machineAddress(link)).toEqual({ origin: "https://box.local:4602", joinCode: "ABCD-EFGH-JKLM", authorityFingerprint: fingerprint, forRoom: false, tunnel: null, name: null });
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
  expect(machineAddress(link)).toEqual({ origin: "https://box.local:4602", joinCode: "ABCD-EFGH-JKLM", authorityFingerprint: fingerprint, forRoom: true, tunnel: null, name: null });
  expect(machineAddress(roomInviteLink("https://box.example.ts.net", "ABCD-EFGH-JKLM"))).toEqual({
    origin: "https://box.example.ts.net",
    joinCode: "ABCD-EFGH-JKLM",
    authorityFingerprint: null,
    forRoom: true,
    tunnel: null,
    name: null,
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
  expect(machineAddress(throughTunnelOnly)).toEqual({ origin: "http://[fd12:3456:789a:1::1]:4600", joinCode: "ROOM-ABCD-EFGH-JKLM", authorityFingerprint: null, forRoom: true, tunnel, name: null });
  const withAddress = roomInviteLink("https://box.local:4602", "ROOM-ABCD-EFGH-JKLM", fingerprint, tunnel);
  expect(machineAddress(withAddress)).toEqual({ origin: "https://box.local:4602", joinCode: "ROOM-ABCD-EFGH-JKLM", authorityFingerprint: fingerprint, forRoom: true, tunnel, name: null });
  expect(inviteIn(withAddress)).toEqual({ code: "ROOM-ABCD-EFGH-JKLM", authorityFingerprint: fingerprint, tunnel });
  expect(isRoomInviteLink(new URL(withAddress).hash)).toBe(true);
});

test("a room invite's link with a tunnel joins through it wherever this computer dials tunnels, even with an address of its own that answers", () => {
  const withAddress = machineAddress(roomInviteLink("https://box.local:4602", "ROOM-ABCD-EFGH-JKLM", fingerprint, tunnel))!;
  expect(wayToMachine(withAddress, null)).toEqual({ origin: tunnelOrigin(tunnel), tunnel, trustsOnFirstUse: false });
  expect(wayToMachine(machineAddress("https://box.local:4602")!, null)).toEqual({ origin: "https://box.local:4602", tunnel: null, trustsOnFirstUse: true });
});

test("where this computer can't dial the tunnel, the link's code goes to its address only over HTTPS trusted by more than first use, or plain HTTP within a private network", () => {
  const withoutTunnelHere = (origin: string, authorityFingerprint: string | null = null) => () =>
    wayToMachine(machineAddress(roomInviteLink(origin, "ROOM-ABCD-EFGH-JKLM", authorityFingerprint, tunnel))!, { code: "peer-to-peer-unavailable-here" });
  expect(withoutTunnelHere("https://box.local:4602", fingerprint)()).toEqual({ origin: "https://box.local:4602", tunnel: null, trustsOnFirstUse: false });
  expect(withoutTunnelHere("http://192.168.1.20:4600")()).toEqual({ origin: "http://192.168.1.20:4600", tunnel: null, trustsOnFirstUse: false });
  expect(withoutTunnelHere("http://203.0.113.7:4600")).toThrow("the invite's address, http://203.0.113.7:4600, is not protected by HTTPS");
  expect(withoutTunnelHere("http://box.example.com:4600")).toThrow("is not protected by HTTPS");
  expect(withoutTunnelHere(tunnelOrigin(tunnel))).toThrow("Peer to peer isn't available on this computer, and this invite needs it");
});

test("a link through the tunnel alone says why this computer can't dial it, such as a data folder too long for the sockets dialing needs", () => {
  const throughTunnelOnly = machineAddress(roomInviteLink(tunnelOrigin(tunnel), "ROOM-ABCD-EFGH-JKLM", null, tunnel))!;
  const folderTooLong = { code: "dial-folder-too-long", folder: "/Users/ann/a-long-folder/machine-tunnels" } as const;
  expect(() => wayToMachine(throughTunnelOnly, folderTooLong)).toThrow(
    "Peer to peer can't work from this computer's Mirador data folder, as its path is too long for the sockets it needs: /Users/ann/a-long-folder/machine-tunnels.",
  );
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

test("a link only Mirador opens names the machine by its tunnel alone, so without a whole tunnel it is no link and only gives its code", () => {
  expect(machineAddress(`  ${roomInviteText("ROOM-ABCD-EFGH-JKLM", { tunnel })}\n`)).toMatchObject({ origin: tunnelOrigin(tunnel), forRoom: true, tunnel });
  const broken = [
    "mirador://room-invite/ROOM-ABCD-EFGH-JKLM",
    "mirador://room-invite/ROOM-ABCD-EFGH-JKLM?name=U3R1ZGlv",
    "mirador://room-invite/ROOM-ABCD-EFGH-JKLM?tunnel=bm90LWEtdHVubmVs",
    `mirador://room-invite/ROOM-ABCD-EFGH-JKLM?tunnel=${encoded({ ...tunnel, hostKey: "not a key" })}`,
  ];
  broken.forEach((link) => {
    expect(machineAddress(link)).toBeNull();
    expect(inviteIn(link)).toEqual({ code: "ROOM-ABCD-EFGH-JKLM", authorityFingerprint: null, tunnel: null });
  });
  expect(machineAddress("mirador://")).toBeNull();
  expect(machineAddress("mirador://somewhere/else")).toBeNull();
});

test("a device's invite as a link only Mirador opens gives a phone the code and the way through the tunnel", () => {
  const link = `mirador://join/ABCD-EFGH-JKLM?tunnel=${encoded(tunnel)}`;
  expect(machineAddress(link)).toEqual({ origin: tunnelOrigin(tunnel), joinCode: "ABCD-EFGH-JKLM", authorityFingerprint: null, forRoom: false, tunnel: null, name: null });
  expect(tunnelIn(hashOfMiradorLink(link)!)).toEqual(tunnel);
  expect(hashOfMiradorLink("https://box.local/#/join/ABCD-EFGH-JKLM")).toBeNull();
  expect(machineAddress("mirador://join/ABCD-EFGH-JKLM")).toBeNull();
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

const machine = (id: string, origin: string, hostId: string | null = null): Machine => ({ id, name: id, origin, createdAt: 1, relayPort: 4620, joined: true, color: null, hostId, outOfRooms: false, asPerson: false, relayKey: null, peerToPeer: false, knocks: [], ownerName: null });
const seen = (name: string, origin: string, hostId: string | null = null): MachineSeen => ({ name, origin, hostId });

test("the machines this computer's machines have joined are offered once each, through the first that lists them, unless added here", () => {
  const laptop = machine("laptop", "https://laptop.example.ts.net:4700");
  const server = machine("server", "https://server.example.ts.net");
  const statuses = [
    { machineId: "server", reachable: true, waiting: [], joinedThere: [seen("Pi", "https://pi.example.ts.net"), seen("Laptop", laptop.origin)], rooms: [], mutedHere: [] },
    { machineId: "laptop", reachable: false, waiting: [], joinedThere: [seen("Home server", server.origin), seen("Raspberry", "https://pi.example.ts.net"), seen("NAS", "https://nas.example.ts.net")], rooms: [], mutedHere: [] },
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
      rooms: [],
      mutedHere: [],
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

test("a room invite's text carries one way to the machine: peer to peer its tunnel and no address, at its address no tunnel", () => {
  const peerToPeer = roomInviteText("ROOM-ABCD-EFGH-JKLM", { tunnel });
  expect(peerToPeer).toMatch(/^mirador:\/\/room-invite\/ROOM-ABCD-EFGH-JKLM\?tunnel=[\w-]+$/);
  expect(inviteIn(peerToPeer)).toEqual({ code: "ROOM-ABCD-EFGH-JKLM", authorityFingerprint: null, tunnel });
  expect(machineAddress(peerToPeer)).toEqual({ origin: tunnelOrigin(tunnel), joinCode: "ROOM-ABCD-EFGH-JKLM", authorityFingerprint: null, forRoom: true, tunnel, name: null });

  const atAddress = roomInviteText("ROOM-ABCD-EFGH-JKLM", { origin: "https://box.example.ts.net", authorityFingerprint: fingerprint, machineName: "Ann's Mac ✨" });
  expect(atAddress).toMatch(new RegExp(`^https://box\\.example\\.ts\\.net/#/room-invite/ROOM-ABCD-EFGH-JKLM/${fingerprint}\\?name=[\\w-]+$`));
  expect(atAddress).not.toContain("tunnel");
  expect(machineAddress(atAddress)).toEqual({ origin: "https://box.example.ts.net", joinCode: "ROOM-ABCD-EFGH-JKLM", authorityFingerprint: fingerprint, forRoom: true, tunnel: null, name: "Ann's Mac ✨" });
  expect(inviteIn(atAddress)).toEqual({ code: "ROOM-ABCD-EFGH-JKLM", authorityFingerprint: fingerprint, tunnel: null });
  expect(isRoomInviteLink(new URL(atAddress).hash)).toBe(true);
  expect(roomInviteText("ROOM-ABCD-EFGH-JKLM", { origin: "https://box.example.ts.net", authorityFingerprint: null, machineName: " " })).toBe("https://box.example.ts.net/#/room-invite/ROOM-ABCD-EFGH-JKLM");
});

test("a room invite's machine name is taken only short and well formed, and a broken one leaves the invite without a name", () => {
  const withName = (encoded: string) => machineAddress(`https://box.example/#/room-invite/ROOM-ABCD-EFGH-JKLM?name=${encoded}`);
  expect(withName("bm90IHV0Zi04")).toMatchObject({ joinCode: "ROOM-ABCD-EFGH-JKLM", name: "not utf-8" });
  expect(withName("_w")).toMatchObject({ joinCode: "ROOM-ABCD-EFGH-JKLM", name: null });
  expect(withName("QQ".repeat(300))).toMatchObject({ joinCode: "ROOM-ABCD-EFGH-JKLM", name: null });
  expect(machineAddress("https://box.example/#/room-invite/ROOM-ABCD-EFGH-JKLM?name=a b")).toMatchObject({ forRoom: false, joinCode: null });
  expect(machineAddress(`https://box.example/#/room-invite/ROOM-ABCD-EFGH-JKLM?tunnel=bm90LWEtdHVubmVs`)).toBeNull();
});

const unreadNone = { unread: 0, mentions: 0, toConfirm: 0, toApprove: 0, muted: false };
const joined = (id: string, name: string) => ({ id, name, ...unreadNone });

test("the rooms someone else's machine lists are display data: ids of a room's form, names on one line as everyone reads them, cut to length, each once, a bounded few", () => {
  expect(
    joinedRoomsIn([
      { id: "r1", name: " Launch\n\u202Eplan " },
      { id: "r1", name: "Again" },
      { id: "../../etc", name: "Escapes" },
      { id: "r2", name: 7 },
      { id: "r3", name: "\u200B\u0000" },
      "not a room",
      { id: "r4", name: "x".repeat(500) },
    ]),
  ).toEqual([joined("r1", "Launch plan"), joined("r4", "x".repeat(80))]);
  expect(joinedRoomsIn({ rooms: [] })).toEqual([]);
  expect(joinedRoomsIn(Array.from({ length: 200 }, (_, index) => ({ id: `r${index}`, name: `Room ${index}` })))).toHaveLength(MOST_JOINED_ROOMS);

  const listed = [{ ...joined("r1", "Launch"), unread: 3 }];
  expect(withJoinedRoom(listed, { id: "r1", name: "Launch day", people: [] })).toEqual([{ ...joined("r1", "Launch day"), unread: 3 }]);
  expect(withJoinedRoom(listed, { id: "r2", name: "Ops" })).toEqual([...listed, joined("r2", "Ops")]);
  expect(withJoinedRoom(listed, { id: "bad id", name: "Ops" })).toBe(listed);
  const full = Array.from({ length: MOST_JOINED_ROOMS }, (_, index) => joined(`r${index}`, `Room ${index}`));
  expect(withJoinedRoom(full, joined("one-more", "More"))).toBe(full);
  expect(withoutJoinedRoom(listed, "r1")).toEqual([]);
});

test("what another machine counts in its rooms is taken as whole numbers in a bounded range, for the rooms it lists alone, and a room it says nothing of counts nothing", () => {
  const listed = [joined("r1", "Launch"), { ...joined("r2", "Ops"), unread: 4, muted: true }];
  expect(
    withReadings(listed, [
      { roomId: "r1", unread: 2, mentions: 1, toConfirm: 1, toApprove: 2, muted: "yes" },
      { roomId: "r9", unread: 5 },
      "not a reading",
    ]),
  ).toEqual([{ ...joined("r1", "Launch"), unread: 2, mentions: 1, toConfirm: 1, toApprove: 2 }, joined("r2", "Ops")]);
  expect(withReadings(listed, [{ roomId: "r1", unread: 1e9, mentions: -3, toConfirm: 1.5, toApprove: "3", muted: true }])).toEqual([
    { ...joined("r1", "Launch"), unread: MOST_COUNTED, muted: true },
    joined("r2", "Ops"),
  ]);
  expect(withReadings(listed, "not a list")).toEqual([joined("r1", "Launch"), joined("r2", "Ops")]);
  expect(joinedRoomsIn([{ id: "r1", name: "Launch", unread: "7", mentions: NaN, toConfirm: Infinity, toApprove: -1, muted: 1 }])).toEqual([joined("r1", "Launch")]);
});

test("a room invite connects the way Settings name while it works, else the other way, and not at all when neither works", () => {
  expect(inviteConnectFor("peer-to-peer", { "peer-to-peer": true, address: true })).toBe("peer-to-peer");
  expect(inviteConnectFor("address", { "peer-to-peer": true, address: true })).toBe("address");
  expect(inviteConnectFor("address", { "peer-to-peer": true, address: false })).toBe("peer-to-peer");
  expect(inviteConnectFor("peer-to-peer", { "peer-to-peer": false, address: true })).toBe("address");
  expect(inviteConnectFor("peer-to-peer", { "peer-to-peer": false, address: false })).toBeNull();
});
