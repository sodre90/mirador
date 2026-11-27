import { useState, type KeyboardEvent, type ReactNode } from "react";
import {
  interleavedThreadActivity,
  summarizeWorkspaceCalls,
  type RoomBroughtStep,
  type RoomWorkspaceAccess,
  type RoomWorkspaceAnswer,
  type RoomWorkspaceApproval,
  type RoomWorkspaceCall,
  type ThreadActivityItem,
} from "../shared/room-workspace.ts";
import { Timestamp, usePersonName } from "./Chat.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { HighlightedText, MarkdownText } from "./Markdown.tsx";
import { MeaningMark } from "./RoomSection.tsx";

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

/** Whether an agent someone brought works in the room's workspace; who approves there lets it in, or takes that away. */
export function WorkspaceAccessLine({ roomId, agentId, agentName, access, answers }: { roomId: string; agentId: string; agentName: string; access: RoomWorkspaceAccess; answers: boolean }) {
  return (
    <div className="workspace-access" data-workspace-access={access}>
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

function WorkspaceCallEntry({ call }: { call: RoomWorkspaceCall }) {
  const answeredBy = usePersonName(call.answeredBy);
  return (
    <li>
      <details className="workspace-call" data-workspace-call={call.id} data-state={call.state}>
        <summary>
          <span className="workspace-call-did">{words.callDid[call.kind]}</span>
          {call.kind === "run" ? (
            <code className="workspace-call-about highlighted-code">
              <ShellCommand command={call.about} />
            </code>
          ) : (
            <code className="workspace-call-about">{call.about}</code>
          )}
          <span className="workspace-call-state">{words.callStates[call.state]}</span>
          <Timestamp at={call.at} />
        </summary>
        {call.kind === "run" ? (
          <pre className="workspace-call-text whole highlighted-code">
            <ShellCommand command={call.about} />
          </pre>
        ) : (
          <code className="workspace-call-path">{call.about}</code>
        )}
        {call.diff !== null && (
          <pre className="workspace-call-text whole">
            <DiffLines diff={call.diff} />
          </pre>
        )}
        {call.answeredBy !== null && <div className="hint">{call.state === "denied" ? words.callDeniedBy(answeredBy) : words.callAllowedBy(answeredBy)}</div>}
        {call.result && <pre className="workspace-call-text">{call.result}</pre>}
      </details>
    </li>
  );
}

/** What an agent someone brought had done in the room's workspace, oldest first. */
export function WorkspaceCalls({ calls }: { calls: RoomWorkspaceCall[] }) {
  if (calls.length === 0) return null;
  return (
    <ul className="workspace-calls" aria-label={words.workspaceCalls}>
      {calls.map((call) => (
        <WorkspaceCallEntry key={call.id} call={call} />
      ))}
    </ul>
  );
}

type ActivityGroup = { kind: "step"; step: RoomBroughtStep } | { kind: "calls"; calls: RoomWorkspaceCall[] };

function groupActivity(items: ThreadActivityItem[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const entry of items) {
    if (entry.item === "step") {
      groups.push({ kind: "step", step: entry.step });
    } else {
      const previous = groups.at(-1);
      if (previous?.kind === "calls") previous.calls.push(entry.call);
      else groups.push({ kind: "calls", calls: [entry.call] });
    }
  }
  return groups;
}

/** Streamed thinking/text steps and workspace calls of a brought agent working in the room's workspace, interleaved in order. */
export function BroughtThreadActivity({
  calls,
  steps,
  finalAnswerText,
}: {
  calls: RoomWorkspaceCall[];
  steps: RoomBroughtStep[];
  finalAnswerText?: string | null;
}) {
  const groups = groupActivity(interleavedThreadActivity(calls, steps, finalAnswerText));
  if (groups.length === 0) return null;
  return (
    <div className="brought-thread-steps">
      {groups.map((group) => {
        if (group.kind === "calls") return <WorkspaceCalls key={`calls:${group.calls[0]!.id}`} calls={group.calls} />;
        const { step } = group;
        if (step.kind === "thought") {
          return (
            <details key={`step:${step.id}`} className="thought brought-step-thought" data-brought-step={step.id}>
              <summary>{t.chat.entry.thinking}</summary>
              <MarkdownText text={step.text} />
            </details>
          );
        }
        return (
          <div key={`step:${step.id}`} className="brought-step-text message agent" data-brought-step={step.id}>
            <MarkdownText text={step.text} />
          </div>
        );
      })}
    </div>
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
          <ul className="workspace-calls workspace-activity-list" aria-label={words.workspaceActivity}>
            {newestFirst.map((call) => (
              <li key={call.id} className="workspace-activity-item">
                <div className="workspace-activity-meta">
                  <span className="workspace-activity-agent">{agentNameOf(call.agentId)}</span>
                  <button type="button" className="link" onClick={() => onOpenThread(call.threadId)}>
                    {words.openThread}
                  </button>
                </div>
                <ul className="workspace-calls">
                  <WorkspaceCallEntry call={call} />
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
