import { homedir } from "node:os";
import { basename, join } from "node:path";
import { Database } from "bun:sqlite";
import { textOf } from "./claude-transcript.ts";

/** How far a match's snippet reaches around the matched text, in characters. */
const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 140;

/**
 * The texts of the user and agent messages in one Claude Code transcript line: nothing for sidechains,
 * tool calls and results, thinking, system records and lines that are not a message at all.
 */
export function transcriptTexts(line: string): string[] {
  try {
    const record = JSON.parse(line);
    if (!record || typeof record !== "object" || record.isSidechain) return [];
    if (record.type !== "user" && record.type !== "assistant") return [];
    const text = textOf(record.message?.content).trim();
    return text ? [text] : [];
  } catch {
    return [];
  }
}

/** The first text holding the lower-cased query, cut to a one-line snippet around the match. */
export function matchingSnippet(texts: string[], lowerQuery: string): string | null {
  for (const text of texts) {
    const index = text.toLowerCase().indexOf(lowerQuery);
    if (index < 0) continue;
    const start = Math.max(0, index - SNIPPET_BEFORE);
    const end = Math.min(text.length, index + lowerQuery.length + SNIPPET_AFTER);
    const flat = text.slice(start, end).replace(/\s+/g, " ").trim();
    return `${start > 0 ? "…" : ""}${flat}${end < text.length ? "…" : ""}`;
  }
  return null;
}

/** The transcript files of the sessions, by session id, wherever Claude Code put them. */
export async function claudeTranscriptPaths(configDir: string, sessionIds: Set<string>): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  try {
    for await (const path of new Bun.Glob("*/*.jsonl").scan({ cwd: join(configDir, "projects"), absolute: true })) {
      const sessionId = basename(path, ".jsonl");
      if (sessionIds.has(sessionId)) paths.set(sessionId, path);
    }
  } catch {
    // no projects directory at all
  }
  return paths;
}

/**
 * The query as a transcript line spells it: JSON-escaped, matched with the case folding of `u` regexes, which finds
 * every text whose lower case holds the query. A line without it is passed over without being parsed.
 */
export const queryAsWritten = (lowerQuery: string) => new RegExp(JSON.stringify(lowerQuery).slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");

/** The first message in a Claude Code transcript holding the lower-cased query, as a snippet; null if none does. */
export async function claudeMessageSnippet(path: string, lowerQuery: string): Promise<string | null> {
  const written = queryAsWritten(lowerQuery);
  try {
    for await (const line of linesOf(Bun.file(path).stream())) {
      if (!written.test(line)) continue;
      const snippet = matchingSnippet(transcriptTexts(line), lowerQuery);
      if (snippet !== null) return snippet;
    }
  } catch {
    // a transcript that vanished or cannot be read simply matches nothing
  }
  return null;
}

/**
 * The lines of a file's UTF-8 chunks, read chunk by chunk so that a transcript bigger than memory still scans. Only the
 * newest chunk is searched for line ends, so a line spanning many chunks costs no more than its length.
 */
export async function* linesOf(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of chunks) {
    const text = decoder.decode(chunk, { stream: true });
    const lastBreak = text.lastIndexOf("\n");
    if (lastBreak < 0) {
      pending += text;
      continue;
    }
    const lines = (pending + text.slice(0, lastBreak)).split("\n");
    pending = text.slice(lastBreak + 1);
    yield* lines;
  }
  pending += decoder.decode();
  if (pending) yield pending;
}

/** Where opencode keeps its database, following XDG_DATA_HOME the way opencode does. */
export const opencodeDatabasePath = (environment: Record<string, string | undefined>): string =>
  join(environment.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "opencode.db");

/** opencode's database for reading, or null when there is none to read, as when opencode never ran. */
export function openOpencodeDatabase(path: string): Database | null {
  try {
    return new Database(path, { readonly: true });
  } catch {
    return null;
  }
}

/** The first message of a session holding the lower-cased query, as a snippet; null when none does. */
export async function messageSnippetOf(
  sessionId: string,
  lowerQuery: string,
  transcriptPaths: Map<string, string> | null,
  database: Database | null,
): Promise<string | null> {
  if (transcriptPaths) {
    const path = transcriptPaths.get(sessionId);
    return path ? claudeMessageSnippet(path, lowerQuery) : null;
  }
  if (!database) return null;
  try {
    return matchingSnippet(opencodeMessageTexts(database, sessionId), lowerQuery);
  } catch {
    return null;
  }
}

/** The texts of the user and agent messages opencode stored for a session, oldest first. */
export function opencodeMessageTexts(db: Database, sessionId: string): string[] {
  const rows = db
    .query(
      `SELECT json_extract(p.data, '$.text') AS text FROM part p JOIN message m ON m.id = p.message_id
       WHERE p.session_id = ? AND json_extract(p.data, '$.type') = 'text' AND json_extract(m.data, '$.role') IN ('user', 'assistant')
       ORDER BY p.time_created, p.id`,
    )
    .all(sessionId) as { text: unknown }[];
  return rows.flatMap(({ text }) => (typeof text === "string" && text ? [text] : []));
}
