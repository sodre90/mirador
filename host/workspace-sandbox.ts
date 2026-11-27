import { HostProblemError } from "../shared/host-problems.ts";
import { worksForARoom, type Conversation, type Profile } from "../shared/model.ts";
import { NO_ENVIRONMENT_CHOICES } from "../shared/room-agent-setup.ts";
import {
  isHeldChangeAnswer,
  keepingNetworkOf,
  narrowsSandbox,
  sameSandbox,
  sandboxSettingIn,
  workspaceSandbox,
  type HeldChangeAnswer,
  type SandboxNetwork,
  type SandboxSetting,
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
  startAfreshUnderNewSetup(conversationIds: string[], change: { stopsTurn: boolean }): void;
  /** Tells the pages what the conversations are now. */
  republishAll(conversationIds: string[]): void;
}

/** The conversations' terminal tabs that run their agent on this computer, its sign-in and Claude Code's own panels. */
export interface AgentTerminals {
  closeAgentPrograms(conversationId: string): void;
}

/**
 * Whether a workspace's own conversations, outside its rooms, run their agents in a sandbox of the workspace's, one VM
 * they share, which sees the workspace's folder and nothing of a room's or another workspace's; each conversation may
 * run on this computer instead.
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
   * The workspace's conversations in its sandbox run their agents there from their next start on, or on this computer
   * again: each starts afresh, at once where the change leaves it with less. Turned on, the conversations it has stay on
   * this computer, untouched, unless the owner brings them in; one in a worktree, which the sandbox can't see, always
   * stays. Those brought in go on with nothing of their agents on this computer: neither their sessions there nor their
   * sign-in and panel tabs. New conversations start in the sandbox. A sandbox is turned on only where nothing stands in
   * its way, and one that shares this computer's kernel only where the owner allowed that.
   */
  async setSandbox(workspaceId: string, given: unknown, bringConversationsIn: boolean) {
    const workspace = this.existingWorkspace(workspaceId);
    const sandbox = keepingNetworkOf(workspace.sandbox, sandboxSettingIn(given));
    if (sameSandbox(sandbox, workspace.sandbox)) return;
    const turnsOn = sandbox.on && !workspace.sandbox.on;
    if (turnsOn) assertSandboxCanRun(await this.sandboxCheck(workspaceId), sandbox);
    if (workspace.sandbox.on && !sandbox.on) this.sandboxLeaves(workspace.id, workspace.path);
    const placed = turnsOn ? this.placeConversationsAsSandboxTurnsOn(workspaceId, bringConversationsIn) : [];
    const changing = this.conversationsInSandboxOf(workspaceId);
    this.storeSandbox(workspaceId, sandbox);
    this.conversations.startAfreshUnderNewSetup(changing, { stopsTurn: narrowsSandbox(workspace.sandbox, sandbox) });
    this.conversations.republishAll(placed.filter((id) => !changing.includes(id)));
    if (turnsOn) changing.forEach((id) => this.terminals.closeAgentPrograms(id));
    const startsOn = this.startsOnProfile(workspaceId);
    if (sandbox.on) this.sandboxes.prepare(workspaceSandbox(workspaceId), startsOn && workspaceProfileBlocker(startsOn) === null ? [startsOn] : []);
  }

  /** Each of the workspace's own conversations comes in or stays out as the sandbox turns on; they all are, by their ids. */
  private placeConversationsAsSandboxTurnsOn(workspaceId: string, bringConversationsIn: boolean) {
    const own = this.ownConversationsOf(workspaceId);
    const comesIn = ({ worktree }: Conversation) => bringConversationsIn && worktree === undefined;
    this.store.setOutsideSandbox(own.filter((conversation) => !comesIn(conversation)).map(({ id }) => id), true);
    this.store.setOutsideSandbox(own.filter(comesIn).map(({ id }) => id), false);
    return own.map(({ id }) => id);
  }

  /**
   * One of the workspace's own conversations, with its side chats, runs its agent in the workspace's sandbox from its next
   * start on, or on this computer: it starts afresh then, and a turn under way stops at once. Going in, nothing of its
   * agent goes on on this computer; going out, the sandbox no longer takes its turn's canvas calls. A side chat goes
   * where its conversation does, a room's agent where its room has it, and a conversation in a worktree, which the
   * sandbox can't see, stays on this computer.
   */
  setConversationSandboxed(conversationId: string, sandboxed: boolean) {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation) throw new HostProblemError({ code: "no-such-conversation", id: conversationId });
    if (conversation.sideChatOf !== undefined || worksForARoom(conversation)) throw new HostProblemError({ code: "sandbox-follows-elsewhere" });
    if (!this.existingWorkspace(conversation.workspaceId).sandbox.on) throw new HostProblemError({ code: "workspace-sandbox-off" });
    if (sandboxed && conversation.worktree) throw new HostProblemError({ code: "worktree-outside-sandbox" });
    if (sandboxed === !conversation.outsideSandbox) return;
    this.store.setOutsideSandbox([conversationId], !sandboxed);
    const moving = [conversationId, ...this.store.sideChatsOf(conversationId)];
    this.conversations.startAfreshUnderNewSetup(moving, { stopsTurn: true });
    if (sandboxed) moving.forEach((id) => this.terminals.closeAgentPrograms(id));
  }

  /** What the workspace's sandbox reaches besides the model and Mirador, while it is on: from now on, in sessions under way too. */
  setNetwork(workspaceId: string, network: SandboxNetwork) {
    const { sandbox } = this.existingWorkspace(workspaceId);
    if (sandbox.on && sandbox.network !== network) this.storeSandbox(workspaceId, { ...sandbox, network });
  }

  private storeSandbox(workspaceId: string, sandbox: SandboxSetting) {
    this.store.setWorkspaceSandbox(workspaceId, sandbox);
    this.sandboxes.networkChanged(workspaceSandbox(workspaceId));
    this.hub.broadcast({ type: "workspace.upserted", workspace: this.existingWorkspace(workspaceId) });
  }

  /** The workspace's own conversations, outside its rooms, in its sandbox or not. */
  private ownConversationsOf(workspaceId: string) {
    return this.store.listConversations().filter((conversation) => conversation.workspaceId === workspaceId && conversation.roomId === undefined);
  }

  private conversationsInSandboxOf(workspaceId: string) {
    return this.store
      .listConversations()
      .filter((conversation) => belongsToSandbox(conversation, workspaceSandbox(workspaceId)))
      .map(({ id }) => id);
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
    void this.sandboxes.ownerLeft(workspaceSandbox(workspaceId));
  }

  private existingWorkspace(workspaceId: string) {
    const workspace = this.store.findWorkspace(workspaceId);
    if (!workspace) throw new HostProblemError({ code: "workspace-gone" });
    return workspace;
  }
}
