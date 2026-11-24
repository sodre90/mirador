import { useEffect, useState, type Dispatch } from "react";
import type { Conversation, Profile, Workspace } from "../shared/model.ts";
import { holdsTooMany, ofSandbox, workspaceSandbox, type HeldChange, type SandboxBlocker, type SandboxFolders, type SandboxSetup, type WorkspaceSandboxCheck } from "../shared/sandbox.ts";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { launchLabel } from "./launch-label.ts";
import { LineIcon } from "./LineIcon.tsx";
import { Modal } from "./Palette.tsx";
import { sandboxBlockerText } from "./problem-text.ts";
import { WhatItMeans } from "./RoomSection.tsx";
import { HeldChangeCard, SandboxSwitch, type SandboxSwitchWords } from "./Sandbox.tsx";
import { SandboxFolderList } from "./SandboxFolders.tsx";
import type { AppAction, AppState } from "./state.ts";

const words = t.shell.workspaceSandbox;

const switchWords: SandboxSwitchWords = { turnOn: words.turnOn, checking: words.checking, stillAsks: words.profileModeApplies };

/** What the host's check of the workspace hangs on: its folder, the profile its new conversations start on, and every profile, any of which may start them. */
function checkedAgainst(workspace: Workspace, profiles: Profile[]) {
  return JSON.stringify([workspace.path, workspace.defaultLaunch.profileId, profiles.map(({ id, harness, environment }) => [id, harness, environment])]);
}

/** Whether this computer and the workspace can have a sandbox, asked again whenever the workspace's folder, default profile or the profiles change. */
function useWorkspaceSandboxCheck(workspace: Workspace, profiles: Profile[]) {
  const [check, setCheck] = useState<WorkspaceSandboxCheck | null>(null);
  const against = checkedAgainst(workspace, profiles);
  useEffect(() => {
    let wanted = true;
    connection
      .sendAndAwait(
        (requestId) => ({ type: "workspace.check-sandbox", requestId, workspaceId: workspace.id }),
        (message, requestId) =>
          message.type === "workspace.sandbox-checked" && message.requestId === requestId
            ? { availability: message.availability, blockers: message.blockers, startsOn: message.startsOn, profilesThatRun: message.profilesThatRun }
            : undefined,
      )
      .then(
        (got) => wanted && setCheck(got),
        () => {},
      );
    return () => {
      wanted = false;
    };
  }, [workspace.id, against]);
  return check;
}

/** The workspace's own conversations, those of its rooms aside. */
const ownConversations = (workspace: Workspace, conversations: Conversation[]) => conversations.filter(({ workspaceId, roomId }) => workspaceId === workspace.id && roomId === undefined);

const profileName = (profiles: Profile[]) => (profileId: string) => profiles.find(({ id }) => id === profileId)?.name ?? t.rooms.agentGone;

/**
 * That new conversations here start on a profile that can't run in the sandbox, and why, with the profiles that can to
 * start them on instead; or, where none can, the kind of profile that would.
 */
function StartsOnRefused({ workspace, profiles, why, profilesThatRun }: { workspace: Workspace; profiles: Profile[]; why: SandboxBlocker; profilesThatRun: string[] }) {
  const runnable = profiles.filter(({ id }) => profilesThatRun.includes(id));
  const startOn = (profileId: string) => {
    const profile = runnable.find(({ id }) => id === profileId);
    if (profile) connection.send({ type: "workspace.set-default-launch", workspaceId: workspace.id, launch: { harness: profile.harness, profileId } });
  };
  return (
    <div className="workspace-sandbox-warning workspace-sandbox-starts-on">
      <p className="workspace-sandbox-starts-on-why">{words.startsOnRefused(sandboxBlockerText(why, t.problems))}</p>
      {runnable.length === 0 ? (
        <p className="workspace-sandbox-no-profile-runs">{words.noProfileRuns}</p>
      ) : (
        <label className="workspace-sandbox-start-on">
          {words.startOn}
          <select value="" onChange={(event) => startOn(event.target.value)}>
            <option value="" disabled>
              {words.pickProfile}
            </option>
            {runnable.map(({ id, harness }) => (
              <option key={id} value={id}>
                {launchLabel({ harness, profileId: id }, profiles)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/**
 * The workspace's sandbox, on its own: the switch with what keeps it off, the profile its new conversations start on
 * where that can't run in it, with those that can to pick, its conversations in worktrees, which can't go on there, the
 * folders of this computer it sees, the changes it holds for the owner's OK, and the long story folded away.
 */
export function WorkspaceSandboxDialog({
  workspace,
  profiles,
  conversations,
  setup,
  heldChanges,
  holdsTooMany,
  sandboxFolders,
  homeDir,
  onClose,
}: {
  workspace: Workspace;
  profiles: Profile[];
  conversations: Conversation[];
  setup: SandboxSetup;
  heldChanges: HeldChange[];
  holdsTooMany: boolean;
  sandboxFolders: SandboxFolders;
  homeDir: string;
  onClose: () => void;
}) {
  const check = useWorkspaceSandboxCheck(workspace, profiles);
  const own = ownConversations(workspace, conversations);
  const startsAfresh = own.filter(({ acpSessionId }) => acpSessionId !== null).map(({ id }) => id);
  const inWorktrees = own.filter(({ worktree }) => worktree !== undefined).length;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <Modal label={words.title(workspace.name)} className="workspace-sandbox" onClose={onClose}>
      <h2>{words.title(workspace.name)}</h2>
      <p className="hint workspace-sandbox-lead">{words.lead}</p>
      <SandboxSwitch
        id={`workspace-${workspace.id}`}
        owner={workspaceSandbox(workspace.id)}
        setting={workspace.sandbox}
        check={check}
        setup={setup}
        switchWords={switchWords}
        startsAfresh={startsAfresh}
        startsAfreshText={(conversationIds, stopsTurn) => (stopsTurn ? words.stopsAndStartsAfresh(conversationIds.length) : words.startsAfresh(conversationIds.length))}
        send={(sandbox) => connection.send({ type: "workspace.set-sandbox", workspaceId: workspace.id, sandbox })}
        folders={<SandboxFolderList folders={sandboxFolders} homeDir={homeDir} />}
      />
      {check?.startsOn && <StartsOnRefused workspace={workspace} profiles={profiles} why={check.startsOn} profilesThatRun={check.profilesThatRun} />}
      {inWorktrees > 0 && <p className="workspace-sandbox-warning workspace-sandbox-in-worktrees">{words.inWorktrees(inWorktrees)}</p>}
      <WhatItMeans text={words.meaning} />
      <HeldChangeCard changes={heldChanges} holdsTooMany={holdsTooMany} agentName={profileName(profiles)} countOf={t.rooms.approvalPosition} homeDir={homeDir} unknownAgent={words.anAgentHere} />
      <div className="form-actions">
        <button type="button" className="primary" onClick={onClose}>
          {words.done}
        </button>
      </div>
    </Modal>
  );
}

/** Marks a sandboxed workspace, or a conversation of one, and opens the workspace's sandbox settings; a wordless one is its shield alone, where room is short. */
export function SandboxedMark({ className, hint, wordless = false, onOpen }: { className: string; hint: string; wordless?: boolean; onOpen: () => void }) {
  return (
    <button type="button" className={`sandboxed-mark ${className}`} aria-label={wordless ? t.rooms.sandboxed : undefined} data-hint={hint} onClick={onOpen}>
      <LineIcon shape="shield" />
      {!wordless && t.rooms.sandboxed}
    </button>
  );
}

export const openWorkspaceSandbox = (dispatch: Dispatch<AppAction>, workspaceId: string) => dispatch({ type: "open-overlay", overlay: { kind: "workspace-sandbox", workspaceId } });

/** What a conversation shows of its workspace's sandbox: whether its agent runs there, and the changes held as it worked. */
export interface ConversationSandbox {
  sandboxed: boolean;
  heldChanges: HeldChange[];
  holdsTooMany: boolean;
}

export function conversationSandboxOf(state: Pick<AppState, "workspaces" | "heldChanges" | "sandboxesHoldingTooMany">, { id, workspaceId, roomId }: Conversation): ConversationSandbox {
  const owner = workspaceSandbox(workspaceId);
  return {
    sandboxed: roomId === undefined && state.workspaces.some((workspace) => workspace.id === workspaceId && workspace.sandbox.on),
    heldChanges: roomId === undefined ? state.heldChanges.filter((change) => ofSandbox(owner)(change) && change.conversationIds.includes(id)) : [],
    holdsTooMany: holdsTooMany(state.sandboxesHoldingTooMany, owner),
  };
}
