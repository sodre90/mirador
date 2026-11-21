/** How a device reaches its host peer to peer: the host's key and address in the tunnel, and the broker that helps the two find each other. */
export interface TunnelPlaces {
  hostKey: string;
  hostAddress: string;
  port: number;
  /**
   * The host's canvas server in the tunnel. A device's proxy for it listens one port above its proxy for the web
   * server, where the host tells pages that came through the tunnel to load canvas pages from.
   */
  canvasPort?: number;
  broker: { address: string; key: string };
}

/** A paired device's own place in its host's tunnel. */
export interface DeviceTunnel extends TunnelPlaces {
  deviceAddress: string;
}

/** In an invite: a one-time key that may only join through the tunnel, until the invite is used or expires. */
export interface InviteTunnel extends TunnelPlaces {
  joinKey: string;
  joinAddress: string;
  /** The host's own name, as a device lists it: its address in the tunnel says nothing to a person. */
  name?: string;
}

/** Just the places, without the one-time key, the device's address or anything else an invite or an answer carries. */
export const placesIn = ({ hostKey, hostAddress, port, canvasPort, broker }: TunnelPlaces): TunnelPlaces => ({
  hostKey,
  hostAddress,
  port,
  ...(canvasPort !== undefined && { canvasPort }),
  broker: { address: broker.address, key: broker.key },
});

/** The origin a device reaches its host at through the tunnel, as a URL writes it, so the same address always reads the same. */
export const tunnelOrigin = ({ hostAddress, port }: TunnelPlaces) => new URL(`http://[${hostAddress}]:${port}`).origin;

/** Far longer than any machine name, so an invite with more is turned away before anything reads it. */
const LONGEST_NAME_IN_INVITE = 200;
const LONGEST_BROKER_ADDRESS = 260;

const toBase64Url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromBase64Url = (text: string) => new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0)));

/** WireGuard's encoding of a key: standard base64 of 32 bytes, in its one canonical form. */
export const isTunnelKeyText = (key: unknown): key is string => typeof key === "string" && /^[A-Za-z0-9+/]{43}=$/.test(key) && btoa(atob(key)) === key;

/** An address in a host's tunnel network: IPv6 in a unique local range (fc00::/7), with no zone or IPv4 part. */
export const isTunnelAddress = (address: unknown): address is string =>
  typeof address === "string" && /^f[cd][0-9a-f]{0,2}:[0-9a-f:]{2,36}$/i.test(address) && URL.canParse(`http://[${address}]/`);

const isPort = (port: unknown): port is number => typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535;

/** The broker as mirador-p2p takes it: NAME:PORT or IP:PORT, with nothing that could read as another argument. */
function isBrokerAddress(address: unknown): address is string {
  if (typeof address !== "string" || address.length > LONGEST_BROKER_ADDRESS) return false;
  const parts = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\]):(\d{1,5})$/.exec(address);
  return parts !== null && isPort(Number(parts[1]));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Only the fields a place in the tunnel has, each checked, as it comes from another machine or a pasted link. */
function checkedPlaces(given: Record<string, unknown>): TunnelPlaces | null {
  const { hostKey, hostAddress, port, canvasPort, broker } = given;
  if (!isTunnelKeyText(hostKey) || !isTunnelAddress(hostAddress) || !isPort(port)) return null;
  if (canvasPort !== undefined && !isPort(canvasPort)) return null;
  if (!isRecord(broker) || !isBrokerAddress(broker.address) || !isTunnelKeyText(broker.key)) return null;
  return { hostKey, hostAddress, port, ...(canvasPort !== undefined && { canvasPort }), broker: { address: broker.address, key: broker.key } };
}

export const encodedInviteTunnel = (tunnel: InviteTunnel) => toBase64Url(JSON.stringify(tunnel));

/** What an invite link says of the tunnel, every field checked, as the link is pasted from anywhere; null when any is not what the host makes. */
export function decodedInviteTunnel(encoded: string): InviteTunnel | null {
  try {
    const given: unknown = JSON.parse(fromBase64Url(encoded));
    if (!isRecord(given)) return null;
    const places = checkedPlaces(given);
    const { joinKey, joinAddress, name } = given;
    if (!places || !isTunnelKeyText(joinKey) || !isTunnelAddress(joinAddress)) return null;
    if (name !== undefined && (typeof name !== "string" || name.length > LONGEST_NAME_IN_INVITE)) return null;
    return { ...places, joinKey, joinAddress, ...(name !== undefined && { name }) };
  } catch {
    return null;
  }
}

/** A device's place as the host answered a join, every field checked; null when any is not what a host makes. */
export function checkedDeviceTunnel(given: unknown): DeviceTunnel | null {
  if (!isRecord(given)) return null;
  const places = checkedPlaces(given);
  return places && isTunnelAddress(given.deviceAddress) ? { ...places, deviceAddress: given.deviceAddress } : null;
}
