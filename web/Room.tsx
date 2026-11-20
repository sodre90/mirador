import { flushSync } from "react-dom";
import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type ReactNode } from "react";
import type { Conversation, Person, Profile } from "../shared/model.ts";
import { mentionAt, withMention } from "../shared/mentions.ts";
import { eventsAnswering, messagesOfThread, shownInRoom, unanswered, writtenByAgent, type Room, type RoomAuthor, type RoomMessage, type RoomThread, type RoomTimeline } from "../shared/rooms.ts";
import { agentMarks, MessageWriters, PersonAvatar, PersonName, TimelineOfEvents, Timestamp } from "./Chat.tsx";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { MarkdownText, SlackMessageText } from "./Markdown.tsx";
import { ConversationWithSide } from "./SideChat.tsx";
import type { AppAction, OpenConversation } from "./state.ts";
import { SuggestionList, suggestionAttributes, suggestionKey, usePickedSuggestion } from "./SuggestionList.tsx";
import { useTypingAidAttributes } from "./typing-aids.ts";

const words = t.rooms;
const TAG_MENU_ID = "room-tags";

interface RoomAgentShown {
  profileId: string;
  name: string;
  profile: Profile | undefined;
  conversation: Conversation | undefined;
}

const isBusy = (conversation: Conversation | undefined) => conversation?.status === "running" || conversation?.status === "starting";

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

function ThreadColumn({
  thread,
  timeline,
  agent,
  opened,
  agentsById,
  onClose,
}: {
  thread: RoomThread;
  timeline: RoomTimeline;
  agent: RoomAgentShown;
  opened: OpenConversation | undefined;
  agentsById: Map<string, RoomAgentShown>;
  onClose: () => void;
}) {
  const asked = messagesOfThread(timeline, thread).filter(({ answers }) => answers === undefined);
  const answeredIds = new Set(timeline.messages.flatMap(({ answers }) => (answers === undefined ? [] : [answers])));
  const workingOn = asked.find(({ id }) => !answeredIds.has(id));
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
        {workingOn && <div className="working">{isBusy(agent.conversation) ? words.working(agent.name) : words.waiting(agent.name)}</div>}
      </div>
      <RoomComposer placeholder={words.followUpPlaceholder(agent.name)} agents={[]} onSend={(text) => writeIn(thread.roomId, text, [], thread.id)} />
    </aside>
  );
}

/** What the room shows of its agents' work under way: a line for each agent with a message to answer, the oldest it works on. */
function workUnderWay(timeline: RoomTimeline, agentsById: Map<string, RoomAgentShown>) {
  const pending = unanswered(timeline);
  return pending.map(({ message, thread }) => {
    const agent = agentsById.get(thread.profileId);
    const name = agent?.name ?? words.agentGone;
    const first = pending.find((each) => each.thread.profileId === thread.profileId)?.message === message;
    return { key: `${message.id}-${thread.id}`, thread, text: first ? words.working(name) : words.waiting(name) };
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
  dispatch,
}: {
  room: Room;
  timeline: RoomTimeline | null;
  profiles: Profile[];
  roomConversations: Conversation[];
  threadConversations: OpenConversation[];
  people: Person[];
  ownerId: string | null;
  ownerPicture: string | null;
  dispatch: Dispatch<AppAction>;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const agents = room.agents.map(({ profileId, conversationId }): RoomAgentShown => {
    const profile = profiles.find(({ id }) => id === profileId);
    return { profileId, name: profile?.name ?? words.agentGone, profile, conversation: roomConversations.find(({ id }) => id === conversationId) };
  });
  const agentsById = new Map(agents.map((agent) => [agent.profileId, agent]));
  const thread = timeline?.threads.find(({ id }) => id === threadId) ?? null;
  const threadAgent = thread ? agentsById.get(thread.profileId) : undefined;
  const threadConversationId = threadAgent?.conversation?.id ?? null;
  useEffect(() => dispatch({ type: "keep-thread-conversations", conversationIds: threadConversationId ? [threadConversationId] : [] }), [threadConversationId]);
  const messageWriters = useMemo(() => ({ people, ownerId, ownerPicture }), [people, ownerId, ownerPicture]);
  const messagesById = new Map(timeline?.messages.map((message) => [message.id, message]));
  const shown = timeline?.messages.filter(shownInRoom) ?? [];
  const timelineEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    timelineEnd.current?.scrollIntoView({ block: "end" });
  }, [timeline?.messages.length]);
  const main = (
    <>
      <header className="chat-header room-header" data-pane-bar>
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
        {shown.map((message) => (
          <RoomEntry key={message.id} message={message} quoted={message.answers === undefined ? undefined : messagesById.get(message.answers)} agentsById={agentsById}>
            {message.answers !== undefined && message.threadId && <ThreadLink onOpen={() => setThreadId(message.threadId)} />}
          </RoomEntry>
        ))}
        {timeline && workUnderWay(timeline, agentsById).map(({ key, thread: working, text }) => <ThreadLink key={key} text={text} onOpen={() => setThreadId(working.id)} />)}
        <div ref={timelineEnd} />
      </div>
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
        onClose={() => setThreadId(null)}
      />
    ) : null;
  return (
    <MessageWriters.Provider value={messageWriters}>
      <ConversationWithSide main={main} side={side} />
    </MessageWriters.Provider>
  );
}
