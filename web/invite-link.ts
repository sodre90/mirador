import { deviceTunnelInviteLink, inviteLink } from "../shared/machines.ts";
import type { ReachabilitySettings } from "../shared/model.ts";
import { tunnelOrigin, type InviteTunnel } from "../shared/tunnel.ts";

/** What an invite is for: a phone with the Mirador app, another computer's Mirador, or a browser. */
export type InviteJoins = "phone" | "computer" | "browser";

export const INVITE_JOINS: InviteJoins[] = ["phone", "computer", "browser"];

/**
 * The link an invite opens, and whether only a Mirador app opens it: phones and other computers running Mirador join
 * through the tunnel when the invite has one, needing no address; a browser joins at the host's address. Null where
 * nothing reaches.
 */
export function inviteLinkFor(
  joins: InviteJoins,
  { code, tunnel }: { code: string; tunnel: InviteTunnel | null },
  { publicAddress, authorityFingerprint }: Pick<ReachabilitySettings, "publicAddress" | "authorityFingerprint">,
) {
  if (joins === "phone" && tunnel) return { link: inviteLink(tunnelOrigin(tunnel), code, null, tunnel), appOnly: true };
  if (joins === "computer" && tunnel) return { link: deviceTunnelInviteLink(code, tunnel), appOnly: true };
  return publicAddress && { link: inviteLink(publicAddress.origin, code, authorityFingerprint), appOnly: false };
}
