import { describe, expect, test } from "bun:test";
import type { ReachabilitySettings } from "../shared/model.ts";
import { addressGoesAway, reachSetByEnvironment, routeAfterRestart } from "../shared/reachability.ts";

const alone: ReachabilitySettings = {
  publicAddress: null,
  savedPublicAddress: null,
  publicAddressSetByEnvironment: false,
  port: 4600,
  canvasAssetsPort: 4601,
  network: false,
  savedNetwork: false,
  networkSetByEnvironment: false,
  networkPort: 4602,
  networkCanvasPort: 4603,
  restartNeeded: false,
  authorityFingerprint: null,
};
const proxy = { origin: "https://box.example.ts.net:4600", canvasOrigin: "https://box.example.ts.net:4601" };
const otherProxy = { origin: "https://mirador.example.com", canvasOrigin: "https://canvas.example.com" };
const itsOwn = { origin: "https://box.local:4602", canvasOrigin: "https://box.local:4603" };

describe("routeAfterRestart", () => {
  test("is the saved address, then the network, then none", () => {
    expect(routeAfterRestart(alone)).toBe("none");
    expect(routeAfterRestart({ ...alone, savedNetwork: true })).toBe("network");
    expect(routeAfterRestart({ ...alone, savedNetwork: true, savedPublicAddress: proxy })).toBe("address");
  });

  test("is the environment's where that sets it, whatever is saved", () => {
    expect(routeAfterRestart({ ...alone, publicAddress: proxy, publicAddressSetByEnvironment: true })).toBe("address");
    expect(routeAfterRestart({ ...alone, network: true, networkSetByEnvironment: true })).toBe("network");
    expect(routeAfterRestart({ ...alone, savedNetwork: true, networkSetByEnvironment: true })).toBe("none");
    expect(reachSetByEnvironment({ ...alone, networkSetByEnvironment: true })).toBe(true);
    expect(reachSetByEnvironment(alone)).toBe(false);
  });
});

describe("addressGoesAway", () => {
  const atProxy = { ...alone, publicAddress: proxy, savedPublicAddress: proxy };

  test("while nothing waits for a restart, or the address stays, it does not", () => {
    expect(addressGoesAway(alone)).toBe(false);
    expect(addressGoesAway(atProxy)).toBe(false);
    expect(addressGoesAway({ ...atProxy, restartNeeded: true, savedPublicAddress: { ...proxy, canvasOrigin: "https://box.example.ts.net:9443" } })).toBe(false);
  });

  test("it does once another address, the network or none is saved", () => {
    expect(addressGoesAway({ ...atProxy, restartNeeded: true, savedPublicAddress: otherProxy })).toBe(true);
    expect(addressGoesAway({ ...atProxy, restartNeeded: true, savedPublicAddress: null })).toBe(true);
    expect(addressGoesAway({ ...atProxy, restartNeeded: true, savedPublicAddress: null, savedNetwork: true })).toBe(true);
  });

  test("the network's own address stays while the network does, as when only its certificate changes", () => {
    const onNetwork = { ...alone, publicAddress: itsOwn, network: true, savedNetwork: true, restartNeeded: true };
    expect(addressGoesAway(onNetwork)).toBe(false);
    expect(addressGoesAway({ ...onNetwork, savedNetwork: false })).toBe(true);
  });

  test("the environment's address stays", () => {
    expect(addressGoesAway({ ...alone, publicAddress: proxy, publicAddressSetByEnvironment: true, restartNeeded: true })).toBe(false);
  });

  test("with no address yet there is none to go away", () => {
    expect(addressGoesAway({ ...alone, savedPublicAddress: proxy, restartNeeded: true })).toBe(false);
  });
});
