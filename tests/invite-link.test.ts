import { describe, expect, test } from "bun:test";
import { machineAddress, tunnelIn } from "../shared/machines.ts";
import type { InviteTunnel } from "../shared/tunnel.ts";
import { inviteLinkFor } from "../web/invite-link.ts";

const tunnel: InviteTunnel = {
  hostKey: "TfdU+RVSAYU/VwqNJh5dDtXFyyZCkHgiPG8knt29NU0=",
  hostAddress: "fd12:3456:789a:1::1",
  port: 4600,
  broker: { address: "203.0.113.7:47800", key: "3Q85Sl/Vr65bJz+OyEhIQtyAeBRDJQqqkVWJgryS2WE=" },
  joinKey: "tne9fR0CU9toO26+5x2ggHdtuq+Z0kfmk/nqAnFmkyg=",
  joinAddress: "fd12:3456:789a:1:8f1e:22c4:aa01:93b7",
  name: "studio",
};

const atAddress = { publicAddress: { origin: "https://box.local:4602", canvasOrigin: "https://box.local:4603" }, authorityFingerprint: "fp-123" };
const noAddress = { publicAddress: null, authorityFingerprint: null };

describe("inviteLinkFor", () => {
  test("phones use the tunnel when the invite has one, even with an address", () => {
    const reached = inviteLinkFor("phone", { code: "ABCD-EFGH-JKLM", tunnel }, atAddress)!;
    expect(reached.appOnly).toBe(true);
    expect(reached.link).toStartWith("http://[fd12:3456:789a:1::1]:4600/#/join/ABCD-EFGH-JKLM?tunnel=");
    expect(tunnelIn(new URL(reached.link).hash)).toEqual(tunnel);
  });

  test("another computer uses a mirador:// peer-to-peer link when the invite has a tunnel, and falls back to the address", () => {
    const throughTunnel = inviteLinkFor("computer", { code: "ABCD-EFGH-JKLM", tunnel }, noAddress)!;
    expect(throughTunnel.appOnly).toBe(true);
    expect(throughTunnel.link).toStartWith("mirador://join/ABCD-EFGH-JKLM?tunnel=");
    expect(machineAddress(throughTunnel.link)).toMatchObject({ joinCode: "ABCD-EFGH-JKLM", tunnel });

    const throughAddress = inviteLinkFor("computer", { code: "ABCD-EFGH-JKLM", tunnel: null }, atAddress)!;
    expect(throughAddress).toEqual({ link: "https://box.local:4602/#/join/ABCD-EFGH-JKLM/fp-123", appOnly: false });
  });

  test("browsers always need an address, never the tunnel", () => {
    expect(inviteLinkFor("browser", { code: "ABCD-EFGH-JKLM", tunnel }, noAddress)).toBeNull();
    expect(inviteLinkFor("browser", { code: "ABCD-EFGH-JKLM", tunnel }, atAddress)).toEqual({
      link: "https://box.local:4602/#/join/ABCD-EFGH-JKLM/fp-123",
      appOnly: false,
    });
  });

  test("without a tunnel or an address, nothing reaches", () => {
    expect(inviteLinkFor("phone", { code: "ABCD-EFGH-JKLM", tunnel: null }, noAddress)).toBeNull();
    expect(inviteLinkFor("computer", { code: "ABCD-EFGH-JKLM", tunnel: null }, noAddress)).toBeNull();
    expect(inviteLinkFor("browser", { code: "ABCD-EFGH-JKLM", tunnel: null }, noAddress)).toBeNull();
  });
});
