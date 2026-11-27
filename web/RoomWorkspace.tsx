import { useState, type KeyboardEvent, type ReactNode } from "react";
import {
  interleavedThreadActivity,
  summarizeWorkspaceCalls,
  type RoomBroughtStep,
  type RoomWorkspaceAccess,
  type RoomWorkspaceAnswer,
  type RoomWorkspaceApproval,
  type RoomWorkspaceCall,
  type WorkspaceCallState,
} from "../shared/room-workspace.ts";
import type { BroughtAgent, BroughtWorkspaceScope } from "../shared/rooms.ts";
import { commandShownClosed, outputStartsOpen } from "../shared/shell-output.ts";
import { oneLine } from "../shared/written-text.ts";
import { CommandLine, statusIcons, TerminalOutput, Timestamp, usePersonName } from "./Chat.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { LineIcon } from "./LineIcon.tsx";
import { HighlightedText, MarkdownText } from "./Markdown.tsx";
import { MeaningMark } from "./RoomSection.tsx";
import { useShellOutputStyle } from "./shell-output.ts";

const words = t.rooms;

type AccessAsked = Extract<RoomWorkspaceApproval, { asks: "access" }>;
type CallAsked = Extract<RoomWorkspaceApproval, { asks: "call" }>;

const answerAccess = (roomId: string, agentId: string, answer: RoomWorkspaceAnswer) => connection.send({ type: "room.answer-workspace", roomId, agentId, answer });

const answerCall = ({ roomId, callId }: CallAsked, answer: "allow" | "deny") => connection.send({ type: "room.answer-workspace-call", roomId, callId, answer });

const DIFF_HEADER_LINES = 2;

const diffLineClass = (line: string, index: number) => {
  if (index < DIFF_HEADER_LINES || line.startsWith("@@")) return "workspace-diff-place";
  return line.startsWith("+") ? "diff-added" : line.startsWith("-") ? "diff-removed" : undefined;
};

/** A command an agent runs, coloured as shell as the conversation shows it. */
const ShellCommand = ({ command }: { command: string }) => <HighlightedText code={command} language="bash" />;

function DiffLines({ diff }: { diff: string }) {
  return diff.split("\n").map((line, index) => (
    <div key={index} className={diffLineClass(line, index)}>
      {line || " "}
    </div>
  ));
}

/** The whole command or change, a few lines of it until all are asked for, and how many there are. */
function WholeOfCall({ kind, shown }: { kind: RoomWorkspaceCall["kind"]; shown: string }) {
  const [wholeShown, setWholeShown] = useState(false);
  return (
    <>
      <pre className={`workspace-call-text${wholeShown ? " whole" : ""}${kind === "run" ? " highlighted-code" : ""}`}>{kind === "run" ? <ShellCommand command={shown} /> : <DiffLines diff={shown} />}</pre>
      <div className="room-approval-task-size">
        <span className="room-approval-task-lines">{words.taskLines(shown.split("\n").length)}</span>
        <button type="button" className="link" aria-expanded={wholeShown} onClick={() => setWholeShown(!wholeShown)}>
          {wholeShown ? words.showLessOfTask : words.showWholeTask}
        </button>
      </div>
    </>
  );
}

/** An agent someone brought that asks to be let into the room's workspace. */
export function WorkspaceAccessApproval({ asked: { roomId, agentId, sandboxNetwork }, agentName, count }: { asked: AccessAsked; agentName: string; count: ReactNode }) {
  return (
    <section className="room-approvals" aria-label={words.approvalsWaiting} data-workspace-access-asked={agentId}>
      <div className="room-approval-head">
        <span className="room-approval-asker">{words.asksToWorkHere(agentName)}</span>
        {count}
      </div>
      <div className="room-approval-task">{words.workHereMeaning}</div>
      {sandboxNetwork && <div className="room-approval-outside">{words.sandboxReaches[sandboxNetwork]}</div>}
      <div className="permission-options">
        <button type="button" className="option-allow_once" onClick={() => answerAccess(roomId, agentId, "allow")}>
          {words.letItWorkHere}
        </button>
        <button type="button" onClick={() => answerAccess(roomId, agentId, "decline")}>
          {words.decline}
        </button>
      </div>
    </section>
  );
}

const whereCommandRuns = ({ sandboxNetwork }: CallAsked) => (sandboxNetwork ? `${words.commandRunsInSandbox} ${words.sandboxReaches[sandboxNetwork]}` : words.commandRunsAsOwner);

/** One call of such an agent: all it would do, for whoever allows it. */
export function WorkspaceCallApproval({ asked, agentName, count, task }: { asked: CallAsked; agentName: string; count: ReactNode; task: ReactNode }) {
  return (
    <section className="room-approvals" aria-label={words.approvalsWaiting} data-workspace-call-asked={asked.callId}>
      <div className="room-approval-head">
        <span className="room-approval-asker">{words.callAsks[asked.kind](agentName)}</span>
        {count}
      </div>
      {asked.kind !== "run" && <code className="workspace-call-path">{asked.about}</code>}
      {asked.kind !== "read" && <WholeOfCall kind={asked.kind} shown={asked.shown} />}
      {asked.kind === "run" && <div className="room-approval-outside">{whereCommandRuns(asked)}</div>}
      {task}
      <div className="permission-options">
        <button type="button" className="option-allow_once" onClick={() => answerCall(asked, "allow")}>
          {words.allow}
        </button>
        <button type="button" onClick={() => answerCall(asked, "deny")}>
          {words.deny}
        </button>
      </div>
    </section>
  );
}

/** Short label for a brought agent's workspace pill: this room's workspace, waiting for it, or its bringer's own. */
export function broughtScopeLabel({ workspace, bringer }: Pick<BroughtAgent, "workspace"> & { bringer: string }) {
  if (workspace === "allowed") return words.workspaceScope.room;
  if (workspace === "asked") return words.workspaceScope.asked;
  if (workspace === "declined") return words.workspaceScope.declined;
  return words.workspaceScope.ownOf(bringer);
}

/** Colour-coded pill marking whether a brought agent works in this room's workspace, waits for it, or works in a user's own workspace. */
export function WorkspaceScopePill({ scope, label }: { scope: BroughtWorkspaceScope; label: string }) {
  return (
    <span className="workspace-scope-pill" data-workspace-scope={scope}>
      <LineIcon shape={scope === "own" ? "laptop" : "home"} />
      <span>{label}</span>
    </span>
  );
}

/** Whether an agent someone brought works in the room's workspace; who approves there lets it in, or takes that away. */
export function WorkspaceAccessLine({ roomId, agentId, agentName, access, answers }: { roomId: string; agentId: string; agentName: string; access: RoomWorkspaceAccess; answers: boolean }) {
  const scope: BroughtWorkspaceScope = access === "allowed" ? "room" : "pending";
  return (
    <div className="workspace-access" data-workspace-access={access} data-workspace-scope={scope}>
      <LineIcon shape="home" />
      <span>{words.workspaceAccess[access]}</span>
      {answers && access === "allowed" && (
        <ConfirmButton
          className="link danger"
          label={words.takeWorkspaceAwayOf(agentName)}
          armedText={words.takeWorkspaceAwayArmed}
          armedHint={words.takeWorkspaceAwayArmedHint}
          onConfirm={() => answerAccess(roomId, agentId, "decline")}
        >
          {words.takeWorkspaceAway}
        </ConfirmButton>
      )}
      {answers && access !== "allowed" && (
        <>
          <button type="button" className="link" aria-label={words.letWorkHereOf(agentName)} onClick={() => answerAccess(roomId, agentId, "allow")}>
            {words.letItWorkHere}
          </button>
          <MeaningMark of={words.letItWorkHere} text={words.workHereMeaning} />
        </>
      )}
    </div>
  );
}

function workspaceCallToolStatus(state: WorkspaceCallState): "pending" | "in_progress" | "completed" | "failed" {
  switch (state) {
    case "done":
      return "completed";
    case "running":
      return "in_progress";
    case "waiting":
      return "pending";
    case "denied":
    case "refused":
    case "stopped":
      return "failed";
  }
}

function WorkspaceRunCard({ call, answeredBy }: { call: RoomWorkspaceCall; answeredBy: string }) {
  const style = useShellOutputStyle();
  const status = workspaceCallToolStatus(call.state);
  const failed = status === "failed";
  const finished = call.state === "done" || failed;
  const showsOutput = Boolean(call.result) || call.state === "done" || call.state === "running" || call.state === "waiting";
  const showsBody = !commandShownClosed(style) || showsOutput;
  const commandLine = <CommandLine command={call.about} />;
  return (
    <details
      className={`shell tool-${status} workspace-call`}
      data-workspace-call={call.id}
      data-state={call.state}
      open={outputStartsOpen(style, failed)}
    >
      <summary>
        <div className="shell-header">
          <span className="tool-status" aria-label={words.callStates[call.state]}>
            {statusIcons[status]}
          </span>
          <span className="shell-description">
            <span className="workspace-call-did">{words.callDid.run}</span>
            {!commandShownClosed(style) && (
              <>
                {" "}
                <code className="workspace-call-about highlighted-code">
                  <ShellCommand command={oneLine(call.about)} />
                </code>
              </>
            )}
          </span>
          {call.state !== "done" && <span className="workspace-call-state">{words.callStates[call.state]}</span>}
        </div>
        {commandShownClosed(style) && <div className="shell-body">{commandLine}</div>}
      </summary>
      {showsBody && (
        <div className={`shell-body ${commandShownClosed(style) ? "below-command" : ""}`}>
          {!commandShownClosed(style) && commandLine}
          {showsOutput && <TerminalOutput output={call.result ?? ""} finished={finished} awaitingPermission={call.state === "waiting"} />}
        </div>
      )}
      {call.answeredBy !== null && (
        <div className="workspace-call-meta">
          {call.state === "denied" ? words.callDeniedBy(answeredBy) : words.callAllowedBy(answeredBy)}
        </div>
      )}
    </details>
  );
}

function WorkspaceCallCard({ call }: { call: RoomWorkspaceCall }) {
  const answeredBy = usePersonName(call.answeredBy);
  if (call.kind === "run") return <WorkspaceRunCard call={call} answeredBy={answeredBy} />;
  const status = workspaceCallToolStatus(call.state);
  const hasDetails = call.diff !== null || Boolean(call.result) || call.answeredBy !== null;
  return (
    <details className={`tool tool-${status} workspace-call`} data-workspace-call={call.id} data-state={call.state}>
      <summary>
        <span className="tool-status" aria-label={words.callStates[call.state]}>
          {statusIcons[status]}
        </span>
        <span className="tool-title" title={call.about}>
          <span className="workspace-call-did">{words.callDid[call.kind]}</span>{" "}
          <span className="workspace-call-about">{call.about}</span>
        </span>
        {call.state !== "done" && <span className="workspace-call-state">{words.callStates[call.state]}</span>}
      </summary>
      {call.diff !== null && (
        <div className="diff">
          <div className="diff-path">{call.about}</div>
          <pre>
            <DiffLines diff={call.diff} />
          </pre>
        </div>
      )}
      {call.result && <pre className="tool-output">{call.result}</pre>}
      {call.answeredBy !== null && (
        <div className="workspace-call-meta">
          {call.state === "denied" ? words.callDeniedBy(answeredBy) : words.callAllowedBy(answeredBy)}
        </div>
      )}
      {!hasDetails && <div className="workspace-call-meta">{words.callStates[call.state]}</div>}
    </details>
  );
}

/** Streamed thinking/text steps and workspace calls of a brought agent working in the room's workspace, interleaved as chat-style timeline entries. */
export function BroughtThreadActivity({
  agentAvatar,
  agentAuthor,
  calls,
  steps,
  finalAnswerText,
}: {
  agentAvatar: ReactNode;
  agentAuthor: ReactNode;
  calls: RoomWorkspaceCall[];
  steps: RoomBroughtStep[];
  finalAnswerText?: string | null;
}) {
  const items = interleavedThreadActivity(calls, steps, finalAnswerText);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((entry, index) => {
        const startsGroup = index === 0;
        const at = entry.item === "step" ? entry.step.at : entry.call.at;
        const key = entry.item === "step" ? `step:${entry.step.id}` : `call:${entry.call.id}`;
        return (
          <div key={key} className={`timeline-entry${startsGroup ? " group-start" : ""}`}>
            <div className="gutter">{startsGroup ? agentAvatar : <Timestamp at={at} />}</div>
            <div className="entry-body">
              {startsGroup && (
                <div className="author">
                  {agentAuthor}
                  <Timestamp at={at} />
                </div>
              )}
              {entry.item === "step" ? (
                entry.step.kind === "thought" ? (
                  <details className="thought brought-step-thought" data-brought-step={entry.step.id}>
                    <summary>{t.chat.entry.thinking}</summary>
                    <MarkdownText text={entry.step.text} />
                  </details>
                ) : (
                  <div className="brought-step-text message agent" data-brought-step={entry.step.id}>
                    <MarkdownText text={entry.step.text} />
                  </div>
                )
              ) : (
                <WorkspaceCallCard call={entry.call} />
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

const MOST_CHANGED_FILE_CHIPS = 3;

/** A compact summary under a room answer (or working line) of what a brought agent did in this room's workspace. */
export function WorkspaceActivityLine({ calls, onOpenThread }: { calls: RoomWorkspaceCall[]; onOpenThread: () => void }) {
  const summary = summarizeWorkspaceCalls(calls);
  if (summary.total === 0) return null;
  const parts = [
    summary.read > 0 && words.workspaceCallSummary.read(summary.read),
    summary.changed > 0 && words.workspaceCallSummary.changed(summary.changed),
    summary.ran > 0 && words.workspaceCallSummary.ran(summary.ran),
    summary.denied > 0 && words.workspaceCallSummary.denied(summary.denied),
    summary.notDone > 0 && words.workspaceCallSummary.notDone(summary.notDone),
  ].filter((part): part is string => typeof part === "string");
  if (parts.length === 0) return null;
  const shownFiles = summary.changedFiles.slice(0, MOST_CHANGED_FILE_CHIPS);
  const extraFiles = summary.changedFiles.length - shownFiles.length;
  return (
    <div className="room-thread-line room-workspace-line">
      <span>
        {words.inWorkspace} {parts.join(" · ")}
      </span>
      {shownFiles.length > 0 && (
        <span className="room-workspace-files">
          {shownFiles.map((file) => (
            <button key={file} type="button" className="room-workspace-file-chip" onClick={onOpenThread}>
              {file}
            </button>
          ))}
          {extraFiles > 0 && <span className="hint">{words.moreFiles(extraFiles)}</span>}
        </span>
      )}
    </div>
  );
}

/** Room-wide log of everything brought agents read, changed, or ran in this room's workspace, newest first. */
export function WorkspaceActivityPanel({
  calls,
  agentNameOf,
  onOpenThread,
  onClose,
}: {
  calls: RoomWorkspaceCall[];
  agentNameOf: (agentId: string) => string;
  onOpenThread: (threadId: string) => void;
  onClose: () => void;
}) {
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };
  const newestFirst = [...calls].reverse();
  return (
    <aside className="side-chat workspace-activity-panel" aria-label={words.workspaceActivity} onKeyDown={closeOnEscape}>
      <header className="side-chat-header">
        <div className="side-chat-heading">
          <h2>{words.workspaceActivity}</h2>
        </div>
        <button type="button" className="icon" aria-label={words.closeWorkspaceActivity} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="timeline workspace-activity-timeline">
        {newestFirst.length === 0 ? (
          <div className="notice-line">{words.noWorkspaceActivityYet}</div>
        ) : (
          <ul className="workspace-activity-list" aria-label={words.workspaceActivity}>
            {newestFirst.map((call) => (
              <li key={call.id} className="workspace-activity-item">
                <div className="workspace-activity-meta">
                  <span className="workspace-activity-agent">{agentNameOf(call.agentId)}</span>
                  <Timestamp at={call.at} />
                  <button type="button" className="link" onClick={() => onOpenThread(call.threadId)}>
                    {words.openThread}
                  </button>
                </div>
                <WorkspaceCallCard call={call} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
