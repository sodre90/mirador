import { expect, test } from "bun:test";
import { authorityFingerprintIn, inviteIn, inviteLink, joinCodeIn, machineAddress, tunnelIn } from "../shared/machines.ts";
import type { InviteTunnel } from "../shared/tunnel.ts";

test("a machine is added by its name on the network, its address or an invite link from it", () => {
  expect(machineAddress("home-server.tailnet.ts.net")).toEqual({ origin: "https://home-server.tailnet.ts.net", joinCode: null, authorityFingerprint: null });
  expect(machineAddress(" https://home-server.tailnet.ts.net/some/page ")).toMatchObject({ origin: "https://home-server.tailnet.ts.net", joinCode: null });
  expect(machineAddress("http://192.168.1.20:4600")).toMatchObject({ origin: "http://192.168.1.20:4600", joinCode: null });
  expect(machineAddress("https://home-server.tailnet.ts.net/#/join/ABCD-EFGH-JKLM")).toEqual({
    origin: "https://home-server.tailnet.ts.net",
    joinCode: "ABCD-EFGH-JKLM",
    authorityFingerprint: null,
  });
});

const fingerprint = "q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x_-";

test("an invite link from a machine with its own certificate authority carries the authority's fingerprint after the code", () => {
  const link = inviteLink("https://box.local:4602", "ABCD-EFGH-JKLM", fingerprint);
  expect(link).toBe(`https://box.local:4602/#/join/ABCD-EFGH-JKLM/${fingerprint}`);
  expect(machineAddress(link)).toEqual({ origin: "https://box.local:4602", joinCode: "ABCD-EFGH-JKLM", authorityFingerprint: fingerprint });
  expect(joinCodeIn(`#/join/ABCD-EFGH-JKLM/${fingerprint}`)).toBe("ABCD-EFGH-JKLM");
  expect(authorityFingerprintIn(`#/join/ABCD-EFGH-JKLM/${fingerprint}`)).toBe(fingerprint);
  expect(inviteLink("https://box.example.ts.net", "ABCD-EFGH-JKLM")).toBe("https://box.example.ts.net/#/join/ABCD-EFGH-JKLM");
});

test("an invite link carries a fingerprint of any length, so a truncated one still gives the code and not the whole link", () => {
  expect(inviteIn(inviteLink("https://box.example", "ABCD-EFGH-JKLM", "short-fp"))).toEqual({ code: "ABCD-EFGH-JKLM", authorityFingerprint: "short-fp" });
  const truncated = fingerprint.slice(0, 42);
  expect(inviteIn(`https://box.example/#/join/ABCD-EFGH-JKLM/${truncated}`)).toEqual({ code: "ABCD-EFGH-JKLM", authorityFingerprint: truncated });
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
  expect(inviteIn(link)).toEqual({ code: "ABCD-EFGH-JKLM", authorityFingerprint: fingerprint });
  expect(tunnelIn(new URL(inviteLink("https://box.local", "ABCD-EFGH-JKLM", null, tunnel)).hash)).toEqual(tunnel);
  expect(tunnelIn("#/join/ABCD-EFGH-JKLM?tunnel=bm90LWEtdHVubmVs")).toBeNull();
  expect(tunnelIn("#/join/ABCD-EFGH-JKLM")).toBeNull();
  const misnamed = btoa(JSON.stringify({ ...tunnel, name: 7 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  expect(tunnelIn(`#/join/ABCD-EFGH-JKLM?tunnel=${misnamed}`)).toBeNull();
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
  expect(inviteIn("https://home-server.example.ts.net/#/join/ABCD-EFGH-JKLM")).toEqual({ code: "ABCD-EFGH-JKLM", authorityFingerprint: null });
  expect(inviteIn(`https://home-server.local:4602/#/join/ABCD-EFGH-JKLM/${fingerprint}`)).toEqual({ code: "ABCD-EFGH-JKLM", authorityFingerprint: fingerprint });
  expect(inviteIn("  ABCD-EFGH-JKLM \n")).toEqual({ code: "ABCD-EFGH-JKLM", authorityFingerprint: null });
});
