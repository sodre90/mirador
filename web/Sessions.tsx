import { useEffect, useState, type Dispatch } from "react";
import { harnessLabels, type AdoptMode, type ExternalSession, type Profile, type SessionSearchHit, type Workspace } from "../shared/model.ts";
import { MIN_SEARCH_LENGTH } from "../shared/find.ts";
import { relativeTimeOf } from "../shared/relative-time.ts";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { locale, t } from "./i18n/index.ts";
import { launchLabel } from "./launch-label.ts";
import type { AppAction } from "./state.ts";
import { hostErrorText } from "./host-error.ts";

const words = t.shell.sessions;

type Listing = { state: "loading" } | { state: "failed"; message: string } | { state: "listed"; sessions: ExternalSession[] };
type SearchAnswer = { query: string; sessions: SessionSearchHit[] } | { query: string; failed: string };

const TYPING_PAUSE_MS = 150;

function useWorkspaceSessions(workspace: Workspace) {
  const [listing, setListing] = useState<Listing>({ state: "loading" });
  useEffect(() => {
    const requestId = crypto.randomUUID();
    const unsubscribe = connection.onMessage((message) => {
      if (message.type === "sessions.listed" && message.requestId === requestId) setListing({ state: "listed", sessions: message.sessions });
      if (message.type === "sessions.failed" && message.requestId === requestId) setListing({ state: "failed", message: hostErrorText(message) });
    });
    connection.send({ type: "sessions.list", requestId, workspaceId: workspace.id, launch: workspace.defaultLaunch });
    return unsubscribe;
  }, [workspace.id, workspace.defaultLaunch.harness, workspace.defaultLaunch.profileId]);
  return listing;
}

/** Sessions in the workspace holding what the query says, answered after a pause in the typing; null while searching. */
function useSessionSearch(workspace: Workspace, query: string, enabled: boolean) {
  const [answered, setAnswered] = useState<SearchAnswer | null>(null);
  useEffect(() => {
    setAnswered(null);
    const trimmed = query.trim();
    if (!enabled || trimmed.length < MIN_SEARCH_LENGTH) return;
    const requestId = crypto.randomUUID();
    const unsubscribe = connection.onMessage((message) => {
      if (message.type === "sessions.searched" && message.requestId === requestId) setAnswered({ query: trimmed, sessions: message.sessions });
      if (message.type === "sessions.failed" && message.requestId === requestId) setAnswered({ query: trimmed, failed: hostErrorText(message) });
    });
    const timer = setTimeout(
      () => connection.send({ type: "sessions.search", requestId, workspaceId: workspace.id, launch: workspace.defaultLaunch, query: trimmed }),
      TYPING_PAUSE_MS,
    );
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [query, enabled, workspace.id, workspace.defaultLaunch.harness, workspace.defaultLaunch.profileId]);
  return answered;
}

const ago = (isoTime: string | null) => (isoTime ? relativeTimeOf(Date.parse(isoTime), locale) : "");

function SessionRow({
  session,
  onAdopt,
  onOpen,
}: {
  session: ExternalSession & { match?: string | null };
  onAdopt: (session: ExternalSession, mode: AdoptMode) => void;
  onOpen: (conversationId: string) => void;
}) {
  return (
    <li>
      <div className="session-summary">
        <div className="session-title">{session.title || words.untitled}</div>
        {session.match && <div className="session-match">{session.match}</div>}
        <div className="session-meta">
          {ago(session.updatedAt)} · <code>{session.sessionId.slice(0, 8)}</code>
        </div>
      </div>
      {session.conversationId ? (
        <button onClick={() => onOpen(session.conversationId!)}>{words.open}</button>
      ) : (
        <>
          <button className="primary" onClick={() => onAdopt(session, "continue")}>
            {words.continue}
          </button>
          <button onClick={() => onAdopt(session, "fork")}>{words.fork}</button>
        </>
      )}
    </li>
  );
}

export function SessionsDialog({
  workspace,
  profiles,
  dispatch,
  onClose,
}: {
  workspace: Workspace;
  profiles: Profile[];
  dispatch: Dispatch<AppAction>;
  onClose: () => void;
}) {
  const listing = useWorkspaceSessions(workspace);
  const [query, setQuery] = useState("");
  const searchable = workspace.defaultLaunch.harness === "claude" || workspace.defaultLaunch.harness === "opencode";
  const searching = query.trim().length >= MIN_SEARCH_LENGTH;
  const answer = useSessionSearch(workspace, query, searchable && searching);
  const failure = answer && "failed" in answer ? answer.failed : null;
  const hits = answer && "sessions" in answer ? answer.sessions : null;
  const agent = harnessLabels[workspace.defaultLaunch.harness];

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const adopt = (session: ExternalSession, mode: AdoptMode) => {
    dispatch({ type: "awaiting-conversation", workspaceId: workspace.id });
    connection.send({
      type: "conversation.adopt",
      workspaceId: workspace.id,
      launch: workspace.defaultLaunch,
      session: { sessionId: session.sessionId, title: session.title },
      mode,
    });
    onClose();
  };
  const open = (conversationId: string) => {
    dispatch({ type: "select", conversationId });
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal sessions" role="dialog" aria-label={words.label}>
        <header>
          <h2>{words.title(workspace.name)}</h2>
          <button className="icon" title={t.shell.close} aria-label={t.shell.close} onClick={onClose}>
            ×
          </button>
        </header>
        <p className="hint">
          {words.startedInBefore(agent)} <code>{workspace.path}</code>
          {words.startedInMiddle} <strong>{launchLabel(workspace.defaultLaunch, profiles)}</strong>
          {words.startedInAfter} <em>{words.newConversation}</em>.
        </p>
        <p className="warning">
          <strong>{words.continue}</strong> {words.continueKeepsBefore} <strong>{words.fork}</strong> {words.forkCopies}
        </p>
        {searchable && (
          <input
            className="session-search"
            type="search"
            placeholder={words.searchPlaceholder}
            aria-label={words.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
            data-hint={hints.sessionSearch}
          />
        )}
        {searching ? (
          failure !== null ? (
            <div className="form-errors">{failure}</div>
          ) : hits === null ? (
            <div className="notice-line">{words.searching}</div>
          ) : hits.length === 0 ? (
            <div className="notice-line">{words.noneSayThat}</div>
          ) : (
            <ul className="session-list">
              {hits.map((session) => (
                <SessionRow key={session.sessionId} session={session} onAdopt={adopt} onOpen={open} />
              ))}
            </ul>
          )
        ) : (
          <>
            {listing.state === "loading" && <div className="notice-line">{words.loading}</div>}
            {listing.state === "failed" && <div className="form-errors">{listing.message}</div>}
            {listing.state === "listed" && listing.sessions.length === 0 && (
              <div className="notice-line">{words.noneYet(agent)}</div>
            )}
            {listing.state === "listed" && listing.sessions.length > 0 && (
              <ul className="session-list">
                {listing.sessions.map((session) => (
                  <SessionRow key={session.sessionId} session={session} onAdopt={adopt} onOpen={open} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
