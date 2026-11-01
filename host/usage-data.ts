import { Database } from "bun:sqlite";
import type { HarnessId, StoredEvent } from "../shared/model.ts";

export interface UsageConversation {
  id: string;
  title: string;
  harness: HarnessId;
  workspaceId: string;
  workspaceName: string;
  profileId: string | null;
  /** Null when the conversation has no profile, or its profile was deleted. */
  profileName: string | null;
  lastEventAt: number | null;
}

export interface UsageWorkspace {
  id: string;
  name: string;
  path: string;
}

export interface UsageProfile {
  name: string;
  harness: HarnessId;
}

/**
 * A read-only connection, or where the database's -wal and -shm files are missing, which a read-only connection can't
 * make (sqlite3 deletes them when it closes the database last), one that may only read.
 */
function readOnlyConnection(databasePath: string): Database {
  const readOnly = new Database(databasePath, { readonly: true });
  try {
    readOnly.query("SELECT 1 FROM sqlite_master LIMIT 1").get();
    return readOnly;
  } catch {
    readOnly.close();
    const readingOnly = new Database(databasePath, { readwrite: true, create: false });
    readingOnly.run("PRAGMA query_only = ON");
    return readingOnly;
  }
}

/**
 * What usage reports read, on a read-only connection: it neither takes the write lock nor migrates the database, and
 * in WAL mode it reads beside a running host without holding up its writes.
 */
export class UsageData {
  constructor(private readonly db: Database) {}

  static open(databasePath: string) {
    return new UsageData(readOnlyConnection(databasePath));
  }

  close() {
    this.db.close();
  }

  workspaces(): UsageWorkspace[] {
    return this.db.query("SELECT id, name, path FROM workspaces ORDER BY name COLLATE NOCASE").all() as UsageWorkspace[];
  }

  profiles(): UsageProfile[] {
    return this.db.query("SELECT name, harness FROM profiles ORDER BY name COLLATE NOCASE").all() as UsageProfile[];
  }

  /** Every conversation, with its workspace, its profile and when its latest event was written; null for one without any. */
  conversations(): UsageConversation[] {
    return this.db
      .query(
        `SELECT c.id, c.title, c.harness, c.workspace_id AS workspaceId, w.name AS workspaceName, c.profile_id AS profileId, p.name AS profileName,
           (SELECT at FROM events WHERE conversation_id = c.id ORDER BY seq DESC LIMIT 1) AS lastEventAt
         FROM conversations c JOIN workspaces w ON w.id = c.workspace_id LEFT JOIN profiles p ON p.id = c.profile_id`,
      )
      .all() as UsageConversation[];
  }

  /**
   * The events from `from` until before `to` that usage stats count, of every conversation or the ones given, by
   * conversation: messages, turn ends, errors, permissions and tool calls, and the profile changes since `from`, later
   * ones too, as each names the profile it left. Tool output is left out except where a call failed, as only a failure's
   * message is reported, and a message keeps only its start, enough to sample what the user asks. One pass over the
   * table, as reading each conversation through its key took three times as long, and no `instr` prefilter: SQLite 3.53
   * parses a row's JSON faster than `instr` rules it out.
   */
  events(from: number, to: number, conversationIds: string[] | null): Map<string, StoredEvent[]> {
    const rows = this.db
      .query(
        `SELECT conversation_id AS conversationId, seq, at, CASE
             WHEN json_extract(event, '$.type') = 'acp' AND json_extract(event, '$.update.status') IS NOT 'failed'
               THEN json_remove(event, '$.update.content', '$.update.rawOutput')
             WHEN json_extract(event, '$.type') = 'user-message'
               THEN json_set(json_remove(event, '$.checkpoint'), '$.text', substr(json_extract(event, '$.text'), 1, 400))
             ELSE json_remove(event, '$.text', '$.edits', '$.update.rawOutput') END AS event
         FROM events NOT INDEXED WHERE (?3 IS NULL OR conversation_id IN (SELECT value FROM json_each(?3))) AND at >= ?1
         AND ((at < ?2 AND (json_extract(event, '$.type') IN ('user-message', 'turn-end', 'error', 'permission', 'permission-resolved')
               OR json_extract(event, '$.update.sessionUpdate') IN ('tool_call', 'tool_call_update')))
           OR json_extract(event, '$.type') = 'profile-changed')
         ORDER BY conversation_id, seq`,
      )
      .iterate(from, to, conversationIds && JSON.stringify(conversationIds)) as IterableIterator<{ conversationId: string; seq: number; at: number; event: string }>;
    const byConversation = new Map<string, StoredEvent[]>();
    for (const { conversationId, seq, at, event } of rows) {
      if (!byConversation.has(conversationId)) byConversation.set(conversationId, []);
      byConversation.get(conversationId)!.push({ seq, at, event: JSON.parse(event) });
    }
    return byConversation;
  }
}
