/** How a device reaches its host peer to peer: the host's key and address in the tunnel, and the broker that helps the two find each other. */
export interface TunnelPlaces {
  hostKey: string;
  hostAddress: string;
  port: number;
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

/** The origin a device reaches its host at through the tunnel. */
export const tunnelOrigin = ({ hostAddress, port }: TunnelPlaces) => `http://[${hostAddress}]:${port}`;

const toBase64Url = (text: string) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string) => atob(text.replace(/-/g, "+").replace(/_/g, "/"));

export const encodedInviteTunnel = (tunnel: InviteTunnel) => toBase64Url(JSON.stringify(tunnel));

export function decodedInviteTunnel(encoded: string): InviteTunnel | null {
  try {
    const tunnel = JSON.parse(fromBase64Url(encoded)) as Partial<InviteTunnel>;
    const texts = [tunnel.hostKey, tunnel.hostAddress, tunnel.joinKey, tunnel.joinAddress, tunnel.broker?.address, tunnel.broker?.key];
    const named = tunnel.name === undefined || typeof tunnel.name === "string";
    return texts.every((text) => typeof text === "string") && typeof tunnel.port === "number" && named ? (tunnel as InviteTunnel) : null;
  } catch {
    return null;
  }
}
