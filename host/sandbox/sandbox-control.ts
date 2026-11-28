import { HostProblemError } from "../../shared/host-problems.ts";
import type { Profile } from "../../shared/model.ts";
import { environmentInRoom, type EnvironmentChoices } from "../../shared/room-agent-setup.ts";
import {
  modelKeyVariableOf,
  sharesKernel,
  signInElsewhere,
  type HeldChangeAnswer,
  type SandboxAvailability,
  type SandboxBlocker,
  type SandboxCheck,
  type SandboxOwner,
  type SandboxSetting,
} from "../../shared/sandbox.ts";
import type { AgentLaunch } from "../acp/harness.ts";
import { profileEnvironmentToCome } from "../acp/harnesses.ts";
import type { SandboxedKind } from "./agent-environment.ts";
import { modelRouteOf, type ModelRoute } from "./model-proxy.ts";
import { piSandboxSetupFor } from "./pi-setup.ts";
import type { BroughtAgentInSandbox } from "./sandboxes.ts";
import { SandboxNotReady } from "./vm-launcher.ts";

/** A call of an agent someone brought. */
export type BroughtCallInSandbox = BroughtAgentInSandbox;

/** What a room's or workspace's settings need of the sandboxes. */
export interface SandboxControl {
  availability(): SandboxAvailability;
  /** Whether sandboxes run here now, the runtime asked again where it couldn't run them, as one whose daemon started after Mirador. */
  availabilityNow(): Promise<SandboxAvailability>;
  /** Sets up what the owner's sandbox needs, and the tools of these profiles' agents, so the first turn need not wait for it. */
  prepare(owner: SandboxOwner, profiles: Profile[]): void;
  answerHeldChange(owner: SandboxOwner, changeId: string, answer: HeldChangeAnswer): Promise<void>;
  /** The room or workspace is deleted: its VM stops, and what it held goes unanswered. */
  ownerGone(owner: SandboxOwner): Promise<void>;
  /** The sandbox was turned off, or its room moved to another workspace: it hears of no new held changes there. */
  ownerLeft(owner: SandboxOwner): Promise<void>;
  /** Why a sandbox can't work in the workspace, or the room's or workspace's sandbox `turningOn` can't turn on there; null where it can. */
  workspaceRefusal(workspace: string, turningOn?: SandboxOwner): Promise<SandboxBlocker | null>;
  /** The command that does the call in that agent's own VM of the sandbox, started first where it isn't running. */
  launchForBrought(call: BroughtCallInSandbox): Promise<AgentLaunch>;
  /** The agent someone brought works in the sandbox no longer: its VM stops. */
  stopBrought(owner: SandboxOwner, agentId: string): Promise<void>;
  /** An agent's turn, or a brought one's task, ended: the held files are looked at once more. */
  turnEnded(owner: SandboxOwner): Promise<void>;
  /** What the sandbox reaches changed, as stored: what it may reach no longer is cut off. */
  networkChanged(owner: SandboxOwner): void;
}

export const NO_SANDBOX_CONTROL: SandboxControl = {
  availability: () => ({ available: false, why: "turned-off" }),
  /** What `availability` says, of a copy that gives its own. */
  async availabilityNow() {
    return this.availability();
  },
  prepare: () => {},
  answerHeldChange: async () => {},
  ownerGone: async () => {},
  ownerLeft: async () => {},
  workspaceRefusal: async () => null,
  launchForBrought: () => Promise.reject(new SandboxNotReady({ kind: "unavailable", why: "turned-off" })),
  stopBrought: async () => {},
  turnEnded: async () => {},
  networkChanged: () => {},
};

/**
 * A sandbox is turned on only where nothing stands in its way, and one that shares this computer's kernel only where the
 * owner allowed that: the first reason it can't is thrown.
 */
export function assertSandboxCanRun({ availability, blockers }: SandboxCheck, sandbox: SandboxSetting) {
  if (!availability.available) throw new HostProblemError({ code: "sandbox-not-ready", why: { kind: "unavailable", why: availability.why } });
  if (sharesKernel(availability.kind) && !sandbox.allowsSharedKernel) throw new HostProblemError({ code: "sandbox-not-ready", why: { kind: "shared-kernel-not-allowed" } });
  if (blockers[0]) throw new HostProblemError({ code: "sandbox-not-ready", why: { kind: "blocked", blocker: blockers[0] } });
}

/** How an agent reaches its model from its sandbox: the model proxy's route, and what its kind gets in the VM. */
export interface ModelInSandbox {
  route: ModelRoute;
  kind: SandboxedKind;
}

/**
 * How an agent of this profile, with this environment and what its room or workspace gives it, reaches its model from a
 * sandbox; or why it can't run in one: only Claude Code and pi do, and only where the model proxy can add the key for them.
 */
export function modelInSandbox(profile: Profile, choices: EnvironmentChoices, environment: Record<string, string>): ModelInSandbox | { blocker: SandboxBlocker } {
  const { harness, name: agent } = profile;
  if (harness === "claude") {
    const how = signInElsewhere(environment);
    const route = modelRouteOf(environment, profile.model);
    const keyVariable = modelKeyVariableOf(environment);
    if (how || !route || !keyVariable) return { blocker: { kind: "agent-signs-in-elsewhere", agent, how: how ?? "subscription" } };
    return { route, kind: { harness, keyVariable } };
  }
  if (harness === "pi") {
    const setup = piSandboxSetupFor(profile, choices);
    if ("elsewhere" in setup) return { blocker: { kind: "pi-model-elsewhere", agent, why: setup.elsewhere } };
    return { route: setup.route, kind: { harness, model: setup.inVm, keyVariables: setup.keyVariables } };
  }
  return { blocker: { kind: "agent-kind-coming", agent, harness } };
}

/**
 * The environment an agent of this profile gets for a sandbox: a Claude Code profile that signs in with a Claude
 * subscription gets the token of it Mirador keeps for sandboxes, `sandboxSignIn`, which the model proxy adds for it.
 */
export function environmentForSandbox(profile: Profile, environment: Record<string, string>, sandboxSignIn: string | null): Record<string, string> {
  const takesSignIn = profile.harness === "claude" && sandboxSignIn !== null && signInElsewhere(environment) === "subscription";
  return takesSignIn ? { ...environment, CLAUDE_CODE_OAUTH_TOKEN: sandboxSignIn } : environment;
}

/** Why an agent of this profile can't run in a sandbox, given what of its environment it gets there; null where it can. */
export function profileSandboxBlocker(profile: Profile, choices: EnvironmentChoices, sandboxSignIn: string | null): SandboxBlocker | null {
  const environment = (() => {
    try {
      return profileEnvironmentToCome(profile, (host, set) => environmentInRoom(profile.harness, host, set, choices));
    } catch {
      return {};
    }
  })();
  const model = modelInSandbox(profile, choices, environmentForSandbox(profile, environment, sandboxSignIn));
  return "blocker" in model ? model.blocker : null;
}
