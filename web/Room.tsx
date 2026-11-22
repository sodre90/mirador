import { flushSync } from "react-dom";
import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type ReactNode } from "react";
import type { AskItem, CanvasItem, Conversation, Person, Profile } from "../shared/model.ts";
import { categoryChoices, chosenModel } from "../shared/config-options.ts";
import { mentionAt, withMention } from "../shared/mentions.ts";
import type { RoomApprovalAnswer } from "../shared/room-permissions.ts";
import type { TaggablePerson } from "../shared/room-mentions.ts";
import type { RoomQuestionVotes } from "../shared/room-votes.ts";
import {
  AGENT_TAGGED_TURNS_AFTER_A_PERSON,
  askedInThread,
  canvasItemsOfAnswers,
  eventsAnswering,
  firstReachingTheAgent,
  reachedAmong,
  ROOM_MESSAGE_MOST_CHARACTERS,
  roomMessageLength,
  shownInRoom,
  taskWaits,
  workPending,
  writtenByAgent,
  type Room,
  type RoomAgentModel,
  type RoomApproval,
  type RoomAuthor,
  type RoomMessage,
  type RoomMessageSentAlong,
  type RoomPresence,
  type RoomRole,
  type RoomTaskApproval,
  type RoomThread,
  type RoomTimeline,
  type RoomWriter,
  type WorkPending,
} from "../shared/rooms.ts";
import { placedBelowOnItsSide, useClosing, useKeptInWindow } from "./BarMenu.tsx";
import { CanvasPanel, CanvasShown, type WorkspaceApps } from "./Canvas.tsx";
import { agentMarks, MessageWriters, pendingPermissionNeeded, PersonAvatar, PersonName, TimelineOfEvents, Timestamp, usePersonName, usePersonNames } from "./Chat.tsx";
import { connection } from "./connection.ts";
import { useEarlierHistory } from "./earlier-history.ts";
import type { EditRequest } from "./edit-approval.ts";
import { hints } from "./hints.ts";
import { formatNumber, t } from "./i18n/index.ts";
import { LayoutToggles } from "./LayoutToggles.tsx";
import { LineIcon } from "./LineIcon.tsx";
import { MarkdownText, MentionsOfMessage, SlackMessageText } from "./Markdown.tsx";
import { writersIn, writingLine, WritingSignals } from "./room-writing.ts";
import { ConversationWithSide } from "./SideChat.tsx";
import type { AppAction, OpenConversation, RoomTimelineWithCanvas } from "./state.ts";
import { SuggestionList, suggestionAttributes, suggestionKey, usePickedSuggestion } from "./SuggestionList.tsx";
import { ModelChoice, offeredAlready } from "./RoomAgents.tsx";
import { RoomVote } from "./RoomVote.tsx";
import { useTypingAidAttributes } from "./typing-aids.ts";
import type { WorkspacePluginTab } from "./WorkspaceTabView.tsx";

const words = t.rooms;
const TAG_MENU_ID = "room-tags";

interface RoomAgentShown {
  profileId: string;
  name: string;
  profile: Profile | undefined;
  conversation: Conversation | undefined;
  /** The room message the agent's turn under way answers. */
  answering: string | null;
  /** Chosen for the agent in this room; only the owner is told. */
  model: RoomAgentModel;
}

const isBusy = (conversation: Conversation | undefined) => conversation?.status === "running" || conversation?.status === "starting";

const agentNames = (profileIds: string[], agentsById: Map<string, RoomAgentShown>) => profileIds.map((profileId) => agentsById.get(profileId)?.name ?? words.agentGone).join(", ");

function AuthorMark({ author, agentsById }: { author: RoomAuthor; agentsById: Map<string, RoomAgentShown> }) {
  if (!writtenByAgent(author)) return <PersonAvatar personId={author.personId} />;
  const harness = agentsById.get(author.profileId)?.profile?.harness;
  return (
    <span className={`avatar agent-${harness ?? "gone"}`} aria-hidden="true">
      {harness ? agentMarks[harness] : "?"}
    </span>
  );
}

function AuthorName({ author, agentsById }: { author: RoomAuthor; agentsById: Map<string, RoomAgentShown> }) {
  return writtenByAgent(author) ? <span>{agentsById.get(author.profileId)?.name ?? words.agentGone}</span> : <PersonName personId={author.personId} />;
}

function answerEnding(message: RoomMessage) {
  if (message.ended === "stopped") return words.stopped;
  if (message.ended === "failed") return words.failed;
  if (message.ended === "declined") return words.declined;
  return message.text ? null : words.noAnswer;
}

const tagsYou = (message: RoomMessage, you: string | null) => message.mentions?.some(({ personId }) => personId === you) === true;

function RoomEntry({ message, quoted, agentsById, children }: { message: RoomMessage; quoted?: RoomMessage; agentsById: Map<string, RoomAgentShown>; children?: ReactNode }) {
  const ending = answerEnding(message);
  const byAgent = writtenByAgent(message.author);
  const { you } = useContext(MessageWriters);
  const mentionsRead = useMemo(() => (message.mentions ? { mentions: message.mentions, you } : null), [message.mentions, you]);
  return (
    <div className={`timeline-entry group-start room-entry${tagsYou(message, you) ? " tags-you" : ""}`} data-room-message={message.id}>
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

function ThreadLink({ text, onOpen }: { text?: string; onOpen: () => void }) {
  return (
    <div className="room-thread-line">
      {text && <span>{text}</span>}
      <button type="button" className="link" onClick={onOpen}>
        {words.openThread}
      </button>
    </div>
  );
}

/** A line under an answer whose turn put pages or questions on the room's canvas, which opens the latest of them there. */
function CanvasLine({ items, onOpen }: { items: CanvasItem[]; onOpen: (itemId: string) => void }) {
  const pages = items.filter(({ kind }) => kind === "show").length;
  const questions = items.filter(({ kind }) => kind === "ask").length;
  const latest = items.toSorted((a, b) => b.createdAt - a.createdAt)[0]!;
  return (
    <div className="room-thread-line room-canvas-line">
      <span>{words.madeOnCanvas(pages, questions)}</span>
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
}: {
  placeholder: string;
  agents: RoomAgentShown[];
  people: TaggablePerson[];
  onSend: (text: string, tags: string[]) => void;
  tellWriting: (writing: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [tagged, setTagged] = useState<RoomAgentShown[]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const typingAidAttributes = useTypingAidAttributes();
  const [writingSignals] = useState(() => new WritingSignals(tellWriting));
  useEffect(() => () => writingSignals.stopped(), []);
  const take = (taken: Taggable) => {
    const next = withMention(text, caret, { path: nameToTag(taken), directory: false });
    writingSignals.typed(next.text);
    flushSync(() => {
      setText(next.text);
      setCaret(next.caret);
    });
    if ("agent" in taken) setTagged((already) => [...already.filter(({ profileId }) => profileId !== taken.agent.profileId), taken.agent]);
    textarea.current?.focus();
    textarea.current?.setSelectionRange(next.caret, next.caret);
  };
  const tagMenu = useTagMenu({ taggable: [...agents.map((agent) => ({ agent })), ...people.map((person) => ({ person }))], text, caret, take });
  const length = roomMessageLength(text);
  const tooLong = length > ROOM_MESSAGE_MOST_CHARACTERS;
  const send = () => {
    if (!text.trim() || tooLong) return;
    onSend(
      text,
      tagged.filter(({ name }) => text.includes(`@${name}`)).map(({ profileId }) => profileId),
    );
    writingSignals.sent();
    setText("");
    setTagged([]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (tagMenu.onKeyDown(event)) return;
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };
  return (
    <div className="composer-area room-composer">
      <div className="composer">
        {tagMenu.menu}
        <textarea
          ref={textarea}
          rows={2}
          {...typingAidAttributes}
          {...tagMenu.textareaAttributes}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart);
            writingSignals.typed(event.target.value);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-actions">
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

const approve = ({ conversationId, request }: RoomApproval, answer: RoomApprovalAnswer) =>
  connection.send({ type: "room.approve", conversationId, permissionId: request.permissionId, answer });

const answerTask = ({ roomId, messageId }: RoomTaskApproval, answer: "allow" | "deny") => connection.send({ type: "room.answer-task", roomId, messageId, answer });

type WaitingForYou = { kind: "request"; approval: RoomApproval; at: number } | { kind: "task"; task: RoomTaskApproval; at: number };

/** What waits for you in the room, oldest first: the agents' requests, and the tasks people other than the owner gave them. */
const waitingInOrder = (approvals: RoomApproval[], tasks: RoomTaskApproval[]): WaitingForYou[] =>
  [...approvals.map((approval) => ({ kind: "request" as const, approval, at: approval.at })), ...tasks.map((task) => ({ kind: "task" as const, task, at: task.at }))].toSorted(
    (a, b) => a.at - b.at,
  );

/** What waits for you in the room, oldest first: the first with its answers, and how many wait in all. */
function ApprovalStrip({ approvals, tasks = [], agentsById, you }: { approvals: RoomApproval[]; tasks?: RoomTaskApproval[]; agentsById: Map<string, RoomAgentShown>; you: string | null }) {
  const waiting = waitingInOrder(approvals, tasks);
  const first = waiting[0];
  if (!first) return null;
  const count = waiting.length > 1 && <span className="room-approval-count">{words.approvalPosition(waiting.length)}</span>;
  return first.kind === "task" ? (
    <TaskApproval key={first.task.messageId} task={first.task} agentsById={agentsById} count={count} />
  ) : (
    <RequestApproval approval={first.approval} agentsById={agentsById} you={you} count={count} />
  );
}

/**
 * A person's task that reaches no agent until you allow it: who gives it, in what role, to which agents, all it says,
 * and the room's other messages its agents would be sent with it.
 */
function TaskApproval({ task, agentsById, count }: { task: RoomTaskApproval; agentsById: Map<string, RoomAgentShown>; count: ReactNode }) {
  const personName = usePersonName(task.personId);
  const [wholeShown, setWholeShown] = useState(false);
  return (
    <section className="room-approvals room-task-approval" aria-label={words.approvalsWaiting} data-task-message-id={task.messageId}>
      <div className="room-approval-head">
        <span className="room-approval-asker">{words.taskFrom(personName, words.authorRoles[task.role], agentNames(task.profileIds, agentsById))}</span>
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

function RequestApproval({ approval: first, agentsById, you, count }: { approval: RoomApproval; agentsById: Map<string, RoomAgentShown>; you: string | null; count: ReactNode }) {
  const personName = usePersonName(first.task?.personId ?? null);
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
      {first.task && (
        <div className="room-approval-task">
          {first.task.personId === you ? words.yourTask(first.task.text) : words.approvalTask(personName, words.authorRoles[first.task.role], first.task.text)}
        </div>
      )}
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

const waitsInThread = (approvals: RoomApproval[], threadId: string) => approvals.some((approval) => approval.threadId === threadId);

/** A guest writes in the room, but tags none of its agents and follows up in none of their threads; the owner is no guest anywhere. */
const isGuestIn = (room: Room, you: string | null) => room.people.some(({ personId, role }) => personId === you && role === "guest");

function ThreadColumn({
  thread,
  timeline,
  pending,
  agent,
  opened,
  agentsById,
  approvals,
  waitingForYou,
  you,
  followsUp,
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
  approvals: RoomApproval[];
  waitingForYou: RoomApproval[];
  you: string | null;
  followsUp: boolean;
  peopleToTag: TaggablePerson[];
  writing: RoomWriter[];
  onClose: () => void;
}) {
  const asked = askedInThread(timeline, thread);
  const firstReached = firstReachingTheAgent(timeline, thread, agent.answering);
  const pendingHere = pending.filter((each) => each.thread.id === thread.id);
  const workingOn = pendingHere.length > 0;
  const workingLine = pendingHere.every(({ message }) => taskWaits(message))
    ? words.taskWaits(agent.name)
    : waitsInThread(approvals, thread.id)
      ? words.waitingForApproval(agent.name)
      : isBusy(agent.conversation)
        ? words.working(agent.name)
        : words.waiting(agent.name);
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };
  return (
    <aside className="side-chat room-thread" aria-label={words.thread(agent.name)} onKeyDown={closeOnEscape}>
      <header className="side-chat-header">
        <div className="side-chat-heading">
          <h2>{words.thread(agent.name)}</h2>
        </div>
        <button type="button" className="icon" aria-label={words.closeThread} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="timeline">
        {agent.conversation && opened?.loaded && firstReached && <HistoryReachingBack opened={opened} messageId={firstReached.id} />}
        {asked.map((message) => (
          <div key={message.id} className="room-thread-turn">
            <RoomEntry message={message} agentsById={agentsById} />
            {agent.conversation && opened?.loaded && <TimelineOfEvents conversation={agent.conversation} events={eventsAnswering(opened.events, message.id)} />}
          </div>
        ))}
        {workingOn && <div className="working">{workingLine}</div>}
        <WritingLine writing={writing} threadId={thread.id} you={you} />
      </div>
      <ApprovalStrip approvals={waitingForYou.filter(({ threadId }) => threadId === thread.id)} agentsById={agentsById} you={you} />
      {followsUp && (
        <RoomComposer
          placeholder={words.followUpPlaceholder(agent.name)}
          agents={[]}
          people={peopleToTag}
          onSend={(text) => writeIn(thread.roomId, text, [], thread.id)}
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

/**
 * What the room shows of its agents' work under way: a line for each message an agent has to answer, and whether it
 * works on it, waits for approval in it, comes to it later, or waits for its task to be allowed.
 */
function workUnderWay(pending: WorkPending[], agentsById: Map<string, RoomAgentShown>, approvals: RoomApproval[]) {
  const sent = pending.filter(({ message }) => !taskWaits(message));
  return pending.map(({ message, thread }) => {
    const agent = agentsById.get(thread.profileId);
    const name = agent?.name ?? words.agentGone;
    const first = sent.find((each) => each.thread.profileId === thread.profileId)?.message === message;
    const text = taskWaits(message) ? words.taskWaits(name) : waitsInThread(approvals, thread.id) ? words.waitingForApproval(name) : first ? words.working(name) : words.waiting(name);
    return { key: `${message.id}-${thread.id}`, thread, text };
  });
}

type RoleShown = "owner" | RoomRole | null;

/**
 * The model an agent of the room runs on, quietly beside its name: the one chosen in the room, else the one its session
 * is on, by the name its session lists, else the one its agent offered when this page asked it.
 */
function ModelShown({ agent }: { agent: RoomAgentShown }) {
  const live = agent.conversation?.configOptions ?? [];
  const value = agent.model.model ?? chosenModel(live)?.id ?? agent.profile?.model;
  const listed = categoryChoices(live, "model").length > 0 || !agent.profile ? live : offeredAlready(agent.profile.id);
  const name = value && (categoryChoices(listed, "model").find((choice) => choice.value === value)?.name ?? value);
  return name ? <span className="room-agent-model">{name}</span> : null;
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

/** "3 here" in the room's bar, which opens who is in the room, who of them is here now, and which agents work, on which model for the owner, who changes it there. */
function RoomPeople({ room, agents, here, ownerId, owns }: { room: Room; agents: RoomAgentShown[]; here: string[]; ownerId: string | null; owns: boolean }) {
  const opener = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  useClosing(placement !== null, [opener, popover], () => setPlacement(null));
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
        onClick={() => setPlacement(placement || !opener.current ? null : placedBelowOnItsSide(opener.current))}
      >
        {words.hereCount(here.length)}
      </button>
      {placement && (
        <div ref={popover} className="room-people" role="dialog" aria-label={words.peopleOfRoom} style={placement}>
          <h3>{words.people}</h3>
          <ul aria-label={words.people}>
            {peopleOfRoom(room, ownerId, here).map(({ personId, role }) => (
              <li key={personId}>
                <PersonAvatar personId={personId} />
                <PersonName personId={personId} />
                {role && <span className="room-role-label">{words.authorRoles[role]}</span>}
                {hereNow.has(personId) && <span className="room-here-mark" role="img" aria-label={words.isHere} data-hint={words.isHere} />}
              </li>
            ))}
          </ul>
          {agents.length > 0 && (
            <>
              <h3>{words.agents}</h3>
              <ul aria-label={words.agents}>
                {agents.map(({ profileId, name, profile, conversation, answering, model }) => (
                  <li key={profileId} className="room-people-agent">
                    <div className="room-people-agent-line">
                      <span className={`avatar agent-${profile?.harness ?? "gone"}`} aria-hidden="true">
                        {profile ? agentMarks[profile.harness] : "?"}
                      </span>
                      <span className="room-people-agent-name">{name}</span>
                      {answering !== null && <span className="room-agent-working">{words.agentWorking}</span>}
                    </div>
                    {owns && (
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
  presence,
  muted,
  you,
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
  /** Who is in the room now and who of them writes, once the host said. */
  presence: RoomPresence | null;
  /** Whether the room notifies you. */
  muted: boolean;
  you: string | null;
  dispatch: Dispatch<AppAction>;
  onOpenOnCanvas: (itemId: string) => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const agents = room.agents.map(({ profileId, conversationId, answering, model, effort }): RoomAgentShown => {
    const profile = profiles.find(({ id }) => id === profileId);
    return { profileId, name: profile?.name ?? words.agentGone, profile, conversation: roomConversations.find(({ id }) => id === conversationId), answering, model: { model, effort } };
  });
  const owns = you !== null && you === ownerId;
  const agentsById = new Map(agents.map((agent) => [agent.profileId, agent]));
  const tagsAgents = !isGuestIn(room, you);
  const peopleToTag = taggablePeople(room, ownerId, people, you);
  const waitingForYou = approvals.filter(({ approvers }) => you !== null && approvers.includes(you));
  const tasksWaitingForYou = tasks.filter(({ approvers }) => you !== null && approvers.includes(you));
  const thread = timeline?.threads.find(({ id }) => id === threadId) ?? null;
  const threadAgent = thread ? agentsById.get(thread.profileId) : undefined;
  const threadConversationId = threadAgent?.conversation?.id ?? null;
  useEffect(() => dispatch({ type: "keep-thread-conversations", conversationIds: threadConversationId ? [threadConversationId] : [] }), [threadConversationId]);
  const messageWriters = useMemo(() => ({ people, ownerId, ownerPicture, you }), [people, ownerId, ownerPicture, you]);
  const messagesById = new Map(timeline?.messages.map((message) => [message.id, message]));
  const shown = timeline?.messages.filter(shownInRoom) ?? [];
  const canvasOfAnswers = useMemo(
    () => (timeline ? canvasItemsOfAnswers(timeline.messages, timeline.canvas, (profileId) => room.agents.find((agent) => agent.profileId === profileId)?.conversationId) : new Map<string, CanvasItem[]>()),
    [timeline, room.agents],
  );
  const votesOf = new Map(timeline?.votes.map((votes): [string, RoomQuestionVotes] => [votes.itemId, votes]));
  const voteOn = (item: AskItem) => <RoomVote key={item.id} roomId={room.id} item={item} votes={votesOf.get(item.id)} you={you} takesOwnWords={owns || !room.peoplesTasksWait} />;
  const pending = timeline ? workPending(timeline, room.agents) : [];
  const writing = presence?.writing ?? [];
  const timelineEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    timelineEnd.current?.scrollIntoView({ block: "end" });
  }, [timeline?.messages.length]);
  const main = (
    <>
      <header className="chat-header room-header" data-pane-bar>
        <LayoutToggles />
        <h2 className="room-title"># {room.name}</h2>
        <ul className="room-agents" aria-label={words.agents}>
          {agents.map((agent) => (
            <li key={agent.profileId} className="agent-chip">
              {agent.profile ? `${agentMarks[agent.profile.harness]} ` : ""}
              {agent.name}
              {owns && <ModelShown agent={agent} />}
            </li>
          ))}
        </ul>
        {presence && <RoomPeople room={room} agents={agents} here={presence.here} ownerId={ownerId} owns={owns} />}
        <MuteToggle roomId={room.id} muted={muted} />
        {owns && (
          <button type="button" className="room-invite-button" onClick={() => dispatch({ type: "open-overlay", overlay: { kind: "room-invite", roomId: room.id } })}>
            {words.inviteSomeone}
          </button>
        )}
      </header>
      <div className="timeline room-timeline">
        {!timeline && <div className="notice-line">{words.loading}</div>}
        {timeline && shown.length === 0 && <div className="notice-line">{tagsAgents ? words.empty : words.emptyForGuest}</div>}
        {shown.map((message) => {
          const madeOnCanvas = canvasOfAnswers.get(message.id) ?? [];
          return (
            <RoomEntry key={message.id} message={message} quoted={message.answers === undefined ? undefined : messagesById.get(message.answers)} agentsById={agentsById}>
              {madeOnCanvas.length > 0 && <CanvasLine items={madeOnCanvas} onOpen={onOpenOnCanvas} />}
              {madeOnCanvas.filter(isAsk).map(voteOn)}
              {message.answers !== undefined && message.threadId && <ThreadLink onOpen={() => setThreadId(message.threadId)} />}
            </RoomEntry>
          );
        })}
        {timeline && questionsOfNoAnswer(timeline.canvas, canvasOfAnswers).map(voteOn)}
        {workUnderWay(pending, agentsById, approvals).map(({ key, thread: working, text }) => <ThreadLink key={key} text={text} onOpen={() => setThreadId(working.id)} />)}
        <WritingLine writing={writing} threadId={null} you={you} />
        <div ref={timelineEnd} />
      </div>
      <ApprovalStrip approvals={waitingForYou} tasks={tasksWaitingForYou} agentsById={agentsById} you={you} />
      <RoomComposer
        placeholder={tagsAgents ? words.placeholder(room.name) : words.guestPlaceholder(room.name)}
        agents={tagsAgents ? agents.filter(({ profile }) => profile) : []}
        people={peopleToTag}
        onSend={(text, tags) => writeIn(room.id, text, tags, null)}
        tellWriting={tellWritingIn(room.id, null)}
      />
    </>
  );
  const side =
    thread && threadAgent && timeline ? (
      <ThreadColumn
        key={thread.id}
        thread={thread}
        timeline={timeline}
        pending={pending}
        agent={threadAgent}
        opened={threadConversations.find(({ conversationId }) => conversationId === threadConversationId)}
        agentsById={agentsById}
        approvals={approvals}
        waitingForYou={waitingForYou}
        you={you}
        followsUp={tagsAgents}
        peopleToTag={peopleToTag}
        writing={writing}
        onClose={() => setThreadId(null)}
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
  items: CanvasItem[];
  shown: boolean;
  assetsOrigin: string;
  homeDir: string;
  canvasViews: Record<string, string>;
  itemToShow: { itemId: string } | null;
  readOnly: boolean;
  onHide: () => void;
}) {
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
        />
      </CanvasShown.Provider>
    </div>
  );
}

const NO_EDITS: EditRequest[] = [];
const NO_APPS: WorkspaceApps = { open: [], elsewhere: [], installed: [], documents: {} };
const NO_WORKSPACE_TABS: WorkspacePluginTab[] = [];
