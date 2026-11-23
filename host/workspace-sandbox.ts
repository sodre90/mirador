import { HostProblemError } from "../shared/host-problems.ts";
import type { Profile } from "../shared/model.ts";
import { NO_ENVIRONMENT_CHOICES } from "../shared/room-agent-setup.ts";
import {
  isHeldChangeAnswer,
  narrowsSandbox,
  sameSandbox,
  sandboxSettingIn,
  workspaceSandbox,
  type HeldChangeAnswer,
  type WorkspaceSandboxCheck,
} from "../shared/sandbox.ts";
import type { Hub } from "./hub.ts";
import { assertSandboxCanRun, NO_SANDBOX_CONTROL, profileSandboxBlocker, type SandboxControl } from "./sandbox/sandbox-control.ts";
import { sandboxLeft, sandboxLeftWritableFolders } from "./sandbox/hooks-off.ts";
import { belongsToSandbox } from "./sandbox/sandboxes.ts";
import type { Store } from "./store.ts";

/** Why an agent of this profile can't run in a workspace's sandbox, where it gets none of a room's choices of its environment; null where it can. */
const workspaceProfileBlocker = (profile: Profile) => profileSandboxBlocker(profile, NO_ENVIRONMENT_CHOICES);

/** What a workspace's sandbox setting needs of its conversations. */
export interface WorkspaceConversations {
  /** They leave the processes they ran on, and start afresh as they next go on; a change that leaves them with less stops their turns. */
  startAfreshInWorkspace(workspaceId: string, change: { stopsTurn: boolean }): void;
}

/** The conversations' terminal tabs that run their agent on this computer, its sign-in and Claude Code's own panels. */
export interface AgentTerminals {
  closeAgentPrograms(conversationId: string): void;
}

/**
 * Whether a workspace's own conversations, outside its rooms, run their agents in a sandbox of the workspace's, one VM
 * they share, which sees the workspace's folder and nothing of a room's or another workspace's.
 */
export class WorkspaceSandboxes {
  private sandboxes: SandboxControl = NO_SANDBOX_CONTROL;

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly conversations: WorkspaceConversations,
    private readonly terminals: AgentTerminals,
  ) {}

  keepsSandboxesWith(sandboxes: SandboxControl) {
    this.sandboxes = sandboxes;
  }

  /**
   * The workspace's conversations run their agents in its sandbox from their next start on, or on this computer again:
   * each starts afresh, at once where the change leaves it with less. Turned on, nothing of their agents goes on on this
   * computer: neither their sessions there nor their sign-in and panel tabs. A sandbox is turned on only where nothing
   * stands in its way, and one that shares this computer's kernel only where the owner allowed that.
   */
  async setSandbox(workspaceId: string, given: unknown) {
    const workspace = this.existingWorkspace(workspaceId);
    const sandbox = sandboxSettingIn(given);
    if (sameSandbox(sandbox, workspace.sandbox)) return;
    const turnsOn = sandbox.on && !workspace.sandbox.on;
    if (turnsOn) assertSandboxCanRun(await this.sandboxCheck(workspaceId), sandbox);
    if (workspace.sandbox.on && !sandbox.on) this.sandboxLeaves(workspace.id, workspace.path);
    this.store.setWorkspaceSandbox(workspaceId, sandbox);
    this.hub.broadcast({ type: "workspace.upserted", workspace: this.existingWorkspace(workspaceId) });
    this.conversations.startAfreshInWorkspace(workspaceId, { stopsTurn: narrowsSandbox(workspace.sandbox, sandbox) });
    if (turnsOn) this.ownConversationsOf(workspaceId).forEach(({ id }) => this.terminals.closeAgentPrograms(id));
    const startsOn = this.startsOnProfile(workspaceId);
    if (sandbox.on) this.sandboxes.prepare(startsOn && workspaceProfileBlocker(startsOn) === null ? [startsOn] : []);
  }

  private ownConversationsOf(workspaceId: string) {
    return this.store.listConversations().filter((conversation) => belongsToSandbox(conversation, workspaceSandbox(workspaceId)));
  }

  /**
   * What stands in the way of the workspace's sandbox, and whether the profile its new conversations start on can run in
   * it, which doesn't keep the sandbox off: a conversation may pick another, and the workspace one of the profiles that can.
   */
  async sandboxCheck(workspaceId: string): Promise<WorkspaceSandboxCheck> {
    const workspace = this.existingWorkspace(workspaceId);
    const refused = await this.sandboxes.workspaceRefusal(workspace.path, workspace.sandbox.on ? undefined : workspaceSandbox(workspaceId));
    const startsOnProfile = this.startsOnProfile(workspaceId);
    return {
      availability: this.sandboxes.availability(),
      blockers: refused ? [refused] : [],
      startsOn: startsOnProfile ? workspaceProfileBlocker(startsOnProfile) : null,
      profilesThatRun: this.store
        .listProfiles()
        .filter((profile) => workspaceProfileBlocker(profile) === null)
        .map(({ id }) => id),
    };
  }

  /** The profile the workspace's new conversations start on, where it has one. */
  private startsOnProfile(workspaceId: string) {
    const { profileId } = this.existingWorkspace(workspaceId).defaultLaunch;
    return profileId === null ? undefined : this.store.findProfile(profileId);
  }

  async answerHeldChange(workspaceId: string, changeId: string, answer: HeldChangeAnswer) {
    this.existingWorkspace(workspaceId);
    if (!isHeldChangeAnswer(answer)) throw new Error("A held change is allowed or discarded.");
    await this.sandboxes.answerHeldChange(workspaceSandbox(workspaceId), changeId, answer);
  }

  /** The deleted workspace's VM stops, and what it held goes unanswered; its folder and its folders read and write keep their repositories' hooks off a while yet. */
  workspaceGone(workspaceId: string) {
    const workspace = this.store.findWorkspace(workspaceId);
    if (workspace?.sandbox.on) this.sandboxLeaves(workspaceId, workspace.path);
    void this.sandboxes.ownerGone(workspaceSandbox(workspaceId));
  }

  private sandboxLeaves(workspaceId: string, path: string) {
    sandboxLeft(this.store, path);
    sandboxLeftWritableFolders(this.store, workspaceSandbox(workspaceId));
  }

  private existingWorkspace(workspaceId: string) {
    const workspace = this.store.findWorkspace(workspaceId);
    if (!workspace) throw new HostProblemError({ code: "workspace-gone" });
    return workspace;
  }
}
