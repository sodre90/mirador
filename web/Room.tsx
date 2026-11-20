import { flushSync } from "react-dom";
import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type ReactNode } from "react";
import type { CanvasItem, Conversation, Person, Profile } from "../shared/model.ts";
import { mentionAt, withMention } from "../shared/mentions.ts";
import type { RoomApprovalAnswer } from "../shared/room-permissions.ts";
import {
  AGENT_TAGGED_TURNS_AFTER_A_PERSON,
  askedInThread,
  canvasItemsOfAnswers,
  eventsAnswering,
  shownInRoom,
  unanswered,
  writtenByAgent,
  type Room,
  type RoomApproval,
  type RoomAuthor,
  type RoomMessage,
  type RoomThread,
  type RoomTimeline,
} from "../shared/rooms.ts";
import { CanvasPanel, CanvasShown, type WorkspaceApps } from "./Canvas.tsx";
import { agentMarks, MessageWriters, pendingPermissionNeeded, PersonAvatar, PersonName, TimelineOfEvents, Timestamp, usePersonName } from "./Chat.tsx";
import { connection } from "./connection.ts";
import type { EditRequest } from "./edit-approval.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { LayoutToggles } from "./LayoutToggles.tsx";
import { MarkdownText, SlackMessageText } from "./Markdown.tsx";
import { ConversationWithSide } from "./SideChat.tsx";
import type { AppAction, OpenConversation } from "./state.ts";
import { SuggestionList, suggestionAttributes, suggestionKey, usePickedSuggestion } from "./SuggestionList.tsx";
import { useTypingAidAttributes } from "./typing-aids.ts";
import type { WorkspacePluginTab } from "./WorkspaceTabView.tsx";

const words = t.rooms;
const TAG_MENU_ID = "room-tags";

interface RoomAgentShown {
  profileId: string;
  name: string;
  profile: Profile | undefined;
  conversation: Conversation | undefined;
}

type RoomTimelineWithCanvas = RoomTimeline & { canvas: CanvasItem[] };

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
  return message.text ? null : words.noAnswer;
}

function RoomEntry({ message, quoted, agentsById, children }: { message: RoomMessage; quoted?: RoomMessage; agentsById: Map<string, RoomAgentShown>; children?: ReactNode }) {
  const ending = answerEnding(message);
  const byAgent = writtenByAgent(message.author);
  return (
    <div className="timeline-entry group-start room-entry" data-room-message={message.id}>
      <div className="gutter">
        <AuthorMark author={message.author} agentsById={agentsById} />
      </div>
      <div className="entry-body">
        <div className="author">
          <AuthorName author={message.author} agentsById={agentsById} />
          <Timestamp at={message.at} />
        </div>
        {quoted && (
          <blockquote className="room-quote">
            <span className="room-quote-author">
              <AuthorName author={quoted.author} agentsById={agentsById} />
            </span>
            <span className="room-quote-text">{quoted.text}</span>
          </blockquote>
        )}
        {message.text && <div className={`message ${byAgent ? "agent" : "user"}`}>{byAgent ? <MarkdownText text={message.text} /> : <SlackMessageText text={message.text} />}</div>}
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

/** The agents to tag for the @ being written where the caret is: those whose name starts with what follows the @. */
function useTagMenu({ agents, text, caret, take }: { agents: RoomAgentShown[]; text: string; caret: number; take: (agent: RoomAgentShown) => void }) {
  const query = agents.length > 0 ? (mentionAt(text, caret)?.query ?? null) : null;
  const offered = query === null ? [] : agents.filter(({ name }) => name.toLowerCase().startsWith(query.toLowerCase()));
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
    <SuggestionList id={TAG_MENU_ID} label={words.tagMenu} className="mention-paths room-tags" items={offered} keyOf={({ profileId }) => profileId} pickedIndex={pickedIndex} onPick={take}>
      {(agent) => <span className="room-tag-option">@{agent.name}</span>}
    </SuggestionList>
  ) : null;
  return { onKeyDown, textareaAttributes: suggestionAttributes(TAG_MENU_ID, open, pickedIndex), menu };
}

/** A message box for the room, whose @ tags its agents, or, without agents to tag, for a thread's follow-ups. */
function RoomComposer({ placeholder, agents, onSend }: { placeholder: string; agents: RoomAgentShown[]; onSend: (text: string, tags: string[]) => void }) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [tagged, setTagged] = useState<RoomAgentShown[]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const typingAidAttributes = useTypingAidAttributes();
  const take = (agent: RoomAgentShown) => {
    const next = withMention(text, caret, { path: agent.name, directory: false });
    flushSync(() => {
      setText(next.text);
      setCaret(next.caret);
    });
    setTagged((already) => [...already.filter(({ profileId }) => profileId !== agent.profileId), agent]);
    textarea.current?.focus();
    textarea.current?.setSelectionRange(next.caret, next.caret);
  };
  const tagMenu = useTagMenu({ agents, text, caret, take });
  const send = () => {
    if (!text.trim()) return;
    onSend(
      text,
      tagged.filter(({ name }) => text.includes(`@${name}`)).map(({ profileId }) => profileId),
    );
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
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-actions">
          <button type="button" className="primary" disabled={!text.trim()} onClick={send}>
            {words.send}
          </button>
        </div>
      </div>
    </div>
  );
}

const writeIn = (roomId: string, text: string, tags: string[], threadId: string | null) => connection.send({ type: "room.write", roomId, text, tags, threadId });

const approve = ({ conversationId, request }: RoomApproval, answer: RoomApprovalAnswer) =>
  connection.send({ type: "room.approve", conversationId, permissionId: request.permissionId, answer });

/** The requests of the room's agents that wait for you, oldest first: the first with its answers, and how many wait in all. */
function ApprovalStrip({ approvals, agentsById, you }: { approvals: RoomApproval[]; agentsById: Map<string, RoomAgentShown>; you: string | null }) {
  const first = approvals[0];
  const personName = usePersonName(first?.task?.personId ?? null);
  if (!first) return null;
  const detail = first.request.command ?? first.file;
  return (
    <section className="room-approvals" aria-label={words.approvalsWaiting} data-permission-id={first.request.permissionId}>
      <div className="room-approval-head">
        <span className="room-approval-asker">{words.asks(agentsById.get(first.profileId)?.name ?? words.agentGone)}</span>
        <span className="room-approval-subject">{pendingPermissionNeeded(first.request)}</span>
        {approvals.length > 1 && <span className="room-approval-count">{words.approvalPosition(approvals.length)}</span>}
      </div>
      {detail && <code className="room-approval-detail">{detail}</code>}
      {first.task && <div className="room-approval-task">{first.task.personId === you ? words.yourTask(first.task.text) : words.approvalTask(personName, first.task.text)}</div>}
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

function ThreadColumn({
  thread,
  timeline,
  agent,
  opened,
  agentsById,
  approvals,
  waitingForYou,
  you,
  onClose,
}: {
  thread: RoomThread;
  timeline: RoomTimeline;
  agent: RoomAgentShown;
  opened: OpenConversation | undefined;
  agentsById: Map<string, RoomAgentShown>;
  approvals: RoomApproval[];
  waitingForYou: RoomApproval[];
  you: string | null;
  onClose: () => void;
}) {
  const asked = askedInThread(timeline, thread);
  const workingOn = unanswered(timeline).some((pending) => pending.thread.id === thread.id);
  const workingLine = waitsInThread(approvals, thread.id) ? words.waitingForApproval(agent.name) : isBusy(agent.conversation) ? words.working(agent.name) : words.waiting(agent.name);
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
        {asked.map((message) => (
          <div key={message.id} className="room-thread-turn">
            <RoomEntry message={message} agentsById={agentsById} />
            {agent.conversation && opened?.loaded && <TimelineOfEvents conversation={agent.conversation} events={eventsAnswering(opened.events, message.id)} />}
          </div>
        ))}
        {workingOn && <div className="working">{workingLine}</div>}
      </div>
      <ApprovalStrip approvals={waitingForYou.filter(({ threadId }) => threadId === thread.id)} agentsById={agentsById} you={you} />
      <RoomComposer placeholder={words.followUpPlaceholder(agent.name)} agents={[]} onSend={(text) => writeIn(thread.roomId, text, [], thread.id)} />
    </aside>
  );
}

/** What the room shows of its agents' work under way: a line for each message an agent has to answer, and whether it works on it, waits for approval in it, or comes to it later. */
function workUnderWay(timeline: RoomTimeline, agentsById: Map<string, RoomAgentShown>, approvals: RoomApproval[]) {
  const pending = unanswered(timeline);
  return pending.map(({ message, thread }) => {
    const agent = agentsById.get(thread.profileId);
    const name = agent?.name ?? words.agentGone;
    const first = pending.find((each) => each.thread.profileId === thread.profileId)?.message === message;
    const text = waitsInThread(approvals, thread.id) ? words.waitingForApproval(name) : first ? words.working(name) : words.waiting(name);
    return { key: `${message.id}-${thread.id}`, thread, text };
  });
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
  you: string | null;
  dispatch: Dispatch<AppAction>;
  onOpenOnCanvas: (itemId: string) => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const agents = room.agents.map(({ profileId, conversationId }): RoomAgentShown => {
    const profile = profiles.find(({ id }) => id === profileId);
    return { profileId, name: profile?.name ?? words.agentGone, profile, conversation: roomConversations.find(({ id }) => id === conversationId) };
  });
  const agentsById = new Map(agents.map((agent) => [agent.profileId, agent]));
  const waitingForYou = approvals.filter(({ approvers }) => you !== null && approvers.includes(you));
  const thread = timeline?.threads.find(({ id }) => id === threadId) ?? null;
  const threadAgent = thread ? agentsById.get(thread.profileId) : undefined;
  const threadConversationId = threadAgent?.conversation?.id ?? null;
  useEffect(() => dispatch({ type: "keep-thread-conversations", conversationIds: threadConversationId ? [threadConversationId] : [] }), [threadConversationId]);
  const messageWriters = useMemo(() => ({ people, ownerId, ownerPicture }), [people, ownerId, ownerPicture]);
  const messagesById = new Map(timeline?.messages.map((message) => [message.id, message]));
  const shown = timeline?.messages.filter(shownInRoom) ?? [];
  const canvasOfAnswers = useMemo(
    () => (timeline ? canvasItemsOfAnswers(timeline.messages, timeline.canvas, (profileId) => room.agents.find((agent) => agent.profileId === profileId)?.conversationId) : new Map<string, CanvasItem[]>()),
    [timeline, room.agents],
  );
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
            </li>
          ))}
        </ul>
      </header>
      <div className="timeline room-timeline">
        {!timeline && <div className="notice-line">{words.loading}</div>}
        {timeline && shown.length === 0 && <div className="notice-line">{words.empty}</div>}
        {shown.map((message) => {
          const madeOnCanvas = canvasOfAnswers.get(message.id) ?? [];
          return (
            <RoomEntry key={message.id} message={message} quoted={message.answers === undefined ? undefined : messagesById.get(message.answers)} agentsById={agentsById}>
              {madeOnCanvas.length > 0 && <CanvasLine items={madeOnCanvas} onOpen={onOpenOnCanvas} />}
              {message.answers !== undefined && message.threadId && <ThreadLink onOpen={() => setThreadId(message.threadId)} />}
            </RoomEntry>
          );
        })}
        {timeline && workUnderWay(timeline, agentsById, approvals).map(({ key, thread: working, text }) => <ThreadLink key={key} text={text} onOpen={() => setThreadId(working.id)} />)}
        <div ref={timelineEnd} />
      </div>
      <ApprovalStrip approvals={waitingForYou} agentsById={agentsById} you={you} />
      <RoomComposer placeholder={words.placeholder(room.name)} agents={agents.filter(({ profile }) => profile)} onSend={(text, tags) => writeIn(room.id, text, tags, null)} />
    </>
  );
  const side =
    thread && threadAgent && timeline ? (
      <ThreadColumn
        key={thread.id}
        thread={thread}
        timeline={timeline}
        agent={threadAgent}
        opened={threadConversations.find(({ conversationId }) => conversationId === threadConversationId)}
        agentsById={agentsById}
        approvals={approvals}
        waitingForYou={waitingForYou}
        you={you}
        onClose={() => setThreadId(null)}
      />
    ) : null;
  return (
    <MessageWriters.Provider value={messageWriters}>
      <ConversationWithSide main={main} side={side} />
    </MessageWriters.Provider>
  );
}

/** The room's canvas: its agents' pages and questions, newest in front, where the owner reads them and answers. */
export function RoomCanvas({
  room,
  items,
  shown,
  assetsOrigin,
  homeDir,
  canvasViews,
  itemToShow,
  onHide,
}: {
  room: Room;
  items: CanvasItem[];
  shown: boolean;
  assetsOrigin: string;
  homeDir: string;
  canvasViews: Record<string, string>;
  itemToShow: { itemId: string } | null;
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
          itemToShow={itemToShow}
        />
      </CanvasShown.Provider>
    </div>
  );
}

const NO_EDITS: EditRequest[] = [];
const NO_APPS: WorkspaceApps = { open: [], elsewhere: [], installed: [], documents: {} };
const NO_WORKSPACE_TABS: WorkspacePluginTab[] = [];
