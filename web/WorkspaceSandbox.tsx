import { useEffect, useRef, useState, type CSSProperties, type Dispatch } from "react";
import type { Conversation, Profile, Workspace } from "../shared/model.ts";
import { holdsTooMany, ofSandbox, roomSandbox, setupOf, workspaceSandbox, type HeldChange, type SandboxBlocker, type SandboxFolders, type SandboxSetup, type WorkspaceSandboxCheck } from "../shared/sandbox.ts";
import { placedBelow, useClosing } from "./BarMenu.tsx";
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

/** Those a side chat isn't of, which go into the sandbox or stay out of it with their side chats. */
const conversationsOfTheirOwn = (own: Conversation[]) => own.filter(({ sideChatOf }) => sideChatOf === undefined);

const withAgentSessions = (conversations: Conversation[]) => conversations.filter(({ acpSessionId }) => acpSessionId !== null).map(({ id }) => id);

/**
 * Whether the conversations a workspace has come into its sandbox as it is turned on, left out unless the owner says;
 * either way, what the agents outside can do to what the sandboxed ones write.
 */
function BringConversationsIn({ count, bringing, onChange }: { count: number; bringing: boolean; onChange: (bringing: boolean) => void }) {
  return (
    <div className="workspace-sandbox-bring-in">
      <label className="room-agent-choice">
        <input type="checkbox" checked={bringing} onChange={(event) => onChange(event.target.checked)} />
        {words.bringIn(count)}
      </label>
      <p className="hint">{bringing ? words.bringInNote : words.leaveOutNote}</p>
    </div>
  );
}

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
  const [bringingIn, setBringingIn] = useState(false);
  const own = ownConversations(workspace, conversations);
  const inSandbox = own.filter(({ outsideSandbox }) => !outsideSandbox);
  const canComeIn = own.filter(({ worktree }) => worktree === undefined);
  const startsAfresh = withAgentSessions(workspace.sandbox.on ? inSandbox : bringingIn ? canComeIn : []);
  const inWorktrees = own.filter(({ worktree }) => worktree !== undefined).length;
  const outside = workspace.sandbox.on ? conversationsOfTheirOwn(own.filter(({ outsideSandbox }) => outsideSandbox)).length : 0;
  const toBringIn = conversationsOfTheirOwn(canComeIn).length;

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
        send={(sandbox) => connection.send({ type: "workspace.set-sandbox", workspaceId: workspace.id, sandbox, bringConversationsIn: bringingIn })}
        folders={<SandboxFolderList folders={sandboxFolders} homeDir={homeDir} />}
        whileOff={toBringIn > 0 && <BringConversationsIn count={toBringIn} bringing={bringingIn} onChange={setBringingIn} />}
      />
      {outside > 0 && <p className="hint workspace-sandbox-outside">{words.outsideCount(outside)}</p>}
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

/** Marks a sandboxed workspace and opens its sandbox settings; a wordless one is its shield alone, where room is short. */
export function SandboxedMark({ className, hint, wordless = false, onOpen }: { className: string; hint: string; wordless?: boolean; onOpen: () => void }) {
  return (
    <button type="button" className={`sandboxed-mark ${className}`} aria-label={wordless ? t.rooms.sandboxed : undefined} data-hint={hint} onClick={onOpen}>
      <LineIcon shape="shield" />
      {!wordless && t.rooms.sandboxed}
    </button>
  );
}

export const openWorkspaceSandbox = (dispatch: Dispatch<AppAction>, workspaceId: string) => dispatch({ type: "open-overlay", overlay: { kind: "workspace-sandbox", workspaceId } });

/**
 * What a conversation shows of its workspace's sandbox: whether its agent runs there, or on this computer while the
 * workspace has one, and the changes held as it worked; and how far sandboxes are set up on this computer, which a
 * conversation waiting for its sandbox shows.
 */
export interface ConversationSandbox {
  sandboxed: boolean;
  outside: boolean;
  heldChanges: HeldChange[];
  holdsTooMany: boolean;
  setup: SandboxSetup;
}

export function conversationSandboxOf(
  state: Pick<AppState, "workspaces" | "heldChanges" | "sandboxesHoldingTooMany" | "sandboxSetups">,
  { id, workspaceId, roomId, outsideSandbox }: Conversation,
): ConversationSandbox {
  const owner = workspaceSandbox(workspaceId);
  const workspaceSandboxed = roomId === undefined && state.workspaces.some((workspace) => workspace.id === workspaceId && workspace.sandbox.on);
  return {
    sandboxed: workspaceSandboxed && !outsideSandbox,
    outside: workspaceSandboxed && outsideSandbox === true,
    heldChanges: roomId === undefined ? state.heldChanges.filter((change) => ofSandbox(owner)(change) && change.conversationIds.includes(id)) : [],
    holdsTooMany: holdsTooMany(state.sandboxesHoldingTooMany, owner),
    setup: setupOf(state.sandboxSetups, roomId === undefined ? owner : roomSandbox(roomId)),
  };
}

/** Why a conversation can't go into its workspace's sandbox or out of it by itself; null where it can. */
function sandboxFixedBy({ sideChatOf, worktree }: Conversation, sandboxed: boolean) {
  if (sideChatOf !== undefined) return words.sideChatFollows;
  return !sandboxed && worktree !== undefined ? words.worktreeStaysHere : null;
}

/**
 * Where a sandboxed workspace's conversation runs its agent, in the sandbox or on this computer, as a mark in its top bar
 * whose menu moves it to the other, asking first where its agent would forget what was said, and opens the sandbox's settings.
 */
export function ConversationSandboxMenu({ conversation, sandboxed, onOpenSettings }: { conversation: Conversation; sandboxed: boolean; onOpenSettings: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  const [asking, setAsking] = useState(false);
  const open = placement !== null;
  const close = () => {
    setPlacement(null);
    setAsking(false);
  };
  useClosing(open, root, close);
  const fixedBy = sandboxFixedBy(conversation, sandboxed);
  const move = () => {
    close();
    connection.send({ type: "conversation.set-sandboxed", conversationId: conversation.id, sandboxed: !sandboxed });
  };
  const chooseMove = () => (conversation.acpSessionId === null ? move() : setAsking(true));
  const openSettings = () => {
    close();
    onOpenSettings();
  };
  return (
    <div className={`bar-menu conversation-sandbox ${sandboxed ? "conversation-sandboxed" : "conversation-outside-sandbox"}`} ref={root}>
      <button
        type="button"
        className={`sandboxed-mark${open ? " on" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-hint={sandboxed ? words.conversationSandboxed : words.conversationOutside}
        onClick={(event) => (open ? close() : setPlacement(placedBelow(event.currentTarget)))}
      >
        <LineIcon shape="shield" />
        {sandboxed ? t.rooms.sandboxed : words.onThisComputer}
      </button>
      {open && !asking && (
        <ul role="menu" aria-label={words.conversationMenu} style={placement}>
          <li role="none">
            <button type="button" role="menuitemcheckbox" aria-checked={sandboxed} disabled={fixedBy !== null} onClick={chooseMove}>
              {words.runInSandbox}
            </button>
          </li>
          {fixedBy && <li className="conversation-sandbox-fixed hint">{fixedBy}</li>}
          <li role="separator" />
          <li role="none">
            <button type="button" role="menuitem" onClick={openSettings}>
              {words.sandboxSettings}
            </button>
          </li>
        </ul>
      )}
      {open && asking && (
        <div className="conversation-sandbox-ask" role="alertdialog" aria-label={words.conversationMenu} style={placement}>
          <p>{sandboxed ? words.movesOutAfresh : words.movesInAfresh}</p>
          <div className="form-actions">
            <button type="button" className="link" onClick={close}>
              {words.keepAsIs}
            </button>
            <button type="button" className="primary" onClick={move}>
              {sandboxed ? words.moveOut : words.moveIn}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Marks a conversation whose agent runs in its workspace's sandbox in the sidebar, beside those of the workspace that run on this computer. */
export function SandboxedRowMark() {
  return (
    <span className="conversation-sandboxed-row" role="img" aria-label={words.rowSandboxed} data-hint={words.rowSandboxed}>
      <LineIcon shape="shield" />
    </span>
  );
}
