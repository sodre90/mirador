import { inviteLink } from "../shared/machines.ts";
import type { ReachabilitySettings } from "../shared/model.ts";
import { tunnelOrigin, type InviteTunnel } from "../shared/tunnel.ts";

/** What an invite is for: a phone with the Mirador app, or a browser or another computer's Mirador. */
export type InviteJoins = "phone" | "computer";

export const INVITE_JOINS: InviteJoins[] = ["phone", "computer"];

/**
 * The link an invite opens, and whether only the Mirador app opens it: a phone joins through the tunnel when the invite
 * has one, as it needs no address to reach; anything else joins at the host's address. Null where nothing reaches.
 */
export function inviteLinkFor(
  joins: InviteJoins,
  { code, tunnel }: { code: string; tunnel: InviteTunnel | null },
  { publicAddress, authorityFingerprint }: Pick<ReachabilitySettings, "publicAddress" | "authorityFingerprint">,
) {
  if (joins === "phone" && tunnel) return { link: inviteLink(tunnelOrigin(tunnel), code, null, tunnel), appOnly: true };
  return publicAddress && { link: inviteLink(publicAddress.origin, code, authorityFingerprint), appOnly: false };
}
