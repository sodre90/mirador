import { BlockList, isIP } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import type { SandboxNetwork } from "../../shared/sandbox.ts";

/** This computer's addresses, by interface, as `networkInterfaces` gives them. */
export type OwnAddresses = NodeJS.Dict<NetworkInterfaceInfo[]>;

type Subnet = [address: string, prefix: number];

function listOf(ipv4: Subnet[], ipv6: Subnet[] = []) {
  const list = new BlockList();
  ipv4.forEach(([address, prefix]) => list.addSubnet(address, prefix, "ipv4"));
  ipv6.forEach(([address, prefix]) => list.addSubnet(address, prefix, "ipv6"));
  return list;
}

/** This network, this computer's own loopback, its links (a cloud server's metadata among them), groups, and what is kept for later. */
const NOWHERE_IPV4: Subnet[] = [
  ["0.0.0.0", 8],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** Networks of one's own, carriers' and tailnets' among them, and what IANA keeps for protocols, examples and benchmarks. */
const OFF_THE_INTERNET_IPV4: Subnet[] = [
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
];

const INTERNET_IPV6: Subnet = ["2000::", 3];
const NETWORKS_OF_ONES_OWN_IPV6: Subnet = ["fc00::", 7];

/** Within the internet's range: protocols, tunnels that hold an IPv4 address, and examples. */
const NOWHERE_IPV6: Subnet[] = [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
];

const nowhere = listOf(NOWHERE_IPV4, NOWHERE_IPV6);
const offTheInternet = listOf(OFF_THE_INTERNET_IPV4);
const internetIpv6 = listOf([], [INTERNET_IPV6]);
const everythingIpv6 = listOf([], [INTERNET_IPV6, NETWORKS_OF_ONES_OWN_IPV6]);

/** A site is given no more than this of the internet's IPv6, however it divides it among its networks. */
const IPV6_SITE_PREFIX = 48;

const isOfTheInternetIpv6 = (address: string) => internetIpv6.check(address, "ipv6");

/** The network an address of this computer's is on, the rest of an IPv6 site with it. */
function networkOf({ address, family, cidr }: NetworkInterfaceInfo): { subnet: Subnet; type: "ipv4" | "ipv6" } {
  const plain = address.split("%")[0]!;
  const prefix = cidr === null ? null : Number(cidr.split("/")[1]);
  if (family === "IPv4") return { subnet: [plain, prefix ?? 32], type: "ipv4" };
  return { subnet: [plain, Math.min(prefix ?? 128, isOfTheInternetIpv6(plain) ? IPV6_SITE_PREFIX : 128)], type: "ipv6" };
}

/** The addresses of this computer and of the networks it is on. */
function hereabouts(own: OwnAddresses, type: "ipv4" | "ipv6") {
  const networks = Object.values(own)
    .flatMap((addresses) => addresses ?? [])
    .map(networkOf)
    .filter((network) => network.type === type);
  const subnets = networks.map(({ subnet }) => subnet);
  return type === "ipv4" ? listOf(subnets) : listOf([], subnets);
}

/** Whether a sandbox with this network may be connected with the address, an IP address alone: what it can't tell, it may not. */
export function mayDial(network: SandboxNetwork, address: string, own: OwnAddresses = networkInterfaces()): boolean {
  if (network === "closed" || address.includes("%")) return false;
  const version = isIP(address);
  if (version === 0) return false;
  const family = version === 4 ? "ipv4" : "ipv6";
  if (nowhere.check(address, family)) return false;
  if (version === 6 && !(network === "internet" ? internetIpv6 : everythingIpv6).check(address, family)) return false;
  return network === "everything" || !(offTheInternet.check(address, family) || hereabouts(own, family).check(address, family));
}
