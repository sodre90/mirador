import { describe, expect, test } from "bun:test";
import type { StoredEvent } from "../shared/model.ts";
import { latestSlashCommands, matchingCommands, slashQuery } from "../shared/slash-commands.ts";

const command = (name: string) => ({ name, description: `${name} it`, hint: null });

describe("slash commands", () => {
  test("are suggested while the message is a / and the start of a name, not once arguments or other text follow", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/comp")).toBe("comp");
    expect(slashQuery("/compact now")).toBeNull();
    expect(slashQuery("see /compact")).toBeNull();
    expect(slashQuery("!ls")).toBeNull();
  });

  test("match on the name: those starting with what is typed first, the closest first, then the rest in the agent's order", () => {
    const commands = ["simplify", "code-review", "review", "codex:review", "context7-mcp", "compact", "context"].map(command);
    expect(matchingCommands(commands, "rev").map(({ name }) => name)).toEqual(["review", "code-review", "codex:review"]);
    expect(matchingCommands(commands, "C").map(({ name }) => name)).toEqual(["compact", "context", "code-review", "codex:review", "context7-mcp"]);
    expect(matchingCommands(commands, "contex").map(({ name }) => name)).toEqual(["context", "context7-mcp"]);
    expect(matchingCommands(commands, "").map(({ name }) => name)).toEqual(commands.map(({ name }) => name));
  });

  test("come from the agent's latest list in the conversation, with their argument hints", () => {
    const listing = (seq: number, names: string[]): StoredEvent => ({
      seq,
      at: seq,
      event: {
        type: "acp",
        update: { sessionUpdate: "available_commands_update", availableCommands: names.map((name) => ({ name, description: "", input: name === "model" ? { hint: "<model>" } : null })) },
      },
    });
    const message: StoredEvent = { seq: 3, at: 3, event: { type: "user-message", text: "hi" } };
    expect(latestSlashCommands([message])).toBeNull();
    expect(latestSlashCommands([listing(1, ["init"]), listing(2, ["init", "model"]), message])).toEqual([
      { name: "init", description: "", hint: null },
      { name: "model", description: "", hint: "<model>" },
    ]);
  });

  test("forget the list of the agent a conversation moved away from, and keep the one from before a profile change on the same agent", () => {
    const listing: StoredEvent = { seq: 1, at: 1, event: { type: "acp", update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "init", description: "", input: null }] } } };
    const changed = (agent?: "opencode"): StoredEvent => ({ seq: 2, at: 2, event: { type: "profile-changed", profileName: "Other", ...(agent && { agent }) } });
    expect(latestSlashCommands([listing, changed()])).toEqual([{ name: "init", description: "", hint: null }]);
    expect(latestSlashCommands([listing, changed("opencode")])).toBeNull();
  });
});
