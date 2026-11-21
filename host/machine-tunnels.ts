import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HostProblemError } from "../shared/host-problems.ts";
import type { Machine } from "../shared/model.ts";
import type { InviteTunnel } from "../shared/tunnel.ts";
import { HERE_PATH } from "./addresses.ts";
import { Dial, dialCommand, stopLeftOverDials, type DialProgram, type Forward } from "./p2p/dial.ts";
import { installSidecar } from "./p2p/sidecar-download.ts";
import type { Store } from "./store.ts";

/** The tunnel finds the machine through its broker first, which takes a moment, or longer across networks. */
export const ANSWER_WAIT_MS = 20_000;
const ANSWER_TRY_TIMEOUT_MS = 3000;
const ANSWER_TRY_EVERY_MS = 250;

/** Whether anything answers at `origin` within `ms`: an invite's one-time key reaches joining alone, which answers other paths with 404. */
export async function answersWithin(origin: string, ms: number) {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    const timeout = Math.max(1, Math.min(ANSWER_TRY_TIMEOUT_MS, deadline - Date.now()));
    const response = await fetch(`${origin}${HERE_PATH}`, { signal: AbortSignal.timeout(timeout) }).catch(() => null);
    if (response) {
      await response.body?.cancel();
      return true;
    }
    await Bun.sleep(ANSWER_TRY_EVERY_MS);
  }
  return false;
}

/** One machine's dial, from when it is asked for: once its binary and key file are there, and whether it was stopped meanwhile. */
interface MachineDial {
  ready: Promise<Dial | null>;
  dial: Dial | null;
  stopped: boolean;
}

/** A dial with an invite's one-time key, for joining through the machine's tunnel; it is tried once, never started again. */
export interface JoiningDial {
  forward: Promise<Forward | null>;
  stop: () => void;
}

/**
 * This host's ends of the tunnels of machines it joined peer to peer: a `mirador-p2p dial` for each, with this host's
 * own key there, whose forwards on this computer's loopback are where the relays and the watch reach the machine. The
 * keys are in the store; each dial reads its own from a file only this account reads, which goes with the machine.
 * A forward is handed out only while the dial's process that listens there runs, and whoever sends a secret through it
 * asks `stillReaches` right before: another account on this computer may take a port the moment that process exits.
 */
export class MachineTunnels {
  private readonly dials = new Map<string, MachineDial>();
  private readonly joining = new Set<Dial>();
  private readonly answering = new WeakMap<Forward, Promise<boolean>>();
  private readonly forwardOfReached = new WeakMap<Machine, Forward>();
  private installed: Promise<string> | null = null;

  constructor(
    private readonly store: Store,
    private readonly folder: string,
    private readonly program: DialProgram | null,
    /** The relays' ports, which a forward never takes. */
    private readonly avoidedPorts: number[],
  ) {}

  /** What a host that was killed left running is stopped first. */
  startAll() {
    this.makeFolder();
    stopLeftOverDials(this.folder);
    this.store.machinesDialed().forEach((machineId) => this.start(machineId));
  }

  /** Again from the start, e.g. with the key of a new join. */
  start(machineId: string) {
    this.stop(machineId);
    const wanted: MachineDial = { ready: Promise.resolve(null), dial: null, stopped: false };
    wanted.ready = this.dialFor(machineId, wanted).catch((error: unknown) => {
      console.error(`dialing the tunnel of the machine ${this.store.findMachine(machineId)?.name} failed:`, error instanceof Error ? error.message : error);
      return null;
    });
    this.dials.set(machineId, wanted);
  }

  /** At once and without waiting, so it also works as the host exits. */
  stop(machineId: string) {
    const wanted = this.dials.get(machineId);
    if (!wanted) return;
    wanted.stopped = true;
    wanted.dial?.stop();
    this.dials.delete(machineId);
  }

  /** This host's place in the machine's tunnel is gone, or no longer wanted: its key goes with its dial. */
  forget(machineId: string) {
    this.stop(machineId);
    rmSync(this.fileOf(machineId, "key"), { force: true });
    this.store.forgetMachineTunnelDevice(machineId);
  }

  stopAll() {
    [...this.dials.keys()].forEach((machineId) => this.stop(machineId));
    this.joining.forEach((dial) => dial.stop());
    this.joining.clear();
  }

  /** Whether this computer can dial machines' tunnels: it has mirador-p2p, or downloads it now. */
  canDial() {
    return this.binary().then(
      () => true,
      () => false,
    );
  }

  /**
   * The machine as this host reaches it: a machine joined peer to peer at its dial's forward, once the machine answers
   * there, else null, as it is while no dial's process runs; never at its address in the tunnel, which only the dial
   * knows the way to.
   */
  async reached(machine: Machine): Promise<Machine | null> {
    if (!machine.peerToPeer) return machine;
    const dial = await this.dials.get(machine.id)?.ready;
    const forward = await dial?.current();
    if (!forward || !(await this.answeringAt(forward)) || !forward.running) return null;
    const reached = { ...machine, origin: forward.origin };
    this.forwardOfReached.set(reached, forward);
    return reached;
  }

  /** Whether the dial's process that `reached` came from runs still, so its forward is still its own; always for a machine reached at its address. */
  stillReaches(reached: Machine) {
    return !reached.peerToPeer || this.forwardOfReached.get(reached)?.running === true;
  }

  /** Its key file goes when it stops, as does one a killed host left, at the next start. */
  async dialToJoin(invite: InviteTunnel): Promise<JoiningDial> {
    const binary = await this.binary();
    this.makeFolder();
    const name = `join-${randomBytes(8).toString("hex")}`;
    const keyFile = join(this.folder, `${name}.key`);
    writeFileSync(keyFile, invite.joinKey, { mode: 0o600 });
    const dial = new Dial(
      (localPort) => dialCommand(binary, { keyFile, address: invite.joinAddress, places: invite, localPort }),
      { pidFile: join(this.folder, `${name}.pid`), keyFile },
      (line) => console.error(`joining through a tunnel: ${line}`),
      { avoidedPorts: this.avoidedPorts, restarts: false },
    );
    this.joining.add(dial);
    dial.start();
    return {
      forward: dial.current(),
      stop: () => {
        dial.stop();
        this.joining.delete(dial);
        rmSync(keyFile, { force: true });
      },
    };
  }

  /** Asked once for each process of the dial, and again after it did not answer. */
  private answeringAt(forward: Forward) {
    const known = this.answering.get(forward);
    if (known) return known;
    const asked = answersWithin(forward.origin, ANSWER_WAIT_MS).then((answered) => {
      if (!answered) this.answering.delete(forward);
      return answered;
    });
    this.answering.set(forward, asked);
    return asked;
  }

  private async dialFor(machineId: string, wanted: MachineDial) {
    const tunnel = this.store.machineTunnel(machineId);
    if (!tunnel?.device) return null;
    const binary = await this.binary();
    if (wanted.stopped) return null;
    this.makeFolder();
    const keyFile = this.fileOf(machineId, "key");
    writeFileSync(keyFile, tunnel.device.privateKey, { mode: 0o600 });
    const { address } = tunnel.device;
    const name = this.store.findMachine(machineId)?.name ?? machineId;
    wanted.dial = new Dial(
      (localPort) => dialCommand(binary, { keyFile, address, places: tunnel.places, localPort }),
      { pidFile: this.fileOf(machineId, "pid"), keyFile },
      (line) => console.error(`the tunnel to ${name}: ${line}`),
      { avoidedPorts: this.avoidedPorts },
    );
    wanted.dial.start();
    return wanted.dial;
  }

  /** The binary, downloaded the first time a machine is dialed where the environment names none. */
  private binary() {
    if (!this.program) return Promise.reject(new HostProblemError({ code: "peer-to-peer-unavailable-here" }));
    const { path, download } = this.program;
    if (!download) return Promise.resolve(path);
    this.installed ??= installSidecar(path, download).then(
      () => path,
      (error: unknown) => {
        this.installed = null;
        console.error(`downloading mirador-p2p to dial machines' tunnels failed:`, error instanceof Error ? error.message : error);
        throw new HostProblemError({ code: "peer-to-peer-unavailable-here" });
      },
    );
    return this.installed;
  }

  private makeFolder() {
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    chmodSync(this.folder, 0o700);
  }

  private fileOf(machineId: string, extension: "key" | "pid") {
    return join(this.folder, `${createHash("sha256").update(machineId).digest("hex").slice(0, 16)}.${extension}`);
  }
}

/** How this host reaches machines: at their address, or at a dial of its own into a machine's tunnel. */
export type MachineReach = Pick<MachineTunnels, "reached" | "stillReaches" | "dialToJoin" | "start">;

/** A host that dials no tunnels reaches machines at their address alone. */
export const DIRECT_REACH: MachineReach = {
  reached: async (machine) => (machine.peerToPeer ? null : machine),
  stillReaches: (reached) => !reached.peerToPeer,
  dialToJoin: () => Promise.reject(new HostProblemError({ code: "peer-to-peer-unavailable-here" })),
  start: () => {},
};
