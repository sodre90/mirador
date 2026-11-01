import { describe, expect, test } from "bun:test";
import type { PermissionOption, ToolCallUpdate } from "@agentclientprotocol/sdk";
import type { ConversationEvent, StoredEvent } from "../shared/model.ts";
import type { DiffRow, EditDiff } from "../shared/review.ts";
import { editRequestsIn, settledEditNote, splitRows } from "../web/edit-approval.ts";

const row = (kind: DiffRow["kind"]): DiffRow => ({ kind, oldLine: null, newLine: null, text: kind });
const options: PermissionOption[] = [
  { optionId: "yes", name: "Allow", kind: "allow_once" },
  { optionId: "always", name: "Always allow", kind: "allow_always" },
  { optionId: "no", name: "Reject", kind: "reject_once" },
];
const edit = (path: string): EditDiff => ({ path, change: "modified", added: 1, removed: 1, hunks: [], hiddenBecause: null, located: true, lineCount: 3 });
const toolCall = (title: string): ToolCallUpdate => ({ toolCallId: title, title, kind: "edit" });
const stored = (events: ConversationEvent[]): StoredEvent[] => events.map((event, seq) => ({ seq, at: seq, event }));

describe("the edits the agent asked permission for", () => {
  test("are the requests that change files, oldest first, each with what the user answered", () => {
    const requests = editRequestsIn(
      stored([
        { type: "permission", permissionId: "p1", toolCall: toolCall("Edit a.ts"), options, edits: [edit("a.ts")] },
        { type: "permission", permissionId: "shell", toolCall: toolCall("Run ls"), options },
        { type: "permission", permissionId: "p2", toolCall: toolCall("Write b.ts"), options, edits: [edit("b.ts")] },
        { type: "permission-resolved", permissionId: "p1", optionId: "no" },
        { type: "permission-resolved", permissionId: "shell", optionId: "yes" },
      ]),
    );
    expect(requests.map(({ permissionId, title, resolved, chosenOptionId }) => ({ permissionId, title, resolved, chosenOptionId }))).toEqual([
      { permissionId: "p1", title: "Edit a.ts", resolved: true, chosenOptionId: "no" },
      { permissionId: "p2", title: "Write b.ts", resolved: false, chosenOptionId: null },
    ]);
  });

  test("leave a note of the answer on the canvas, plain rather than green when the edit did not go ahead", () => {
    const request = { permissionId: "p", title: "Edit a.ts", options, edits: [edit("web/Chat.tsx")], resolved: true };
    expect(settledEditNote({ ...request, chosenOptionId: "yes" })).toEqual({ text: "✓ Allowed: edit to web/Chat.tsx", tone: "done" });
    expect(settledEditNote({ ...request, chosenOptionId: "always" })).toEqual({ text: "✓ Always allowed: edit to web/Chat.tsx", tone: "done" });
    expect(settledEditNote({ ...request, chosenOptionId: "no" })).toEqual({ text: "✗ Rejected: edit to web/Chat.tsx", tone: "neutral" });
    expect(settledEditNote({ ...request, chosenOptionId: null })).toEqual({ text: "The agent no longer waits to edit web/Chat.tsx.", tone: "neutral" });
  });
});

describe("a side-by-side diff", () => {
  test("faces each run of removed lines with the added lines after it, and shows the context on both sides", () => {
    const rows = [row("context"), row("removed"), row("removed"), row("added"), row("context"), row("added"), row("removed"), row("added"), row("removed")];
    expect(splitRows(rows)).toEqual([
      { left: 0, right: 0 },
      { left: 1, right: 3 },
      { left: 2, right: null },
      { left: 4, right: 4 },
      { left: null, right: 5 },
      { left: 6, right: 7 },
      { left: 8, right: null },
    ]);
  });
});
