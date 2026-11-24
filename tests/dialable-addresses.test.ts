import { describe, expect, test } from "bun:test";
import type { NetworkInterfaceInfo } from "node:os";
import { mayDial, type OwnAddresses } from "../host/sandbox/dialable-addresses.ts";
import { SANDBOX_NETWORKS } from "../shared/sandbox.ts";

const ipv4 = (address: string, prefix: number): NetworkInterfaceInfo => ({ address, netmask: "", family: "IPv4", mac: "", internal: false, cidr: `${address}/${prefix}` });
const ipv6 = (address: string, prefix: number): NetworkInterfaceInfo => ({ address, netmask: "", family: "IPv6", mac: "", internal: false, cidr: `${address}/${prefix}`, scopeid: 0 });

/** A computer on a home network, with a public IPv4 network and IPv6 of its provider's, a tailnet, and a network no cidr is told of. */
const OWN: OwnAddresses = {
  lo0: [ipv4("127.0.0.1", 8), ipv6("::1", 128)],
  en0: [ipv4("192.168.1.20", 24), ipv6("fe80::1c2b:3a4d", 64), ipv6("2a02:1234:5678:9a01::20", 64)],
  en1: [ipv4("84.1.2.65", 28)],
  utun3: [ipv4("100.101.102.103", 32), ipv6("fd7a:115c:a1e0::6701:6667", 128)],
  odd: [{ ...ipv4("93.184.1.1", 32), cidr: null }],
  none: undefined,
};

const INTERNET = ["1.1.1.1", "8.8.8.8", "140.82.121.4", "84.1.2.80", "84.1.2.63", "93.184.1.2", "172.15.255.255", "172.32.0.0", "100.63.255.255", "100.128.0.0", "198.17.255.255", "223.255.255.255", "2606:4700:4700::1111", "2a00:1450:400d::200e", "2a02:1234:5679::1"];

const OWN_NETWORKS = [
  "10.0.0.1",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.1.1",
  "192.168.1.20",
  "192.168.77.5",
  "100.64.0.1",
  "100.101.102.103",
  "100.127.255.255",
  "84.1.2.65",
  "84.1.2.70",
  "93.184.1.1",
  "192.0.0.1",
  "192.0.2.1",
  "192.88.99.1",
  "198.18.0.1",
  "198.19.255.255",
  "198.51.100.1",
  "203.0.113.1",
  "fd7a:115c:a1e0::6701:6667",
  "fd00::1",
  "fc00::1",
  "2a02:1234:5678:9a01::20",
  "2a02:1234:5678:9a01::1",
  "2a02:1234:5678:ffff::1",
];

const NOWHERE = [
  "0.0.0.0",
  "0.1.2.3",
  "127.0.0.1",
  "127.255.255.254",
  "169.254.169.254",
  "224.0.0.251",
  "239.255.255.250",
  "240.0.0.1",
  "255.255.255.255",
  "::",
  "::1",
  "::127.0.0.1",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1",
  "::ffff:192.168.1.20",
  "::ffff:8.8.8.8",
  "64:ff9b::7f00:1",
  "64:ff9b:1::c0a8:114",
  "100::1",
  "fe80::1",
  "febf::1",
  "fec0::1",
  "ff02::fb",
  "2001::1",
  "2001:0:4136:e378:8000:63bf:3fff:fdd2",
  "2001:1ff::1",
  "2001:db8::1",
  "2002:7f00:1::1",
  "2002:c0a8:114::1",
  "3fff::1",
  "4000::1",
  "5f00::1",
];

const UNREADABLE = ["", "localhost", "example.com", "127.1", "0x7f000001", "2130706433", "010.0.0.1", "1.1.1.1:80", "[::1]", "fe80::1%en0", "2606:4700:4700::1111%en0", "1.1.1.1 ", "1.1.1"];

describe("the addresses a sandbox may be connected with", () => {
  test("are none while its network is closed", () => {
    [...INTERNET, ...OWN_NETWORKS, ...NOWHERE, ...UNREADABLE].forEach((address) => expect([address, mayDial("closed", address, OWN)]).toEqual([address, false]));
  });

  test("are the internet's alone where it reaches the internet: never this computer's, its networks', or those no public host has", () => {
    INTERNET.forEach((address) => expect([address, mayDial("internet", address, OWN)]).toEqual([address, true]));
    [...OWN_NETWORKS, ...NOWHERE].forEach((address) => expect([address, mayDial("internet", address, OWN)]).toEqual([address, false]));
  });

  test("are those of its owner's networks too where it reaches everything, but never this computer's loopback, its links or groups", () => {
    [...INTERNET, ...OWN_NETWORKS].forEach((address) => expect([address, mayDial("everything", address, OWN)]).toEqual([address, true]));
    NOWHERE.forEach((address) => expect([address, mayDial("everything", address, OWN)]).toEqual([address, false]));
  });

  test("are never one that can't be read as an address alone", () => {
    SANDBOX_NETWORKS.forEach((network) => UNREADABLE.forEach((address) => expect([network, address, mayDial(network, address, OWN)]).toEqual([network, address, false])));
  });

  test("leave this computer's own out as they are now, unless told otherwise", () => {
    expect(mayDial("internet", "1.1.1.1")).toBe(true);
    expect(mayDial("internet", "127.0.0.1")).toBe(false);
    expect(mayDial("everything", "127.0.0.1")).toBe(false);
  });
});
