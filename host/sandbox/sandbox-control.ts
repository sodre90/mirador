import { HostProblemError } from "../../shared/host-problems.ts";
import type { Profile } from "../../shared/model.ts";
import { environmentInRoom, type EnvironmentChoices } from "../../shared/room-agent-setup.ts";
import {
  runsInSandbox,
  sharesKernel,
  signInElsewhere,
  type HeldChangeAnswer,
  type SandboxAvailability,
  type SandboxBlocker,
  type SandboxCheck,
  type SandboxOwner,
  type SandboxSetting,
} from "../../shared/sandbox.ts";
import { profileEnvironment } from "../acp/harnesses.ts";

/** What a room's or workspace's settings need of the sandboxes. */
export interface SandboxControl {
  availability(): SandboxAvailability;
  /** Sets up what every sandbox needs, so the first turn need not wait for it. */
  prepare(): void;
  answerHeldChange(owner: SandboxOwner, changeId: string, answer: HeldChangeAnswer): Promise<void>;
  /** The room or workspace is deleted: its VM stops, and what it held goes unanswered. */
  ownerGone(owner: SandboxOwner): Promise<void>;
  /** Why the workspace can't be shown to a sandbox, null where it can. */
  workspaceRefusal(workspace: string): Promise<SandboxBlocker | null>;
}

export const NO_SANDBOX_CONTROL: SandboxControl = {
  availability: () => ({ available: false, why: "turned-off" }),
  prepare: () => {},
  answerHeldChange: async () => {},
  ownerGone: async () => {},
  workspaceRefusal: async () => null,
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

/**
 * Why an agent of this profile can't run in a sandbox, given what of its environment it gets there: only Claude Code
 * runs in one, and only where the model proxy can add its key for it. Null where it can.
 */
export function profileSandboxBlocker(profile: Profile, choices: EnvironmentChoices): SandboxBlocker | null {
  if (!runsInSandbox(profile.harness)) return { kind: "agent-kind-coming", agent: profile.name, harness: profile.harness };
  const environment = (() => {
    try {
      return profileEnvironment(profile, (host, set) => environmentInRoom(profile.harness, host, set, choices));
    } catch {
      return {};
    }
  })();
  const how = signInElsewhere(environment);
  return how ? { kind: "agent-signs-in-elsewhere", agent: profile.name, how } : null;
}
