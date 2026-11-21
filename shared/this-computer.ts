/** A name without the dot a fully qualified one may end with, as in localhost. */
const withoutClosingDot = (hostname: string) => hostname.replace(/\.$/, "");

const IPV4_ADDRESS = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** 127.0.0.0/8, loopback, and 0.0.0.0/8, which connecting to reaches this computer too. */
const isThisComputersIpv4 = (address: string) => ["127", "0"].includes(IPV4_ADDRESS.exec(address)?.[1] ?? "");

/** The eight groups of an IPv6 address as the URL parser writes it, in hex with at most one ::; null for anything else. */
function ipv6Groups(address: string): number[] | null {
  const [before, after, ...more] = address.split("::");
  if (more.length > 0 || before === undefined) return null;
  const groupsOf = (part: string) => (part === "" ? [] : part.split(":").map((group) => (/^[\da-f]{1,4}$/i.test(group) ? parseInt(group, 16) : NaN)));
  const [head, tail] = [groupsOf(before), groupsOf(after ?? "")];
  const zeros = after === undefined ? [] : Array<number>(8 - head.length - tail.length).fill(0);
  const groups = [...head, ...zeros, ...tail];
  return groups.length === 8 && groups.every((group) => !Number.isNaN(group)) ? groups : null;
}

const dottedQuad = (high: number, low: number) => [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");

/** The IPv4 address an IPv4-mapped (::ffff:a.b.c.d) or IPv4-compatible (::a.b.c.d, :: and ::1 among them) IPv6 address carries; null for any other. */
function ipv4Carried(groups: number[]) {
  const [first = 0, second = 0, third = 0, fourth = 0, fifth = 0, sixth = 0, high = 0, low = 0] = groups;
  const leadingZeros = [first, second, third, fourth, fifth].every((group) => group === 0);
  return leadingZeros && (sixth === 0 || sixth === 0xffff) ? dottedQuad(high, low) : null;
}

function isThisComputersIpv6(bracketed: string) {
  const groups = /^\[(.*)\]$/.exec(bracketed)?.[1];
  const parsed = groups === undefined ? null : ipv6Groups(groups);
  const carried = parsed && ipv4Carried(parsed);
  return carried !== null && isThisComputersIpv4(carried);
}

/**
 * Whether a web address's host, as the URL parser writes it (127.1, 2130706433 and 0x7f.0.0.1 become 127.0.0.1), names
 * this computer: localhost and any name under it, 127.0.0.0/8 and 0.0.0.0/8, and the IPv6 addresses that carry those,
 * ::1 and :: among them. Any of these reaches the browser's own computer, wherever the address came from.
 */
export function namesThisComputer(hostname: string) {
  const name = withoutClosingDot(hostname.toLowerCase());
  return name === "localhost" || name.endsWith(".localhost") || isThisComputersIpv4(name) || isThisComputersIpv6(name);
}

/** Whether a web address leads to this computer, or to one of `ownHosts`, the names this computer's Mirador is reached by. */
export function leadsToThisComputer(url: URL, ownHosts: string[]) {
  const host = withoutClosingDot(url.hostname.toLowerCase());
  return namesThisComputer(host) || ownHosts.some((own) => withoutClosingDot(own.toLowerCase()) === host);
}
