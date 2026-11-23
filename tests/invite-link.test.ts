import { describe, expect, test } from "bun:test";
import { joinCodeIn, tunnelIn } from "../shared/machines.ts";
import type { InviteTunnel } from "../shared/tunnel.ts";
import { inviteLinkFor } from "../web/invite-link.ts";

const key = "tne9fR0CU9toO26+5x2ggHdtuq+Z0kfmk/nqAnFmkyg=";
const tunnel: InviteTunnel = { hostKey: key, hostAddress: "fd12:3456:789a:1::1", port: 4600, broker: { address: "p2p.example.com:47800", key }, joinKey: key, joinAddress: "fd12:3456:789a:1::9" };
const code = "ABCD-EFGH-JKLM";
const publicAddress = { origin: "https://box.example.ts.net:4600", canvasOrigin: "https://box.example.ts.net:4601" };
const addressed = { publicAddress, authorityFingerprint: null };
const nowhere = { publicAddress: null, authorityFingerprint: null };

describe("inviteLinkFor", () => {
  test("a phone joins through the tunnel, even where there is an address, with a link only the app opens", () => {
    const { link, appOnly } = inviteLinkFor("phone", { code, tunnel }, addressed)!;
    expect(appOnly).toBe(true);
    expect(new URL(link).origin).toBe("http://[fd12:3456:789a:1::1]:4600");
    expect(tunnelIn(new URL(link).hash)).toEqual(tunnel);
    expect(joinCodeIn(new URL(link).hash)).toBe(code);
  });

  test("with no tunnel a phone joins at the address, as a browser or computer always does", () => {
    const atAddress = { link: `https://box.example.ts.net:4600/#/join/${code}`, appOnly: false };
    expect(inviteLinkFor("phone", { code, tunnel: null }, addressed)).toEqual(atAddress);
    expect(inviteLinkFor("computer", { code, tunnel }, addressed)).toEqual(atAddress);
  });

  test("the link to the address names the host's own certificate authority", () => {
    const fingerprint = "a".repeat(43);
    expect(inviteLinkFor("computer", { code, tunnel: null }, { publicAddress, authorityFingerprint: fingerprint })?.link).toBe(`https://box.example.ts.net:4600/#/join/${code}/${fingerprint}`);
  });

  test("with no address there is nothing for a browser or computer, and for a phone only the tunnel", () => {
    expect(inviteLinkFor("computer", { code, tunnel }, nowhere)).toBeNull();
    expect(inviteLinkFor("phone", { code, tunnel: null }, nowhere)).toBeNull();
    expect(inviteLinkFor("phone", { code, tunnel }, nowhere)?.appOnly).toBe(true);
  });
});
