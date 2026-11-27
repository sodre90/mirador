import { flushSync } from "react-dom";
import { useContext, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type ReactNode, type Ref } from "react";
import type { AskItem, CanvasItem, Conversation, HarnessId, Person, Profile } from "../shared/model.ts";
import { personGoesBy } from "../shared/people.ts";
import { categoryChoices, chosenModel } from "../shared/config-options.ts";
import { mentionAt, withMention } from "../shared/mentions.ts";
import type { RoomApprovalAnswer } from "../shared/room-permissions.ts";
import { stillTagged, withTagAtCaret, type TaggablePerson } from "../shared/room-mentions.ts";
import type { RoomQuestionVotes } from "../shared/room-votes.ts";
import { roomCanvasAuthorOf } from "../shared/room-canvas.ts";
import {
  AGENT_TAGGED_TURNS_AFTER_A_PERSON,
  agentStandIn,
  approvesIn,
  askedInThread,
  broughtAgentName,
  canvasItemsOfAnswers,
  eventsAnswering,
  firstReachingTheAgent,
  isRoomRole,
  messagesOfThread,
  reachedAmong,
  ROOM_MESSAGE_MOST_CHARACTERS,
  roomMessageLength,
  shownInRoom,
  taskWaits,
  workPending,
  writtenByAgent,
  type BroughtAgent,
  type Room,
  type RoomAgentModel,
  type RoomApproval,
  type RoomAuthor,
  type RoomJoiner,
  type RoomMessage,
  type RoomMessageSentAlong,
  type RoomPresence,
  type RoomRole,
  type RoomTask,
  type RoomTaskApproval,
  type RoomThread,
  type RoomTimeline,
  type RoomWriter,
  type WorkPending,
} from "../shared/rooms.ts";
import { threadItemsBetween, type RoomBroughtStep, type RoomWorkspaceApproval, type RoomWorkspaceCall } from "../shared/room-workspace.ts";
import { cutWithEllipsis } from "../shared/text-cut.ts";
import { oneLine } from "../shared/written-text.ts";
import type { HeldChange } from "../shared/sandbox.ts";
import { placedBelowOnItsSide, useClosing, useKeptInWindow } from "./BarMenu.tsx";
import { CanvasPanel, CanvasShown, type WorkspaceApps } from "./Canvas.tsx";
import { agentMarks, JumpToLatest, MessageWriters, pendingPermissionNeeded, PersonAvatar, PersonName, TimelineOfEvents, Timestamp, usePersonName, usePersonNames, useScrollAnchor } from "./Chat.tsx";
import { connection } from "./connection.ts";
import { BroughtAgentName, HintedWhenCutShort } from "./cut-short.tsx";
import { useEarlierHistory } from "./earlier-history.ts";
import type { EditRequest } from "./edit-approval.ts";
import { FormatBarToggle } from "./FormatBar.tsx";
import { enterSends, FormattedBox } from "./FormattedBox.tsx";
import { hints } from "./hints.ts";
import type { RoomSettingsTab } from "./i18n/en/rooms.ts";
import { formatNumber, t } from "./i18n/index.ts";
import { LayoutToggles } from "./LayoutToggles.tsx";
import { movedCaretToLineEdge } from "./line-edge-keys.ts";
import { LineIcon } from "./LineIcon.tsx";
import { askParentToOpenBroughtWork, shownInAnotherMirador } from "./machine-place.ts";
import { MarkdownText, MentionsOfMessage, SlackMessageText } from "./Markdown.tsx";
import { useMessageBox } from "./message-box.ts";
import { writersIn, writingLine, WritingSignals } from "./room-writing.ts";
import { ConversationWithSide } from "./SideChat.tsx";
import type { AppAction, OpenConversation, RoomTimelineWithCanvas } from "./state.ts";
import { SuggestionList, suggestionAttributes, suggestionKey, usePickedSuggestion } from "./SuggestionList.tsx";
import { ModelChoice, offeredAlready } from "./RoomAgents.tsx";
import { nameOf } from "./RoomAgentSetup.tsx";
import { HeldChangeCard } from "./Sandbox.tsx";
import { JoinerAtTheDoor, RemovePerson, WaitingToJoin } from "./RoomSettings.tsx";
import { RoomVote } from "./RoomVote.tsx";
import { BroughtThreadActivity, WorkspaceAccessApproval, WorkspaceAccessLine, WorkspaceActivityLine, WorkspaceActivityPanel, WorkspaceCallApproval } from "./RoomWorkspace.tsx";
import { useSpellCheck } from "./spell-check.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";
import type { WorkspacePluginTab } from "./WorkspaceTabView.tsx";

const words = t.rooms;
const TAG_MENU_ID = "room-tags";

interface RoomAgentShown {
  profileId: string;
  name: string;
  harness: HarnessId | undefined;
  /** Of an agent a person brought from their own Mirador: by whom, by the name they go by, and whether it is here. */
  brought: (BroughtAgent & { bringer: string }) | undefined;
  profile: Profile | undefined;
  conversation: Conversation | undefined;
  /** The room message the agent's turn under way answers. */
  answering: string | null;
  /** Chosen for the agent in this room; only the owner is told. */
  model: RoomAgentModel;
}

type RoomAgentToTag = RoomAgentShown & { harness: HarnessId };

const isTaggable = (agent: RoomAgentShown): agent is RoomAgentToTag => agent.harness !== undefined;

const agentNames = (profileIds: string[], agentsById: Map<string, RoomAgentShown>) => profileIds.map((profileId) => agentsById.get(profileId)?.name ?? words.agentGone).join(", ");

function AuthorMark({ author, agentsById }: { author: RoomAuthor; agentsById: Map<string, RoomAgentShown> }) {
  if (!writtenByAgent(author)) return <PersonAvatar personId={author.personId} />;
  const harness = agentsById.get(author.profileId)?.harness;
  return (
    <span className={`avatar agent-${harness ?? "gone"}`} aria-hidden="true">
      {harness ? agentMarks[harness] : "?"}
    </span>
  );
}

function AuthorName({ author, agentsById }: { author: RoomAuthor; agentsById: Map<string, RoomAgentShown> }) {
  if (!writtenByAgent(author)) return <PersonName personId={author.personId} />;
  const agent = agentsById.get(author.profileId);
  if (agent?.brought) {
    return (
      <HintedWhenCutShort className="room-author-name" whole={agent.name}>
        <BroughtAgentName name={agent.brought.name} bringer={agent.brought.bringer} />
      </HintedWhenCutShort>
    );
  }
  return <span>{agent?.name ?? words.agentGone}</span>;
}

function answerEnding(message: RoomMessage) {
  if (message.ended === "stopped") return words.stopped;
  if (message.ended === "failed") return words.failed;
  if (message.ended === "declined") return words.declined;
  if (message.ended === "away") return words.away;
  if (message.ended === "refused") return words.refused;
  if (message.ended === "taken-out") return words.takenOut;
  return message.text ? null : words.noAnswer;
}

const tagsYou = (message: RoomMessage, you: string | null) => message.mentions?.some(({ personId }) => personId === you) === true;

const writtenBy = (message: RoomMessage | undefined, you: string | null) => message !== undefined && !writtenByAgent(message.author) && message.author.personId === you;

/** Whether the whole entry stands out for you: it tags you, and is not merely an agent answering what you wrote, whose tag of you alone shows. */
const callsOnYou = (message: RoomMessage, answered: RoomMessage | undefined, you: string | null) => tagsYou(message, you) && !writtenBy(answered, you);

const entryClasses = (message: RoomMessage, answered: RoomMessage | undefined, agentsById: Map<string, RoomAgentShown>, you: string | null) => {
  const harness = writtenByAgent(message.author) ? (agentsById.get(message.author.profileId)?.harness ?? "gone") : null;
  return ["timeline-entry", "group-start", "room-entry", ...(harness ? ["written-by-agent", `agent-${harness}`] : []), ...(callsOnYou(message, answered, you) ? ["tags-you"] : [])].join(" ");
};

function RoomEntry({
  message,
  answered,
  quoted,
  agentsById,
  children,
}: {
  message: RoomMessage;
  /** The message it answers, where it is loaded. */
  answered: RoomMessage | undefined;
  quoted?: RoomMessage;
  agentsById: Map<string, RoomAgentShown>;
  children?: ReactNode;
}) {
  const ending = answerEnding(message);
  const byAgent = writtenByAgent(message.author);
  const { you } = useContext(MessageWriters);
  const mentionsRead = useMemo(() => (message.mentions ? { mentions: message.mentions, you } : null), [message.mentions, you]);
  return (
    <div className={entryClasses(message, answered, agentsById, you)} data-room-message={message.id}>
      <div className="gutter">
        <AuthorMark author={message.author} agentsById={agentsById} />
      </div>
      <div className="entry-body">
        <div className="author">
          <AuthorName author={message.author} agentsById={agentsById} />
          {message.authorRole && <span className="room-role-label">{words.roles[message.authorRole]}</span>}
          <Timestamp at={message.at} />
        </div>
        {quoted && (
          <blockquote className="room-quote">
            <span className="room-quote-author">
              <AuthorName author={quoted.author} agentsById={agentsById} />
            </span>
            {quoted.authorRole && <span className="room-role-label">{words.roles[quoted.authorRole]}</span>}
            <span className="room-quote-text">{quoted.text}</span>
          </blockquote>
        )}
        {message.text && (
          <MentionsOfMessage.Provider value={mentionsRead}>
            <div className={`message ${byAgent ? "agent" : "user"}`}>{byAgent ? <MarkdownText text={message.text} /> : <SlackMessageText text={message.text} />}</div>
          </MentionsOfMessage.Provider>
        )}
        {ending && <div className="notice-line">{ending}</div>}
        {byAgent && message.tags.length > 0 && <div className="room-tags-line">{words.tagged(agentNames(message.tags, agentsById))}</div>}
        {message.tagsDropped && <div className="notice-line room-tags-dropped">{words.tagsDropped(agentNames(message.tagsDropped, agentsById), AGENT_TAGGED_TURNS_AFTER_A_PERSON)}</div>}
        {children}
      </div>
    </div>
  );
}

function ThreadLink({ text, onOpen, onOpenWork }: { text?: string; onOpen: () => void; onOpenWork?: () => void }) {
  return (
    <div className="room-thread-line">
      {text && <span>{text}</span>}
      <button type="button" className="link" onClick={onOpen}>
        {words.openThread}
      </button>
      {onOpenWork && (
        <button type="button" className="link" onClick={onOpenWork}>
          {words.showInItsWork}
        </button>
      )}
    </div>
  );
}

/** A line under an answer whose turn put pages or questions on the room's canvas, which opens the latest of them there. */
function CanvasLine({ items, onOpen }: { items: CanvasItem[]; onOpen: (itemId: string) => void }) {
  const shownPages = items.filter(({ kind }) => kind === "show");
  const pages = shownPages.length;
  const questions = items.filter(({ kind }) => kind === "ask").length;
  const latest = items.toSorted((a, b) => b.createdAt - a.createdAt)[0]!;
  return (
    <div className="room-thread-line room-canvas-line">
      <span>{words.madeOnCanvas(pages, questions)}</span>
      {shownPages.length > 0 && (
        <span className="room-canvas-titles">
          {shownPages.map((page) => (
            <button key={page.id} type="button" className="room-canvas-title-chip" onClick={() => onOpen(page.id)}>
              {page.title}
            </button>
          ))}
        </span>
      )}
      <button type="button" className="link" onClick={() => onOpen(latest.id)}>
        {words.openOnCanvas}
      </button>
    </div>
  );
}

/** One the room's message box tags: an agent, which the message then reaches, or a person, who is only called by it. */
type Taggable = { agent: RoomAgentShown } | { person: TaggablePerson };

const nameToTag = (taggable: Taggable) => ("agent" in taggable ? taggable.agent.name : taggable.person.name);

const keyOfTaggable = (taggable: Taggable) => ("agent" in taggable ? `agent:${taggable.agent.profileId}` : `person:${taggable.person.personId}`);

/** The agents and people to tag for the @ being written where the caret is: those whose name starts with what follows the @. */
function useTagMenu({ taggable, text, caret, take }: { taggable: Taggable[]; text: string; caret: number; take: (taggable: Taggable) => void }) {
  const query = taggable.length > 0 ? (mentionAt(text, caret)?.query ?? null) : null;
  const offered = query === null ? [] : taggable.filter((each) => nameToTag(each).toLowerCase().startsWith(query.toLowerCase()));
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const { pickedIndex, move } = usePickedSuggestion(offered.length, query);
  const open = offered.length > 0 && dismissedAt !== text;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const key = open ? suggestionKey(event) : null;
    if (!key) return false;
    if (key === "next") move(1);
    else if (key === "previous") move(-1);
    else if (key === "dismiss") setDismissedAt(text);
    else take(offered[pickedIndex]!);
    event.preventDefault();
    return true;
  };
  const menu = open ? (
    <SuggestionList id={TAG_MENU_ID} label={words.tagMenu} className="mention-paths room-tags" items={offered} keyOf={keyOfTaggable} pickedIndex={pickedIndex} onPick={take}>
      {(each) => <span className={`room-tag-option${"person" in each ? " person" : ""}`}>@{nameToTag(each)}</span>}
    </SuggestionList>
  ) : null;
  return { onKeyDown, textareaAttributes: suggestionAttributes(TAG_MENU_ID, open, pickedIndex), menu };
}

interface RoomComposerHandle {
  /** Tags the agent where the caret is and gives the composer the focus, to go on writing its task. */
  tag: (agent: RoomAgentShown) => void;
}

/**
 * A message box for the room, whose @ tags its agents and people, or, without agents to tag, for a thread's follow-ups;
 * the room's people see that you write in it while you do.
 */
function RoomComposer({
  placeholder,
  agents,
  people,
  onSend,
  tellWriting,
  ref,
}: {
  placeholder: string;
  agents: RoomAgentShown[];
  people: TaggablePerson[];
  onSend: (text: string, tags: string[]) => void;
  tellWriting: (writing: boolean) => void;
  ref?: Ref<RoomComposerHandle>;
}) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [tagged, setTagged] = useState<RoomAgentShown[]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const messageBox = useMessageBox();
  const typingAidAttributes = useTypingAidAttributes();
  const { enabled: spellCheck } = useSpellCheck();
  const [writingSignals] = useState(() => new WritingSignals(tellWriting));
  useEffect(() => () => writingSignals.stopped(), []);
  const write = (next: { text: string; caret: number }, taggedAgent: RoomAgentShown | null) => {
    writingSignals.typed(next.text);
    flushSync(() => {
      setText(next.text);
      setCaret(next.caret);
    });
    if (taggedAgent) setTagged((already) => [...already.filter(({ profileId }) => profileId !== taggedAgent.profileId), taggedAgent]);
    textarea.current?.focus();
    textarea.current?.setSelectionRange(next.caret, next.caret);
  };
  const take = (taken: Taggable) => write(withMention(text, caret, { path: nameToTag(taken), directory: false }), "agent" in taken ? taken.agent : null);
  useImperativeHandle(ref, () => ({ tag: (agent) => write(withTagAtCaret(text, caret, agent.name), agent) }));
  const tagMenu = useTagMenu({ taggable: [...agents.map((agent) => ({ agent })), ...people.map((person) => ({ person }))], text, caret, take });
  const boxAttributes = { ...typingAidAttributes, spellCheck, ...tagMenu.textareaAttributes };
  const length = roomMessageLength(text);
  const tooLong = length > ROOM_MESSAGE_MOST_CHARACTERS;
  const typed = (value: string, caretAfter: number) => {
    setText(value);
    setCaret(caretAfter);
    writingSignals.typed(value);
  };
  const send = () => {
    if (!text.trim() || tooLong) return;
    onSend(
      text,
      stillTagged(text, tagged, people, agents).map(({ profileId }) => profileId),
    );
    writingSignals.sent();
    setText("");
    setTagged([]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (tagMenu.onKeyDown(event) || movedCaretToLineEdge(event.nativeEvent)) return;
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || !enterSends(event)) return;
    event.preventDefault();
    send();
  };
  return (
    <div className="composer-area room-composer">
      <div className="composer">
        {tagMenu.menu}
        {messageBox === "formatted" ? (
          <FormattedBox text={text} facade={textarea} placeholder={placeholder} attributes={boxAttributes} onText={typed} onCaret={setCaret} onKeyDown={onKeyDown} />
        ) : (
          <textarea
            ref={textarea}
            rows={2}
            {...boxAttributes}
            value={text}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(event) => typed(event.target.value, event.target.selectionStart)}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
          />
        )}
        <div className="composer-actions">
          {messageBox === "formatted" && <FormatBarToggle />}
          <button type="button" className="primary" disabled={!text.trim() || tooLong} onClick={send}>
            {words.send}
          </button>
        </div>
      </div>
      {tooLong && (
        <div className="notice-line room-message-too-long" role="alert">
          {words.messageTooLong(formatNumber(length), formatNumber(ROOM_MESSAGE_MOST_CHARACTERS))}
        </div>
      )}
    </div>
  );
}

const writeIn = (roomId: string, text: string, tags: string[], threadId: string | null) => connection.send({ type: "room.write", roomId, text, tags, threadId });

const tellWritingIn = (roomId: string, threadId: string | null) => (writing: boolean) => connection.send({ type: "room.writing", roomId, threadId, writing });

/** Who of the others writes in the room itself, or in the thread, now. */
function WritingLine({ writing, threadId, you }: { writing: RoomWriter[]; threadId: string | null; you: string | null }) {
  const line = writingLine(usePersonNames(writersIn(writing, threadId, you)));
  return (
    <div className="room-writing" aria-live="polite">
      {line}
    </div>
  );
}

const approve = ({ roomId, profileId, request }: RoomApproval, answer: RoomApprovalAnswer) =>
  connection.send({ type: "room.approve", roomId, profileId, permissionId: request.permissionId, answer });

const answerTask = ({ roomId, messageId }: RoomTaskApproval, answer: "allow" | "deny") => connection.send({ type: "room.answer-task", roomId, messageId, answer });

type WaitingForYou =
  | { kind: "request"; approval: RoomApproval; at: number }
  | { kind: "task"; task: RoomTaskApproval; at: number }
  | { kind: "workspace"; asked: RoomWorkspaceApproval; at: number };

/** What waits for you in the room, oldest first: the agents' requests, the tasks people other than the owner gave them, and what agents people brought ask to do in the room's workspace. */
const waitingInOrder = (approvals: RoomApproval[], tasks: RoomTaskApproval[], workspace: RoomWorkspaceApproval[]): WaitingForYou[] =>
  [
    ...approvals.map((approval) => ({ kind: "request" as const, approval, at: approval.at })),
    ...tasks.map((task) => ({ kind: "task" as const, task, at: task.at })),
    ...workspace.map((asked) => ({ kind: "workspace" as const, asked, at: asked.at })),
  ].toSorted((a, b) => a.at - b.at);

/** What waits for you in the room, oldest first: the first with its answers, and how many wait in all. */
function ApprovalStrip({
  approvals,
  tasks = [],
  workspace,
  agentsById,
  you,
}: {
  approvals: RoomApproval[];
  tasks?: RoomTaskApproval[];
  workspace: RoomWorkspaceApproval[];
  agentsById: Map<string, RoomAgentShown>;
  you: string | null;
}) {
  const waiting = waitingInOrder(approvals, tasks, workspace);
  const first = waiting[0];
  if (!first) return null;
  const count = waiting.length > 1 && <span className="room-approval-count">{words.approvalPosition(waiting.length)}</span>;
  switch (first.kind) {
    case "task":
      return <TaskApproval key={first.task.messageId} task={first.task} agentsById={agentsById} count={count} />;
    case "request":
      return <RequestApproval approval={first.approval} agentsById={agentsById} you={you} count={count} />;
    case "workspace": {
      const { asked } = first;
      const agentName = agentNames([asked.agentId], agentsById);
      return asked.asks === "access" ? (
        <WorkspaceAccessApproval key={asked.agentId} asked={asked} agentName={agentName} count={count} />
      ) : (
        <WorkspaceCallApproval key={asked.callId} asked={asked} agentName={agentName} count={count} task={asked.task && <TaskOfApproval task={asked.task} you={you} />} />
      );
    }
  }
}

/**
 * A person's task that reaches no agent until you allow it: who gives it, in what role, through which agent they brought
 * if one, to which agents, all it says, and the room's other messages its agents would be sent with it.
 */
function TaskApproval({ task, agentsById, count }: { task: RoomTaskApproval; agentsById: Map<string, RoomAgentShown>; count: ReactNode }) {
  const personName = usePersonName(task.personId);
  const [wholeShown, setWholeShown] = useState(false);
  const role = words.authorRoles[task.role];
  const asked = agentNames(task.profileIds, agentsById);
  return (
    <section className="room-approvals room-task-approval" aria-label={words.approvalsWaiting} data-task-message-id={task.messageId}>
      <div className="room-approval-head">
        <span className="room-approval-asker">
          {task.byAgent === undefined ? words.taskFrom(personName, role, asked) : words.taskOnBehalfOf(agentNames([task.byAgent], agentsById), personName, role, asked)}
        </span>
        {count}
      </div>
      <div className={`room-approval-task-text${wholeShown ? " whole" : ""}`}>{task.text}</div>
      <div className="room-approval-task-size">
        <span className="room-approval-task-lines">{words.taskLines(task.text.split("\n").length)}</span>
        <button type="button" className="link" aria-expanded={wholeShown} onClick={() => setWholeShown(!wholeShown)}>
          {wholeShown ? words.showLessOfTask : words.showWholeTask}
        </button>
      </div>
      {task.sentAlong.length > 0 && <MessagesSentAlong messages={task.sentAlong} agentsById={agentsById} />}
      <div className="permission-options">
        <button type="button" className="option-allow_once" onClick={() => answerTask(task, "allow")}>
          {words.allow}
        </button>
        <button type="button" onClick={() => answerTask(task, "deny")}>
          {words.deny}
        </button>
      </div>
    </section>
  );
}

function MessagesSentAlong({ messages, agentsById }: { messages: RoomMessageSentAlong[]; agentsById: Map<string, RoomAgentShown> }) {
  const [listed, setListed] = useState(false);
  return (
    <div className="room-approval-sent-along">
      <div>
        <span>{words.sentAlong(messages.length)}</span>{" "}
        <button type="button" className="link" aria-expanded={listed} onClick={() => setListed(!listed)}>
          {listed ? words.hideSentAlong : words.showSentAlong}
        </button>
      </div>
      {listed && (
        <ol className="room-approval-sent-along-list">
          {messages.map(({ messageId, author, role, text }) => (
            <li key={messageId} data-room-message={messageId}>
              <span className="room-approval-sent-along-author">
                <AuthorName author={author} agentsById={agentsById} />
              </span>
              <span className="room-role-label">{words.authorRoles[role]}</span>
              <div className="room-approval-sent-along-text">{text}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Whose task the agent asks for it on, so the approver judges the two together. */
function TaskOfApproval({ task, you }: { task: RoomTask; you: string | null }) {
  const personName = usePersonName(task.personId);
  return <div className="room-approval-task">{task.personId === you ? words.yourTask(task.text) : words.approvalTask(personName, words.authorRoles[task.role], task.text)}</div>;
}

function RequestApproval({ approval: first, agentsById, you, count }: { approval: RoomApproval; agentsById: Map<string, RoomAgentShown>; you: string | null; count: ReactNode }) {
  const detail = first.request.command ?? first.file;
  return (
    <section className="room-approvals" aria-label={words.approvalsWaiting} data-permission-id={first.request.permissionId}>
      <div className="room-approval-head">
        <span className="room-approval-asker">{words.asks(agentsById.get(first.profileId)?.name ?? words.agentGone)}</span>
        <span className="room-approval-subject">{pendingPermissionNeeded(first.request)}</span>
        {count}
      </div>
      {detail && <code className="room-approval-detail">{detail}</code>}
      {first.outsideWorkspace && <div className="room-approval-outside">{words.outsideWorkspace}</div>}
      {first.task && <TaskOfApproval task={first.task} you={you} />}
      <div className="permission-options">
        <button type="button" className="option-allow_once" onClick={() => approve(first, "allow")}>
          {words.allow}
        </button>
        <button type="button" data-hint={hints.roomAllowForTask} onClick={() => approve(first, "allow-for-task")}>
          {words.allowForTask}
        </button>
        <button type="button" onClick={() => approve(first, "deny")}>
          {words.deny}
        </button>
      </div>
    </section>
  );
}

const callsWaiting = (workspace: RoomWorkspaceApproval[]) => workspace.flatMap((asked) => (asked.asks === "call" ? [asked] : []));

/** The threads in which an agent waits for an approver, for a request or to do something in the room's workspace. */
const threadsWaiting = (approvals: RoomApproval[], workspace: RoomWorkspaceApproval[]) => new Set([...approvals, ...callsWaiting(workspace)].flatMap(({ threadId }) => threadId ?? []));

const isAnswerOfAgent = (message: RoomMessage, profileId: string) => writtenByAgent(message.author) && message.author.profileId === profileId;

/** What an agent someone brought did in the room's workspace during the turn that produced `answer`. */
function workspaceCallsOfAnswer(timeline: RoomTimelineWithCanvas, answer: RoomMessage): RoomWorkspaceCall[] {
  if (answer.answers === undefined || !answer.threadId || !writtenByAgent(answer.author)) return [];
  const thread = timeline.threads.find(({ id }) => id === answer.threadId);
  if (!thread) return [];
  const callsInThread = timeline.workspaceCalls.filter(({ threadId }) => threadId === thread.id);
  if (callsInThread.length === 0) return [];
  const threadMessages = messagesOfThread(timeline, thread);
  const index = threadMessages.findIndex(({ id }) => id === answer.id);
  if (index <= 0) return [];
  const previous = threadMessages[index - 1]!;
  return threadItemsBetween(callsInThread, { at: previous.at, byThisAgent: isAnswerOfAgent(previous, thread.profileId) }, { at: answer.at, byThisAgent: true });
}

/** A guest writes in the room, but tags none of its agents and follows up in none of their threads; the owner is no guest anywhere. */
const isGuestIn = (room: Room, you: string | null) => room.people.some(({ personId, role }) => personId === you && role === "guest");

/** With the agent's conversation here, its events tell its answers; without one, as on a person's page or for an agent someone brought, the room's answer messages do. */
const threadMessagesShown = (timeline: RoomTimeline, thread: RoomThread, agent: RoomAgentShown) =>
  agent.conversation ? askedInThread(timeline, thread) : messagesOfThread(timeline, thread);

function ThreadColumn({
  thread,
  timeline,
  pending,
  agent,
  opened,
  agentsById,
  waitedIn,
  waitingForYou,
  workspaceCalls,
  broughtSteps,
  workspaceWaitingForYou,
  answersWorkspace,
  you,
  followsUp,
  onlyReads,
  peopleToTag,
  writing,
  onClose,
}: {
  thread: RoomThread;
  timeline: RoomTimeline;
  pending: WorkPending[];
  agent: RoomAgentShown;
  opened: OpenConversation | undefined;
  agentsById: Map<string, RoomAgentShown>;
  /** The threads in which an agent waits for an approver. */
  waitedIn: Set<string>;
  waitingForYou: RoomApproval[];
  workspaceCalls: RoomWorkspaceCall[];
  broughtSteps: RoomBroughtStep[];
  workspaceWaitingForYou: RoomWorkspaceApproval[];
  /** You let agents people brought into the room's workspace, and take that away. */
  answersWorkspace: boolean;
  you: string | null;
  followsUp: boolean;
  /** Someone other than the machine's owner reads the agent's work there, and acts on none of it. */
  onlyReads: boolean;
  peopleToTag: TaggablePerson[];
  writing: RoomWriter[];
  onClose: () => void;
}) {
  const shownHere = threadMessagesShown(timeline, thread, agent);
  const messagesById = useMemo(() => new Map(timeline.messages.map((message) => [message.id, message])), [timeline.messages]);
  const firstReached = firstReachingTheAgent(timeline, thread, agent.answering);
  const workingLine = workUnderWay(pending, agentsById, waitedIn, workspaceCalls).find((work) => work.thread.id === thread.id)?.text;
  const callsHere = workspaceCalls.filter(({ threadId }) => threadId === thread.id);
  const stepsHere = broughtSteps.filter(({ threadId }) => threadId === thread.id);
  const access = agent.brought?.workspace;
  const { ref: threadTimeline, onScroll, jumpToLatest } = useScrollAnchor();
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };
  const [threadPrefix = "", threadSuffix = ""] = words.thread("\0").split("\0");
  const isYourBroughtAgent = agent.brought !== undefined && you !== null && agent.brought.personId === you;
  const opensWorkInParent = isYourBroughtAgent && shownInAnotherMirador();
  return (
    <aside className="side-chat room-thread" aria-label={words.thread(agent.name)} onKeyDown={closeOnEscape}>
      <header className="side-chat-header">
        <div className="side-chat-heading">
          <h2>
            <HintedWhenCutShort className="room-thread-title" whole={words.thread(agent.name)}>
              {agent.brought ? <BroughtAgentName prefix={threadPrefix} name={agent.brought.name} bringer={agent.brought.bringer} suffix={threadSuffix} /> : words.thread(agent.name)}
            </HintedWhenCutShort>
          </h2>
        </div>
        <button type="button" className="icon" aria-label={words.closeThread} onClick={onClose}>
          ×
        </button>
      </header>
      {access ? (
        <WorkspaceAccessLine roomId={thread.roomId} agentId={agent.profileId} agentName={agent.name} access={access} answers={answersWorkspace} />
      ) : (
        agent.brought && <div className="workspace-access">{words.worksInOwnWorkspaceOf(agent.brought.bringer)}</div>
      )}
      <div className="timeline" ref={threadTimeline} onScroll={onScroll}>
        {agent.conversation && opened?.loaded && firstReached && <HistoryReachingBack opened={opened} messageId={firstReached.id} />}
        {shownHere.map((message, index) => {
          const askedThisAgent = !isAnswerOfAgent(message, agent.profileId);
          const next = shownHere[index + 1];
          const from = { at: message.at, byThisAgent: !askedThisAgent };
          const to = next ? { at: next.at, byThisAgent: isAnswerOfAgent(next, agent.profileId) } : undefined;
          const callsForTurn = threadItemsBetween(callsHere, from, to);
          const stepsForTurn = threadItemsBetween(stepsHere, from, to);
          const finalAnswerText = next && isAnswerOfAgent(next, agent.profileId) ? next.text : undefined;
          const stepsStayOnComputer = access !== "allowed";
          return (
            <div key={message.id} className="room-thread-turn">
              <RoomEntry message={message} answered={message.answers === undefined ? undefined : messagesById.get(message.answers)} agentsById={agentsById} />
              <BroughtThreadActivity calls={callsForTurn} steps={stepsForTurn} finalAnswerText={finalAnswerText} />
              {!agent.conversation && isYourBroughtAgent && askedThisAgent && (stepsStayOnComputer || opensWorkInParent) && (
                <div className="room-brought-steps-link">
                  {stepsStayOnComputer && <span className="hint">{words.broughtStepsOnYourComputer}</span>}
                  {opensWorkInParent && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => askParentToOpenBroughtWork({ roomId: thread.roomId, agentId: agent.profileId, messageSeq: message.seq })}
                    >
                      {words.showInItsWork}
                    </button>
                  )}
                </div>
              )}
              {agent.conversation && opened?.loaded && <TimelineOfEvents conversation={agent.conversation} events={eventsAnswering(opened.events, message.id)} agentName={agent.name} onlyReads={onlyReads} />}
            </div>
          );
        })}
        {workingLine && <div className="working">{workingLine}</div>}
        <WritingLine writing={writing} threadId={thread.id} you={you} />
      </div>
      <ApprovalStrip
        approvals={waitingForYou.filter(({ threadId }) => threadId === thread.id)}
        workspace={callsWaiting(workspaceWaitingForYou).filter(({ threadId }) => threadId === thread.id)}
        agentsById={agentsById}
        you={you}
      />
      {followsUp && (
        <RoomComposer
          placeholder={words.followUpPlaceholder(agent.name)}
          agents={[]}
          people={peopleToTag}
          onSend={(text) => {
            writeIn(thread.roomId, text, [], thread.id);
            jumpToLatest();
          }}
          tellWriting={tellWritingIn(thread.roomId, thread.id)}
        />
      )}
    </aside>
  );
}

/** Asks the host for earlier parts of the agent's conversation until they reach back to the room message, so its thread shows all the work on it. */
function HistoryReachingBack({ opened, messageId }: { opened: OpenConversation; messageId: string }) {
  const earlier = useEarlierHistory(opened);
  const reached = reachedAmong(opened.events, messageId);
  useEffect(() => {
    if (!reached && earlier.available && !earlier.loading) earlier.load();
  });
  return null;
}

const LIVE_CALL_ABOUT_MAX = 60;

/**
 * What the room shows of its agents' work under way: a line for each message an agent has to answer, and whether it
 * works on it, runs a workspace call, waits for approval in it, comes to it later, or waits for its task to be allowed.
 */
function workUnderWay(pending: WorkPending[], agentsById: Map<string, RoomAgentShown>, waitedIn: Set<string>, workspaceCalls: RoomWorkspaceCall[]) {
  const sent = pending.filter(({ message }) => !taskWaits(message));
  return pending.map(({ message, thread }) => {
    const agent = agentsById.get(thread.profileId);
    const name = agent?.name ?? words.agentGone;
    const first = sent.find((each) => each.thread.profileId === thread.profileId)?.message === message;
    const runningCall = first ? workspaceCalls.findLast((call) => call.threadId === thread.id && call.state === "running") : undefined;
    const text = taskWaits(message)
      ? words.taskWaits(name)
      : waitedIn.has(thread.id)
        ? words.waitingForApproval(name)
        : !first
          ? words.waiting(name)
          : agent?.brought && agent.answering === null
            ? words.notStartedYet(name)
            : runningCall
              ? words.workingOnCall[runningCall.kind](name, cutWithEllipsis(oneLine(runningCall.about), LIVE_CALL_ABOUT_MAX))
              : words.working(name);
    return { key: `${message.id}-${thread.id}`, thread, text };
  });
}

type RoleShown = "owner" | RoomRole | null;

/**
 * The model an agent of the room runs on: the one chosen in the room, else the one its session is on, by the name its
 * session lists, else the one its agent offered when this page asked it.
 */
function modelNameOf(agent: RoomAgentShown) {
  const live = agent.conversation?.configOptions ?? [];
  const value = agent.model.model ?? chosenModel(live)?.id ?? agent.profile?.model;
  const listed = categoryChoices(live, "model").length > 0 || !agent.profile ? live : offeredAlready(agent.profile.id);
  return value ? (categoryChoices(listed, "model").find((choice) => choice.value === value)?.name ?? value) : null;
}

/** Which workspace a brought agent works in, as the room knows it: this room's (with its access state), or its bringer's own. */
const broughtWorkspaceOf = (brought: BroughtAgent & { bringer: string }) =>
  brought.workspace ? words.workspaceAccess[brought.workspace] : words.worksInOwnWorkspaceOf(brought.bringer);

/**
 * An agent in the room's bar: its mark and name, and for the owner its model quietly beside them; cut short where the
 * bar is narrow, whole in a hint then. Clicking opens a card showing where it runs, which workspace it sees, and what
 * it can do in the room.
 */
function AgentChip({
  room,
  agent,
  showsModel,
  owns,
  answersWorkspace,
  onOpenWork,
}: {
  room: Room;
  agent: RoomAgentShown;
  showsModel: boolean;
  owns: boolean;
  answersWorkspace: boolean;
  onOpenWork?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => setPlacement(open && opener.current ? placedBelowOnItsSide(opener.current) : null), [open]);
  useClosing(placement !== null, [opener, popover], () => setOpen(false));
  useKeptInWindow(popover, placement);

  const model = showsModel ? modelNameOf(agent) : null;
  const whereItRuns =
    agent.brought &&
    [agent.brought.here ? words.onComputerOf(agent.brought.bringer) : words.awayFrom(agent.brought.bringer), broughtWorkspaceOf(agent.brought)].join(" · ");
  const markPrefix = agent.harness ? `${agentMarks[agent.harness]} ` : "";
  const runsOnText = agent.brought
    ? agent.brought.here
      ? words.onComputerOf(agent.brought.bringer)
      : words.awayFrom(agent.brought.bringer)
    : owns
      ? words.agentCard.thisComputer
      : words.agentCard.roomsMachine;
  const workspaceText = agent.brought
    ? broughtWorkspaceOf(agent.brought)
    : owns && room.sandbox.on
      ? words.agentCard.roomsWorkspaceSandboxed
      : `${words.agentCard.roomsWorkspace} · ${words.presets[room.permissions]}`;
  const capabilities = agent.brought
    ? [
        words.agentCard.repliesInRoom,
        words.agentCard.usesRoomCanvas,
        agent.brought.workspace === "allowed"
          ? words.agentCard.workspaceStepsAndCallsInThread
          : agent.brought.workspace
            ? words.agentCard.workspaceCallsInThread(agent.brought.bringer)
            : words.agentCard.stepsStayOnComputer(agent.brought.bringer),
      ]
    : [words.agentCard.repliesInRoom, words.agentCard.usesRoomCanvas, words.agentCard.stepsInThread];

  return (
    <li className={`agent-chip${agent.brought && !agent.brought.here ? " away" : ""}`} data-hint={whereItRuns || undefined}>
      <button
        ref={opener}
        type="button"
        className="room-agent-chip-trigger"
        aria-haspopup="dialog"
        aria-expanded={placement !== null}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <HintedWhenCutShort className="room-agent-label" whole={[agent.name, model, whereItRuns].filter(Boolean).join(" · ")}>
          {agent.brought ? <BroughtAgentName prefix={markPrefix} name={agent.brought.name} bringer={agent.brought.bringer} /> : `${markPrefix}${agent.name}`}
          {model && <span className="room-agent-model">{model}</span>}
        </HintedWhenCutShort>
      </button>
      {placement && (
        <div ref={popover} className="room-agent-card" role="dialog" aria-label={agent.name} style={placement}>
          <div className="room-agent-card-head">
            <span className={`avatar agent-${agent.harness ?? "gone"}`} aria-hidden="true">
              {agent.harness ? agentMarks[agent.harness] : "?"}
            </span>
            <span className="room-agent-card-name">{agent.name}</span>
            {agent.answering !== null && <span className="room-agent-working">{words.agentWorking}</span>}
          </div>
          <dl className="room-agent-card-facts">
            <div>
              <dt>{words.agentCard.runsOn}</dt>
              <dd>{runsOnText}</dd>
            </div>
            <div>
              <dt>{words.agentCard.workspace}</dt>
              <dd>{workspaceText}</dd>
            </div>
          </dl>
          <div className="room-agent-card-section">
            <h3>{words.agentCard.capabilities}</h3>
            <ul>
              {capabilities.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          </div>
          {owns && !agent.brought && (
            <div className="room-agent-card-actions">
              <ModelChoice
                agentName={agent.name}
                profile={agent.profile}
                conversation={agent.conversation}
                chosen={agent.model}
                onChange={(chosen) => connection.send({ type: "room.set-agent-model", roomId: room.id, profileId: agent.profileId, ...chosen })}
              />
            </div>
          )}
          {agent.brought?.workspace && answersWorkspace && (
            <WorkspaceAccessLine roomId={room.id} agentId={agent.profileId} agentName={agent.name} access={agent.brought.workspace} answers={answersWorkspace} />
          )}
          {onOpenWork && (
            <div className="room-agent-card-actions">
              <button
                type="button"
                className="link"
                onClick={() => {
                  setOpen(false);
                  onOpenWork();
                }}
              >
                {words.showInItsWork}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** The room's people as this page knows them, each with their role where it is known: the owner, everyone the room lets in, and whoever else is here now. */
function peopleOfRoom(room: Room, ownerId: string | null, here: string[]): { personId: string; role: RoleShown }[] {
  const known: { personId: string; role: RoleShown }[] = [...(ownerId ? [{ personId: ownerId, role: "owner" as const }] : []), ...room.people];
  const knownIds = new Set(known.map(({ personId }) => personId));
  return [...known, ...here.filter((personId) => !knownIds.has(personId)).map((personId) => ({ personId, role: null }))];
}

/** The people of the room you can tag: everyone there with a name but you, by the name they go by, whom the host finds in the message too. */
const taggablePeople = (room: Room, ownerId: string | null, people: Person[], you: string | null): TaggablePerson[] =>
  [...(ownerId ? [{ personId: ownerId }] : []), ...room.people.filter(({ nameClash }) => nameClash === undefined)].flatMap(({ personId }) => {
    const name = people.find(({ id }) => id === personId)?.name.trim();
    return name && personId !== you ? [{ personId, name }] : [];
  });

/** Whether the room notifies you; muted, what you have not read still counts. */
function MuteToggle({ roomId, muted }: { roomId: string; muted: boolean }) {
  return (
    <button
      type="button"
      className={`icon room-mute${muted ? " muted" : ""}`}
      aria-label={words.muteRoom}
      aria-pressed={muted}
      data-hint={muted ? words.mutedHint : words.muteRoom}
      onClick={() => connection.send({ type: "room.mute", roomId, muted: !muted })}
    >
      <LineIcon shape={muted ? "bellOff" : "bell"} />
    </button>
  );
}

const isAsk = (item: CanvasItem): item is AskItem => item.kind === "ask";

/** Questions its agents wait on that no answer of theirs holds yet, as while the turn that asks is still under way. */
function questionsOfNoAnswer(canvas: CanvasItem[], canvasOfAnswers: Map<string, CanvasItem[]>) {
  const held = new Set([...canvasOfAnswers.values()].flat().map(({ id }) => id));
  return canvas.filter(isAsk).filter((item) => item.status === "waiting" && !held.has(item.id));
}

/** Where an agent a person brought runs, or that it is away while their Mirador is. */
function BroughtMark({ brought }: { brought: BroughtAgent & { bringer: string } }) {
  return <span className={`room-agent-brought${brought.here ? "" : " away"}`}>{brought.here ? words.onComputerOf(brought.bringer) : words.awayFrom(brought.bringer)}</span>;
}

/** The most people waiting at the door the room's banner names; the room's list of people has them all. */
const DOOR_BANNER_MOST = 3;

/**
 * Above the room's messages while people wait at its door, for its owner: the first few, each to let in or turn away,
 * and how many more wait, which opens the room's list of people once the page knows who is here.
 */
function DoorBanner({ joiners, onShowAll }: { joiners: RoomJoiner[]; onShowAll: (() => void) | null }) {
  if (joiners.length === 0) return null;
  const more = joiners.length - DOOR_BANNER_MOST;
  return (
    <section className="room-door-banner" aria-label={words.peopleWaitingToJoin}>
      <div className="room-door-banner-head">{words.waitingAtTheDoor(joiners.length)}</div>
      <ul className="room-joiners">
        {joiners.slice(0, DOOR_BANNER_MOST).map((joiner) => (
          <JoinerAtTheDoor key={joiner.personId} joiner={joiner} />
        ))}
      </ul>
      {more > 0 && onShowAll && (
        <button type="button" className="link room-door-banner-more" aria-haspopup="dialog" onClick={onShowAll}>
          {words.andMoreWaiting(more)}
        </button>
      )}
    </section>
  );
}

/** What a room shows before anyone writes in it: the agents you can give a task, each a tag to put in the composer, and for its owner, a way to invite people. */
function EmptyRoom({ tagsAgents, agentsToTag, onTag, onInvite }: { tagsAgents: boolean; agentsToTag: RoomAgentToTag[]; onTag: (agent: RoomAgentShown) => void; onInvite: (() => void) | null }) {
  const tagToStartId = useId();
  return (
    <section className="room-empty" aria-label={words.emptyTitle}>
      <h3>{words.emptyTitle}</h3>
      {agentsToTag.length > 0 && (
        <>
          <p id={tagToStartId}>{words.tagToStart}</p>
          <ul className="room-empty-agents" aria-labelledby={tagToStartId}>
            {agentsToTag.map((agent) => (
              <li key={agent.profileId}>
                <button type="button" className="room-empty-agent" onClick={() => onTag(agent)}>
                  <span className={`avatar agent-${agent.harness}`} aria-hidden="true">
                    {agentMarks[agent.harness]}
                  </span>
                  @{agent.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p>{tagsAgents ? words.agentsHint : words.emptyForGuest}</p>
      {onInvite && (
        <button type="button" className="room-empty-invite" onClick={onInvite}>
          {words.invitePeople}
        </button>
      )}
    </section>
  );
}

function PersonListed({ roomId, personId, role, isHere, removable }: { roomId: string; personId: string; role: RoleShown; isHere: boolean; removable: boolean }) {
  const name = usePersonName(personId);
  return (
    <li>
      <PersonAvatar personId={personId} />
      <PersonName personId={personId} />
      {role && <span className="room-role-label">{words.authorRoles[role]}</span>}
      {isHere && <span className="room-here-mark" role="img" aria-label={words.isHere} data-hint={words.isHere} />}
      {removable && <RemovePerson roomId={roomId} personId={personId} name={name} />}
    </li>
  );
}

/**
 * "3 here" in the room's bar, which opens who is in the room, whom the owner removes there, who of them is here now, and
 * which agents work, on which model for the owner, who changes it there; the room's door banner opens it too.
 */
function RoomPeople({
  room,
  agents,
  here,
  joiners,
  ownerId,
  owns,
  shown,
  onShownChange,
  onOwnProfile,
}: {
  room: Room;
  agents: RoomAgentShown[];
  here: string[];
  joiners: RoomJoiner[];
  ownerId: string | null;
  owns: boolean;
  shown: boolean;
  onShownChange: (shown: boolean) => void;
  onOwnProfile?: () => void;
}) {
  const opener = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => setPlacement(shown && opener.current ? placedBelowOnItsSide(opener.current) : null), [shown]);
  useClosing(placement !== null, [opener, popover], () => onShownChange(false));
  useKeptInWindow(popover, placement);
  const hereNow = new Set(here);
  return (
    <>
      <button
        ref={opener}
        type="button"
        className="room-here-count"
        data-hint={words.peopleOfRoom}
        aria-haspopup="dialog"
        aria-expanded={placement !== null}
        onClick={() => onShownChange(!shown)}
      >
        {words.hereCount(here.length)}
        {owns && joiners.length > 0 && (
          <>
            {" "}
            <span className="room-door-waiting">{words.waitingCount(joiners.length)}</span>
          </>
        )}
      </button>
      {placement && (
        <div ref={popover} className="room-people" role="dialog" aria-label={words.peopleOfRoom} style={placement}>
          <h3>{words.people}</h3>
          <ul aria-label={words.people}>
            {peopleOfRoom(room, ownerId, here).map(({ personId, role }) => (
              <PersonListed key={personId} roomId={room.id} personId={personId} role={role} isHere={hereNow.has(personId)} removable={owns && isRoomRole(role)} />
            ))}
          </ul>
          {onOwnProfile && (
            <button
              type="button"
              className="link"
              onClick={() => {
                onShownChange(false);
                onOwnProfile();
              }}
            >
              {t.settings.ownProfile.title}
            </button>
          )}
          {owns && <WaitingToJoin joiners={joiners} />}
          {agents.length > 0 && (
            <>
              <h3>{words.agents}</h3>
              <ul aria-label={words.agents}>
                {agents.map(({ profileId, name, harness, brought, profile, conversation, answering, model }) => (
                  <li key={profileId} className="room-people-agent">
                    <div className="room-people-agent-line">
                      <span className={`avatar agent-${harness ?? "gone"}`} aria-hidden="true">
                        {harness ? agentMarks[harness] : "?"}
                      </span>
                      <span className="room-people-agent-name">{name}</span>
                      {brought && <BroughtMark brought={brought} />}
                      {answering !== null && <span className="room-agent-working">{words.agentWorking}</span>}
                    </div>
                    {brought && <div className="room-people-agent-workspace">{broughtWorkspaceOf(brought)}</div>}
                    {owns && !brought && (
                      <div className="room-people-agent-choices">
                        <ModelChoice
                          agentName={name}
                          profile={profile}
                          conversation={conversation}
                          chosen={model}
                          onChange={(chosen) => connection.send({ type: "room.set-agent-model", roomId: room.id, profileId, ...chosen })}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}

export function RoomView({
  room,
  timeline,
  profiles,
  roomConversations,
  threadConversations,
  people,
  ownerId,
  ownerPicture,
  approvals,
  tasks,
  workspaceWaiting,
  heldChanges,
  holdsTooMany,
  homeDir,
  presence,
  joiners,
  muted,
  offersMute = true,
  you,
  onOwnProfile,
  dispatch,
  onOpenOnCanvas,
}: {
  room: Room;
  timeline: RoomTimelineWithCanvas | null;
  profiles: Profile[];
  roomConversations: Conversation[];
  threadConversations: OpenConversation[];
  people: Person[];
  ownerId: string | null;
  ownerPicture: string | null;
  /** The requests the room's agents wait on, oldest first. */
  approvals: RoomApproval[];
  /** The tasks of people other than the owner that wait for an approver, oldest first. */
  tasks: RoomTaskApproval[];
  /** What agents people brought wait on for an approver, to work in the room's workspace. */
  workspaceWaiting: RoomWorkspaceApproval[];
  /** The room's agent config file changes held for the owner, oldest first. */
  heldChanges: HeldChange[];
  /** Whether its sandbox stopped as it holds as many changes as a room may. */
  holdsTooMany: boolean;
  homeDir: string;
  /** Who is in the room now and who of them writes, once the host said. */
  presence: RoomPresence | null;
  /** Who waits at the room's door for its owner to let them in; only the owner is told. */
  joiners: RoomJoiner[];
  /** Whether the room notifies you. */
  muted: boolean;
  offersMute?: boolean;
  you: string | null;
  /** Opens your own name and colour, offered with the room's people where the page has no other place for it. */
  onOwnProfile?: () => void;
  dispatch: Dispatch<AppAction>;
  onOpenOnCanvas: (itemId: string) => void;
}) {
  const [sidePanel, setSidePanel] = useState<{ kind: "thread"; threadId: string } | { kind: "workspace" } | null>(null);
  const [peopleShown, setPeopleShown] = useState(false);
  const openThread = (id: string) => setSidePanel({ kind: "thread", threadId: id });
  const closeSidePanel = () => setSidePanel(null);
  const threadId = sidePanel?.kind === "thread" ? sidePanel.threadId : null;
  const agents = room.agents.map(({ profileId, conversationId, answering, model, effort, brought }): RoomAgentShown => {
    const conversation = roomConversations.find(({ id }) => id === conversationId);
    if (brought) {
      const bringer = personGoesBy(people.find(({ id }) => id === brought.personId), words.nameless);
      return { profileId, name: broughtAgentName(bringer, brought.name), harness: brought.harness, brought: { ...brought, bringer }, profile: undefined, conversation, answering, model: { model, effort } };
    }
    const profile = profiles.find(({ id }) => id === profileId);
    return { profileId, name: profile?.name ?? words.agentGone, harness: profile?.harness, brought: undefined, profile, conversation, answering, model: { model, effort } };
  });
  const owns = you !== null && you === ownerId;
  const openSettings = (tab?: RoomSettingsTab) => dispatch({ type: "open-overlay", overlay: { kind: "room", roomId: room.id, tab } });
  const invite = () => dispatch({ type: "open-overlay", overlay: { kind: "room-invite", roomId: room.id } });
  const agentsById = new Map(agents.map((agent) => [agent.profileId, agent]));
  const tagsAgents = !isGuestIn(room, you);
  const agentsToTag = tagsAgents ? agents.filter(isTaggable) : [];
  const composer = useRef<RoomComposerHandle>(null);
  const peopleToTag = taggablePeople(room, ownerId, people, you);
  const waitingForYou = approvals.filter(({ approvers }) => you !== null && approvers.includes(you));
  const tasksWaitingForYou = tasks.filter(({ approvers }) => you !== null && approvers.includes(you));
  const workspaceWaitingForYou = workspaceWaiting.filter(({ approvers }) => you !== null && approvers.includes(you));
  const waitedIn = threadsWaiting(approvals, workspaceWaiting);
  const thread = timeline?.threads.find(({ id }) => id === threadId) ?? null;
  const threadAgent = thread ? agentsById.get(thread.profileId) : undefined;
  const threadConversationId = threadAgent?.conversation?.id ?? null;
  useEffect(() => dispatch({ type: "keep-thread-conversations", conversationIds: threadConversationId ? [threadConversationId] : [] }), [threadConversationId]);
  const messageWriters = useMemo(() => ({ people, ownerId, ownerPicture, you }), [people, ownerId, ownerPicture, you]);
  const messagesById = new Map(timeline?.messages.map((message) => [message.id, message]));
  const shown = timeline?.messages.filter(shownInRoom) ?? [];
  const canvasOfAnswers = useMemo(
    () =>
      timeline
        ? canvasItemsOfAnswers(timeline.messages, timeline.canvas, (profileId) => {
            const agent = room.agents.find((each) => each.profileId === profileId);
            return agent?.brought ? agentStandIn(room.id, profileId) : agent?.conversationId;
          })
        : new Map<string, CanvasItem[]>(),
    [timeline, room.id, room.agents],
  );
  const authorOf = useMemo(() => roomCanvasAuthorOf(room, profiles, people, words.nameless), [room, profiles, people]);
  const votesOf = new Map(timeline?.votes.map((votes): [string, RoomQuestionVotes] => [votes.itemId, votes]));
  const voteOn = (item: AskItem) => (
    <RoomVote
      key={item.id}
      roomId={room.id}
      item={item}
      votes={votesOf.get(item.id)}
      you={you}
      takesOwnWords={owns || approvesIn(room, you) || !room.peoplesTasksWait}
      asker={authorOf(item) ?? undefined}
      onShowOnCanvas={item.status === "waiting" ? () => onOpenOnCanvas(item.id) : undefined}
    />
  );
  const canOpenBroughtWork = (profileId: string) => {
    const agent = agentsById.get(profileId);
    return shownInAnotherMirador() && agent?.brought !== undefined && you !== null && agent.brought.personId === you;
  };
  const pending = timeline ? workPending(timeline, room.agents) : [];
  const writing = presence?.writing ?? [];
  const { ref: roomTimeline, onScroll, awayFromLatest, jumpToLatest } = useScrollAnchor();
  const main = (
    <>
      <header className="chat-header room-header" data-pane-bar>
        <LayoutToggles />
        <h2 className="room-title"># {room.name}</h2>
        {agents.length > 0 && (
          <ul className="room-agents" aria-label={words.agents}>
            {agents.map((agent) => (
              <AgentChip
                key={agent.profileId}
                room={room}
                agent={agent}
                showsModel={owns && !agent.brought}
                owns={owns}
                answersWorkspace={owns || approvesIn(room, you)}
                onOpenWork={canOpenBroughtWork(agent.profileId) ? () => askParentToOpenBroughtWork({ roomId: room.id, agentId: agent.profileId }) : undefined}
              />
            ))}
          </ul>
        )}
        <div className="room-header-actions">
          {timeline && timeline.workspaceCalls.length > 0 && (
            <button
              type="button"
              className="room-workspace-activity-button"
              aria-pressed={sidePanel?.kind === "workspace"}
              onClick={() => setSidePanel((current) => (current?.kind === "workspace" ? null : { kind: "workspace" }))}
            >
              {words.workspaceActivityCount(timeline.workspaceCalls.length)}
            </button>
          )}
          {owns && room.sandbox.on && (
            <button type="button" className="room-sandboxed" data-hint={words.sandboxedHint} onClick={() => openSettings("permissions")}>
              <LineIcon shape="shield" />
              {words.sandboxed}
            </button>
          )}
          {presence && (
            <RoomPeople room={room} agents={agents} here={presence.here} joiners={joiners} ownerId={ownerId} owns={owns} shown={peopleShown} onShownChange={setPeopleShown} onOwnProfile={onOwnProfile} />
          )}
          {offersMute && <MuteToggle roomId={room.id} muted={muted} />}
          {owns && (
            <button type="button" className="room-invite-button" onClick={invite}>
              {words.inviteSomeone}
            </button>
          )}
          {owns && (
            <button type="button" className="icon room-settings-button" aria-label={words.editRoom} data-hint={words.editRoom} onClick={() => openSettings()}>
              <LineIcon shape="sliders" />
            </button>
          )}
        </div>
      </header>
      {owns && <DoorBanner joiners={joiners} onShowAll={presence ? () => setPeopleShown(true) : null} />}
      <div className="timeline room-timeline" ref={roomTimeline} onScroll={onScroll}>
        {!timeline && <div className="notice-line">{words.loading}</div>}
        {timeline && shown.length === 0 && <EmptyRoom tagsAgents={tagsAgents} agentsToTag={agentsToTag} onTag={(agent) => composer.current?.tag(agent)} onInvite={owns ? invite : null} />}
        {shown.map((message) => {
          const madeOnCanvas = canvasOfAnswers.get(message.id) ?? [];
          const answered = message.answers === undefined ? undefined : messagesById.get(message.answers);
          const answeringAgentId = writtenByAgent(message.author) ? message.author.profileId : null;
          const callsForAnswer = timeline ? workspaceCallsOfAnswer(timeline, message) : [];
          const openWork =
            answeringAgentId !== null && canOpenBroughtWork(answeringAgentId)
              ? () => askParentToOpenBroughtWork({ roomId: room.id, agentId: answeringAgentId, ...(answered && { messageSeq: answered.seq }) })
              : undefined;
          return (
            <RoomEntry key={message.id} message={message} answered={answered} quoted={answered} agentsById={agentsById}>
              {callsForAnswer.length > 0 && message.threadId && <WorkspaceActivityLine calls={callsForAnswer} onOpenThread={() => openThread(message.threadId!)} />}
              {madeOnCanvas.length > 0 && <CanvasLine items={madeOnCanvas} onOpen={onOpenOnCanvas} />}
              {madeOnCanvas.filter(isAsk).map(voteOn)}
              {message.answers !== undefined && message.threadId && <ThreadLink onOpen={() => openThread(message.threadId!)} onOpenWork={openWork} />}
            </RoomEntry>
          );
        })}
        {timeline && questionsOfNoAnswer(timeline.canvas, canvasOfAnswers).map(voteOn)}
        {workUnderWay(pending, agentsById, waitedIn, timeline?.workspaceCalls ?? []).map(({ key, thread: working, text }) => {
          const pendingItem = pending.find(({ thread: each }) => each.id === working.id);
          const openWork = canOpenBroughtWork(working.profileId)
            ? () => askParentToOpenBroughtWork({ roomId: room.id, agentId: working.profileId, ...(pendingItem && { messageSeq: pendingItem.message.seq }) })
            : undefined;
          return <ThreadLink key={key} text={text} onOpen={() => openThread(working.id)} onOpenWork={openWork} />;
        })}
        <WritingLine writing={writing} threadId={null} you={you} />
      </div>
      {awayFromLatest && <JumpToLatest onJump={jumpToLatest} />}
      {owns && <HeldChangeCard changes={heldChanges} holdsTooMany={holdsTooMany} agentName={(profileId) => agentsById.get(profileId)?.name ?? nameOf(profiles, profileId)} countOf={words.approvalPosition} homeDir={homeDir} />}
      <ApprovalStrip approvals={waitingForYou} tasks={tasksWaitingForYou} workspace={workspaceWaitingForYou} agentsById={agentsById} you={you} />
      <RoomComposer
        ref={composer}
        placeholder={tagsAgents ? words.placeholder(room.name) : words.guestPlaceholder(room.name)}
        agents={agentsToTag}
        people={peopleToTag}
        onSend={(text, tags) => {
          writeIn(room.id, text, tags, null);
          jumpToLatest();
        }}
        tellWriting={tellWritingIn(room.id, null)}
      />
    </>
  );
  const side =
    sidePanel?.kind === "workspace" && timeline ? (
      <WorkspaceActivityPanel
        calls={timeline.workspaceCalls}
        agentNameOf={(agentId) => agentsById.get(agentId)?.name ?? words.agentGone}
        onOpenThread={openThread}
        onClose={closeSidePanel}
      />
    ) : thread && threadAgent && timeline ? (
      <ThreadColumn
        key={thread.id}
        thread={thread}
        timeline={timeline}
        pending={pending}
        agent={threadAgent}
        opened={threadConversations.find(({ conversationId }) => conversationId === threadConversationId)}
        agentsById={agentsById}
        waitedIn={waitedIn}
        waitingForYou={waitingForYou}
        workspaceCalls={timeline.workspaceCalls}
        broughtSteps={timeline.broughtSteps}
        workspaceWaitingForYou={workspaceWaitingForYou}
        answersWorkspace={owns || approvesIn(room, you)}
        you={you}
        followsUp={tagsAgents}
        onlyReads={!owns}
        peopleToTag={peopleToTag}
        writing={writing}
        onClose={closeSidePanel}
      />
    ) : null;
  return (
    <MessageWriters.Provider value={messageWriters}>
      <ConversationWithSide main={main} side={side} />
    </MessageWriters.Provider>
  );
}

/** The room's canvas: its agents' pages and questions, newest in front, which everyone in the room reads there and votes on in the room. */
export function RoomCanvas({
  room,
  profiles,
  people,
  items,
  shown,
  assetsOrigin,
  homeDir,
  canvasViews,
  itemToShow,
  readOnly,
  onHide,
}: {
  room: Room;
  profiles: Profile[];
  people: Person[];
  items: CanvasItem[];
  shown: boolean;
  assetsOrigin: string;
  homeDir: string;
  canvasViews: Record<string, string>;
  itemToShow: { itemId: string } | null;
  readOnly: boolean;
  onHide: () => void;
}) {
  const authorOf = useMemo(() => roomCanvasAuthorOf(room, profiles, people, words.nameless), [room, profiles, people]);
  return (
    <div className="kept-canvas" style={{ display: shown ? "contents" : "none" }}>
      <CanvasShown.Provider value={shown}>
        <CanvasPanel
          conversationId={room.id}
          items={items}
          plan={null}
          edits={NO_EDITS}
          assetsOrigin={assetsOrigin}
          homeDir={homeDir}
          changesRefreshPoint={0}
          apps={NO_APPS}
          workspaceTabs={NO_WORKSPACE_TABS}
          workspaceId={undefined}
          canvasViews={canvasViews}
          onHide={onHide}
          inRoom
          readOnly={readOnly}
          itemToShow={itemToShow}
          authorOf={authorOf}
        />
      </CanvasShown.Provider>
    </div>
  );
}

const NO_EDITS: EditRequest[] = [];
const NO_APPS: WorkspaceApps = { open: [], elsewhere: [], installed: [], documents: {} };
const NO_WORKSPACE_TABS: WorkspacePluginTab[] = [];
