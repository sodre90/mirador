import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { MIN_SEARCH_LENGTH } from "../shared/find.ts";
import type { Conversation, ConversationMatches, SearchHit, Workspace } from "../shared/model.ts";
import { connection } from "./connection.ts";
import { requestFind } from "./FindBar.tsx";
import { formatNumber, locale, t } from "./i18n/index.ts";
import { Modal } from "./Palette.tsx";
import { relativeTimeOf } from "../shared/relative-time.ts";
import { shownTitle } from "./shown-title.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";

const TYPING_PAUSE_MS = 150;

/** Opening the dialog again shows the last search, as an editor's search panel does. */
let lastQuery = "";

/** The last results stay shown while the next are on their way, so the list does not flicker. */
function useSearchResults(query: string) {
  const [answered, setAnswered] = useState<{ query: string; conversations: ConversationMatches[] } | null>(null);
  useEffect(() => {
    if (query.trim().length < MIN_SEARCH_LENGTH) return;
    const requestId = crypto.randomUUID();
    const unsubscribe = connection.onMessage((message) => {
      if (message.type === "search.results" && message.requestId === requestId) setAnswered({ query, conversations: message.conversations });
    });
    const timer = setTimeout(() => connection.send({ type: "search", requestId, query }), TYPING_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [query]);
  return query.trim().length < MIN_SEARCH_LENGTH ? null : answered;
}

interface FoundConversation {
  conversation: Conversation;
  matches: number;
  hits: SearchHit[];
}

interface FoundWorkspace {
  workspace: Workspace;
  conversations: FoundConversation[];
}

/** By workspace, in the order their newest hits come, each conversation keeping its place within. */
function byWorkspace(found: ConversationMatches[], conversations: Conversation[], workspaces: Workspace[]): FoundWorkspace[] {
  const groups = new Map<string, FoundWorkspace>();
  found.forEach(({ conversationId, matches, hits }) => {
    const conversation = conversations.find(({ id }) => id === conversationId);
    const workspace = workspaces.find(({ id }) => id === conversation?.workspaceId);
    if (!conversation || !workspace) return;
    const group = groups.get(workspace.id) ?? { workspace, conversations: [] };
    group.conversations.push({ conversation, matches, hits });
    groups.set(workspace.id, group);
  });
  return [...groups.values()];
}

const words = t.shell.search;
const matchCount = (count: number) => words.matches(count, formatNumber(count));

function summaryOf(query: string, results: { query: string; conversations: ConversationMatches[] } | null) {
  if (query.trim().length < MIN_SEARCH_LENGTH) return words.typeAtLeast(MIN_SEARCH_LENGTH);
  if (!results) return words.searching;
  if (results.conversations.length === 0) return results.query === query ? words.noMatches : words.searching;
  const matches = results.conversations.reduce((sum, { matches }) => sum + matches, 0);
  const conversationCount = results.conversations.length;
  return words.summary(matchCount(matches), conversationCount, formatNumber(conversationCount));
}

export function SearchDialog({
  workspaces,
  conversations,
  onOpen,
  onClose,
}: {
  workspaces: Workspace[];
  conversations: Conversation[];
  onOpen: (conversationId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(lastQuery);
  const typingAidAttributes = useTypingAidAttributes();
  const results = useSearchResults(query);
  const groups = useMemo(() => byWorkspace(results?.conversations ?? [], conversations, workspaces), [results, conversations, workspaces]);
  const choices = groups.flatMap(({ conversations }) => conversations.flatMap(({ conversation, hits }) => hits.map((hit) => ({ conversation, hit }))));
  const positionOf = new Map(choices.map(({ hit }, position) => [hit, position]));
  const [highlighted, setHighlighted] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => setHighlighted(0), [results]);
  useEffect(() => {
    list.current?.querySelectorAll("[role=option]")[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const search = (text: string) => {
    lastQuery = text;
    setQuery(text);
  };
  const open = (choice: (typeof choices)[number] | undefined) => {
    if (!choice || !results) return;
    onClose();
    requestFind({ conversationId: choice.conversation.id, query: results.query, entryKey: choice.hit.entryKey });
    onOpen(choice.conversation.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = event.key === "ArrowDown" || (event.ctrlKey && event.key === "n") ? 1 : event.key === "ArrowUp" || (event.ctrlKey && event.key === "p") ? -1 : 0;
    if (step) {
      event.preventDefault();
      setHighlighted((index) => Math.min(Math.max(index + step, 0), choices.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      open(choices[highlighted]);
    } else if (event.key === "Escape") {
      onClose();
    }
  };

  return (
    <Modal label={words.label} className="search" onClose={onClose}>
      <input
        {...typingAidAttributes}
        autoFocus
        onFocus={(event) => event.target.select()}
        aria-label={words.label}
        placeholder={words.placeholder}
        value={query}
        onChange={(event) => search(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="search-summary" aria-live="polite">
        {summaryOf(query, results)}
      </div>
      <div ref={list} className="search-results" role="listbox" aria-label={words.matchesLabel}>
        {groups.map(({ workspace, conversations }) => (
          <section key={workspace.id} aria-label={workspace.name}>
            <h3 className="search-workspace">{workspace.name}</h3>
            {conversations.map(({ conversation, matches, hits }) => (
              <div key={conversation.id} className="search-conversation">
                <div className="search-conversation-title">
                  {shownTitle(conversation)}
                  <span className="search-count">{matchCount(matches)}</span>
                </div>
                {hits.map((hit) => {
                  const position = positionOf.get(hit)!;
                  return (
                    <div
                      key={hit.entryKey}
                      role="option"
                      aria-selected={position === highlighted}
                      className={`search-hit ${position === highlighted ? "highlighted" : ""}`}
                      onMouseMove={() => setHighlighted(position)}
                      onClick={() => open(choices[position])}
                    >
                      <span className="search-snippet">
                        {hit.snippet.before}
                        <mark>{hit.snippet.match}</mark>
                        {hit.snippet.after}
                      </span>
                      <span className="search-when">{relativeTimeOf(hit.at, locale)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
