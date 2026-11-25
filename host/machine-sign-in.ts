import type { Machine } from "../shared/model.ts";
import { TOKEN_COOKIE } from "../shared/protocol.ts";
import type { MachineRelays } from "./machine-relays.ts";
import type { MachineReach, MachineTunnels } from "./machine-tunnels.ts";
import { trusting } from "./machine-trust.ts";
import type { MachineWatch } from "./machine-watch.ts";
import { fetchThrough } from "./p2p/dial.ts";
import type { Store } from "./store.ts";

/** The machine turned this host's token away: the token goes, and this host's place in the machine's tunnel with its dial and key. */
export function forgetSignInAt(store: Store, tunnels: Pick<MachineTunnels, "forget">, machineId: string) {
  tunnels.forget(machineId);
  store.forgetMachineDeviceToken(machineId);
}

/** Nothing of the machine is left here, as if it had never been added. */
export function forgetMachine(
  { store, relays, watch, tunnels }: { store: Store; relays: Pick<MachineRelays, "stop">; watch: Pick<MachineWatch, "stop">; tunnels: Pick<MachineTunnels, "forget"> },
  machineId: string,
) {
  relays.stop(machineId);
  watch.stop(machineId);
  tunnels.forget(machineId);
  store.deleteMachine(machineId);
}

/** A machine that doesn't answer by then hasn't said it turned this host away. */
const ASKING_TIMEOUT_MS = 10_000;

/**
 * Whether the machine, as this host reaches it, turns this host's device token away, as it does once someone revokes
 * this computer there. Its socket address answers a plain request with 401 to a token it doesn't know, and with 400 to
 * one it does. Through a dial's forward, only an answer that came while the dial's process ran the whole time counts.
 */
export async function signInRevoked(store: Store, reached: Machine, tunnels: Pick<MachineReach, "stillReaches" | "wayTo">): Promise<boolean> {
  const token = store.machineDeviceToken(reached.id);
  const way = tunnels.wayTo(reached);
  if (!token || !way) return false;
  const response = await fetchThrough(way, "/ws", {
    headers: { Origin: reached.origin, Cookie: `${TOKEN_COOKIE}=${token}` },
    signal: AbortSignal.timeout(ASKING_TIMEOUT_MS),
    ...trusting(store.machineAuthority(reached.id)),
  }).catch(() => null);
  return response?.status === 401 && tunnels.stillReaches(reached);
}
