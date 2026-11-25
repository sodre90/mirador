import type { ReachabilitySettings } from "./model.ts";

/** How browsers and other computers reach a host: not at all, over the network itself, or at an address a proxy gives it. */
export type ReachRoute = "none" | "network" | "address";

export const REACH_ROUTES: ReachRoute[] = ["none", "network", "address"];

/** The environment wins over Settings, which then can't change how other devices reach the host. */
export const reachSetByEnvironment = ({ publicAddressSetByEnvironment, networkSetByEnvironment }: ReachabilitySettings) => publicAddressSetByEnvironment || networkSetByEnvironment;

const networkAfterRestart = ({ networkSetByEnvironment, network, savedNetwork }: ReachabilitySettings) => (networkSetByEnvironment ? network : savedNetwork);

/** The way the host takes from its next start. */
export function routeAfterRestart(settings: ReachabilitySettings): ReachRoute {
  if (settings.publicAddressSetByEnvironment || settings.savedPublicAddress) return "address";
  return networkAfterRestart(settings) ? "network" : "none";
}

const isOnTheNetworkItself = (origin: string, { networkPort }: ReachabilitySettings) => new URL(origin).port === String(networkPort);

/** Whether the address the host has now is another, or none, from its next start: what joins at it loses touch then. */
export function addressGoesAway(settings: ReachabilitySettings) {
  const { publicAddress, savedPublicAddress, restartNeeded, publicAddressSetByEnvironment } = settings;
  if (!restartNeeded || !publicAddress || publicAddressSetByEnvironment) return false;
  if (savedPublicAddress) return savedPublicAddress.origin !== publicAddress.origin;
  return !networkAfterRestart(settings) || !isOnTheNetworkItself(publicAddress.origin, settings);
}
