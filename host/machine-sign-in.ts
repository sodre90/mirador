import { TOKEN_COOKIE } from "../shared/protocol.ts";
import { trusting } from "./machine-trust.ts";
import type { Store } from "./store.ts";

/**
 * Whether the machine turns this host's device token away, as it does once someone revokes this computer there. Its
 * socket address answers a plain request with 401 to a token it doesn't know, and with 400 to one it does.
 */
export async function signInRevoked(store: Store, machineId: string): Promise<boolean> {
  const machine = store.findMachine(machineId);
  const token = store.machineDeviceToken(machineId);
  if (!machine || !token) return false;
  const response = await fetch(`${machine.origin}/ws`, {
    headers: { Origin: machine.origin, Cookie: `${TOKEN_COOKIE}=${token}` },
    ...trusting(store.machineAuthority(machineId)),
  }).catch(() => null);
  return response?.status === 401;
}
