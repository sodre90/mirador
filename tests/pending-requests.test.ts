import { describe, expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import type { AskItem } from "../shared/model.ts";
import { pendingAsk, pendingPermission } from "../host/pending-requests.ts";

const options: acp.PermissionOption[] = [
  { optionId: "allow", name: "Allow once", kind: "allow_once" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];

const ask = (change: Partial<AskItem>): AskItem => ({ id: "a1", conversationId: "c1", kind: "ask", title: "Which layout?", status: "waiting", createdAt: 1, ...change });

describe("a pending permission request", () => {
  test("carries the shell command it would run, with the agent's description, and the answers", () => {
    const toolCall = { toolCallId: "t1", title: "bash", kind: "execute" as const, rawInput: { command: "git push", description: "Push the branch" } };
    expect(pendingPermission("p1", { toolCall, options })).toEqual({
      kind: "permission",
      permissionId: "p1",
      title: "bash",
      toolKind: "execute",
      command: "git push",
      description: "Push the branch",
      options,
    });
  });

  test("takes the title for a command the input does not name, and cuts a long one short", () => {
    expect(pendingPermission("p1", { toolCall: { toolCallId: "t1", title: "ls -la", kind: "execute" }, options })).toMatchObject({ command: "ls -la", description: null });
    const toolCall = { toolCallId: "t1", title: "Bash", kind: "execute" as const, rawInput: { command: `echo ${"x".repeat(1_000)}` } };
    expect(pendingPermission("p1", { toolCall, options }).command).toHaveLength(501);
  });

  test("a command cut short keeps an emoji at the cut whole", () => {
    const toolCall = { toolCallId: "t1", title: "Bash", kind: "execute" as const, rawInput: { command: `${"a".repeat(499)}😀b` } };
    expect(pendingPermission("p1", { toolCall, options }).command).toBe(`${"a".repeat(499)}😀…`);
  });

  test("of another tool carries no command, since its input, diffs or plan show only in the conversation", () => {
    const plan: acp.ToolCallContent = { type: "content", content: { type: "text", text: "Implement the following plan: …" } };
    expect(pendingPermission("p1", { toolCall: { toolCallId: "t1", title: "Edit a.ts", kind: "edit", rawInput: { command: "not a shell" } }, options }).command).toBeNull();
    expect(pendingPermission("p1", { toolCall: { toolCallId: "t1", title: "ExitPlanMode", kind: "switch_mode", content: [plan] }, options })).toMatchObject({ command: null, description: null });
    expect(pendingPermission("p1", { toolCall: { toolCallId: "t1", kind: "fetch" }, options }).title).toBe("a tool");
  });
});

describe("the kind of tool a pending permission request is about", () => {
  test("is the one the request says, or else the one the agent's updates gave its tool call", () => {
    expect(pendingPermission("p1", { toolCall: { toolCallId: "t1", title: "Fetch https://example.com", kind: "fetch" }, options }, "edit").toolKind).toBe("fetch");
    expect(pendingPermission("p1", { toolCall: { toolCallId: "t1", title: "Write notes.md" }, options }, "edit").toolKind).toBe("edit");
    expect(pendingPermission("p1", { toolCall: { toolCallId: "t1", title: "something" }, options }).toolKind).toBeNull();
  });

  test("a shell command known only from the updates still carries its command", () => {
    const toolCall = { toolCallId: "t1", title: "bash", rawInput: { command: "git push" } };
    expect(pendingPermission("p1", { toolCall, options }, "execute")).toMatchObject({ toolKind: "execute", command: "git push" });
  });
});

describe("a pending ask", () => {
  test("carries its question and answers, the recommended one marked, and whether it shows pages", () => {
    const plain = ask({ question: "Which layout?", options: [{ label: "Grid", description: "Cards in rows" }, { label: "List", recommended: true }], allowOther: true });
    expect(pendingAsk(plain)).toEqual({
      kind: "ask",
      itemId: "a1",
      question: "Which layout?",
      choices: [{ label: "Grid", description: "Cards in rows" }, { label: "List", recommended: true }],
      allowOther: true,
      questions: 1,
      previews: false,
    });
    expect(pendingAsk(ask({ question: "Which colour?", html: "<p>Why</p>", options: [{ label: "Red" }] })).previews).toBe(true);
    expect(pendingAsk(ask({ question: "Which colour?", options: [{ label: "Red", html: "<div>Red</div>" }] })).previews).toBe(true);
  });

  test("of several questions carries the first, and how many there are", () => {
    const several = ask({
      title: "2 questions: Which layout?",
      question: "Which layout?",
      questions: [
        { question: "Which layout?", options: [{ label: "Grid" }] },
        { question: "Which colour?", options: [{ label: "Red", html: "<div>Red</div>" }] },
      ],
    });
    expect(pendingAsk(several)).toMatchObject({ question: "Which layout?", choices: [{ label: "Grid" }], allowOther: false, questions: 2, previews: true });
  });
});
