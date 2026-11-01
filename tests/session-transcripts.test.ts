import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  claudeMessageSnippet,
  claudeTranscriptPaths,
  linesOf,
  matchingSnippet,
  messageSnippetOf,
  openOpencodeDatabase,
  opencodeDatabasePath,
  opencodeMessageTexts,
  queryAsWritten,
  transcriptTexts,
} from "../host/session-transcripts.ts";

const record = (fields: Record<string, unknown>) => JSON.stringify(fields);
const spoken = (type: "user" | "assistant", text: string) => record({ type, message: { role: type, content: [{ type: "text", text }] } });

test("a transcript line's message texts hold what user and agent said, not tool output, thinking or sidechains", () => {
  expect(transcriptTexts(spoken("user", "Remember the word heliotrope"))).toEqual(["Remember the word heliotrope"]);
  expect(transcriptTexts(spoken("assistant", "I will keep heliotrope in mind."))).toEqual(["I will keep heliotrope in mind."]);
  expect(transcriptTexts(record({ type: "user", message: { role: "user", content: "plain string content" } }))).toEqual(["plain string content"]);
  expect(transcriptTexts(record({ type: "user", isSidechain: true, message: { role: "user", content: "heliotrope from a subagent" } }))).toEqual([]);
  expect(
    transcriptTexts(
      record({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", content: "heliotrope appears only in tool output" }] },
      }),
    ),
  ).toEqual([]);
  expect(
    transcriptTexts(
      record({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "thinking", thinking: "heliotrope?" }, { type: "tool_use", name: "Bash" }] },
      }),
    ),
  ).toEqual([]);
  expect(
    transcriptTexts(
      record({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "the answer" }] },
      }),
    ),
  ).toEqual(["the answer"]);
  expect(transcriptTexts(record({ type: "queue-operation", operation: "enqueue" }))).toEqual([]);
  expect(transcriptTexts("{ not json")).toEqual([]);
  expect(transcriptTexts("")).toEqual([]);
});

test("the snippet holds the matched text in lower-case terms, cut to one line around it", () => {
  expect(matchingSnippet(["Fix the AuthProvider bug"], "authprovider")).toBe("Fix the AuthProvider bug");
  expect(matchingSnippet(["nothing here"], "authprovider")).toBeNull();
  const windowed = matchingSnippet(["before ".repeat(50) + "heliotrope" + " after".repeat(50)], "heliotrope")!;
  expect(windowed.startsWith("…")).toBe(true);
  expect(windowed.endsWith("…")).toBe(true);
  expect(windowed).toContain("heliotrope");
  expect(windowed.length).toBeLessThan(250);
  expect(matchingSnippet(["two\nheliotrope lines\nfolded"], "heliotrope")).toBe("two heliotrope lines folded");
  expect(matchingSnippet(["first mentions heliotrope", "heliotrope comes again"], "heliotrope")).toBe("first mentions heliotrope");
});

test("transcripts are found under whichever short-named project directories Claude Code keeps them", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "mirador-search-"));
  mkdirSync(join(configDir, "projects", "-private-a-project"), { recursive: true });
  mkdirSync(join(configDir, "projects", "-private-b-long-path-shortened"), { recursive: true });
  writeFileSync(join(configDir, "projects", "-private-a-project", "s-1.jsonl"), spoken("user", "one"));
  writeFileSync(join(configDir, "projects", "-private-b-long-path-shortened", "s-2.jsonl"), spoken("user", "two"));
  writeFileSync(join(configDir, "projects", "-private-b-long-path-shortened", "s-3.jsonl"), spoken("user", "three"));
  const paths = await claudeTranscriptPaths(configDir, new Set(["s-1", "s-2"]));
  expect(paths.get("s-1")).toBe(join(configDir, "projects", "-private-a-project", "s-1.jsonl"));
  expect(paths.get("s-2")).toBe(join(configDir, "projects", "-private-b-long-path-shortened", "s-2.jsonl"));
  expect(paths.has("s-3")).toBe(false);
  expect((await claudeTranscriptPaths(join(configDir, "missing"), new Set(["s-1"]))).size).toBe(0);
});

test("a transcript's search skips records that are not messages and stops at the first that matches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mirador-search-"));
  const path = join(dir, "s-1.jsonl");
  const longText = "x".repeat(500);
  writeFileSync(
    path,
    [
      record({ type: "queue-operation" }),
      record({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "about zebras in tool output" }] } }),
      spoken("user", longText),
      spoken("assistant", "The zebra migration went well."),
      spoken("assistant", "zebra again"),
    ].join("\n"),
  );
  const snippet = await claudeMessageSnippet(path, "zebra");
  expect(snippet).toContain("The zebra migration");
  expect(snippet).not.toContain("again");
  expect(await claudeMessageSnippet(path, "nothere")).toBeNull();
  expect(await claudeMessageSnippet(join(dir, "gone.jsonl"), "zebra")).toBeNull();
});

test("a line is passed over unparsed only when no message in it could hold the query", () => {
  const found = [
    ["She said \"Hello World\" twice", 'said "hello'],
    ["The path C:\\Users\\Me\\notes.txt", "c:\\users\\me"],
    ["Measured in \u212Aelvin, not Celsius", "kelvin"],
    ["Die Straße nach Ünterberg", "straße nach ün"],
    ["A tab\there and (brackets) [too] {all} $5.00 a+b?", "(brackets) [too] {all} $5.00 a+b?"],
  ];
  for (const [text, query] of found) {
    const lowerQuery = query.toLowerCase();
    expect(matchingSnippet([text], lowerQuery)).not.toBeNull();
    expect(queryAsWritten(lowerQuery).test(spoken("user", text))).toBe(true);
  }
  expect(queryAsWritten("zebra").test(spoken("user", "A giraffe"))).toBe(false);
});

const chunked = async function* (...chunks: (string | number[])[]) {
  for (const chunk of chunks) yield typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
};
const linesFrom = async (...chunks: (string | number[])[]) => Array.fromAsync(linesOf(chunked(...chunks)));

test("lines come whole however the chunks cut them, a line longer than many chunks too", async () => {
  expect(await linesFrom("first li", "ne goes o", "n and on", "\nsecond")).toEqual(["first line goes on and on", "second"]);
  expect(await linesFrom("one\n", "two\n")).toEqual(["one", "two"]);
  expect(await linesFrom("a\nb", "\n\nc\n")).toEqual(["a", "b", "", "c"]);
  expect(await linesFrom("caf", [0xc3], [0xa9, 0x0a], "next")).toEqual(["café", "next"]);
  expect(await linesFrom()).toEqual([]);
});

test("opencode's database follows XDG_DATA_HOME and there is none until opencode runs", () => {
  expect(opencodeDatabasePath({ XDG_DATA_HOME: "/srv/data" })).toBe(join("/srv/data", "opencode", "opencode.db"));
  expect(opencodeDatabasePath({})).toBe(join(homedir(), ".local", "share", "opencode", "opencode.db"));
  expect(openOpencodeDatabase(join(mkdtempSync(join(tmpdir(), "mirador-oc-")), "absent.db"))).toBeNull();
});

const opencodeFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "mirador-oc-"));
  const path = join(dir, "opencode.db");
  const db = new Database(path);
  db.run("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_updated INTEGER)");
  db.run("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT)");
  db.run("CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT)");
  const say = (message: string, session: string, role: string, time: number, parts: [string, string][]) => {
    db.query("INSERT INTO message VALUES (?, ?, ?)").run(message, session, JSON.stringify({ role }));
    parts.forEach(([type, text], index) =>
      db
        .query("INSERT INTO part VALUES (?, ?, ?, ?, ?)")
        .run(`${message}-p${index}`, message, session, time + index, JSON.stringify(type === "text" ? { type, text } : { type, tool: text })),
    );
  };
  db.query("INSERT INTO session VALUES ('ses_1', '/w', 'Fix the login', 2)").run();
  say("m1", "ses_1", "user", 10, [
    ["text", "the bug hides in the session-search box"],
    ["tool", "session-search appears in tool output only"],
  ]);
  say("m2", "ses_1", "assistant", 20, [
    ["reasoning", "session-search in reasoning only"],
    ["text", "I fixed the session-search box."],
  ]);
  say("m3", "ses_1", "user", 30, [["text", "old word"]]);
  say("m9", "ses_2", "user", 5, [["text", "another session says session-search first"]]);
  return path;
};

test("opencode's stored texts are the session's user and agent messages, oldest first", () => {
  const db = openOpencodeDatabase(opencodeFixture());
  expect(db).not.toBeNull();
  expect(opencodeMessageTexts(db!, "ses_1")).toEqual(["the bug hides in the session-search box", "I fixed the session-search box.", "old word"]);
  expect(opencodeMessageTexts(db!, "ses_2")).toEqual(["another session says session-search first"]);
  expect(opencodeMessageTexts(db!, "ses-absent")).toEqual([]);
  db!.close();
});

test("a session's snippet comes from its transcript when Claude Code keeps it, and from opencode's records when opencode does", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mirador-search-"));
  const transcript = join(dir, "s-1.jsonl");
  writeFileSync(transcript, [spoken("assistant", "The zebra migration went well."), spoken("assistant", "zebra again")].join("\n"));
  const transcriptSnippet = await messageSnippetOf("s-1", "zebra", new Map([["s-1", transcript]]), null);
  expect(transcriptSnippet).toContain("The zebra migration");
  expect(await messageSnippetOf("s-2", "zebra", new Map([["s-1", transcript]]), null)).toBeNull();

  const db = openOpencodeDatabase(opencodeFixture());
  expect(await messageSnippetOf("ses_1", "session-search", null, db)).toContain("session-search box");
  expect(await messageSnippetOf("ses-absent", "session-search", null, db)).toBeNull();
  db!.close();
  expect(await messageSnippetOf("ses_1", "session-search", null, null)).toBeNull();
});
