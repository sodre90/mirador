import { useState, type ReactNode } from "react";
import type { RoomWorkspaceAccess, RoomWorkspaceAnswer, RoomWorkspaceApproval, RoomWorkspaceCall } from "../shared/room-workspace.ts";
import { Timestamp, usePersonName } from "./Chat.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
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
      <pre className={`workspace-call-text${wholeShown ? " whole" : ""}`}>{kind === "run" ? shown : <DiffLines diff={shown} />}</pre>
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
          <code className="workspace-call-about">{call.about}</code>
          <span className="workspace-call-state">{words.callStates[call.state]}</span>
          <Timestamp at={call.at} />
        </summary>
        {call.kind === "run" ? <pre className="workspace-call-text whole">{call.about}</pre> : <code className="workspace-call-path">{call.about}</code>}
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
