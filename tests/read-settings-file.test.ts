import { describe, expect, test } from "bun:test";
import { HostProblemError } from "../shared/host-problems.ts";
import { readSettingsFile } from "../host/settings-file/read-settings-file.ts";
import { textOf } from "./settings-move.ts";

function refusalOf(text: string) {
  try {
    readSettingsFile(text);
  } catch (error) {
    return error instanceof HostProblemError ? error.problem : error;
  }
}

describe("a settings file", () => {
  test("is refused when it is no JSON, has no schemaVersion, or is from a newer Mirador", () => {
    expect(refusalOf("profiles:\n  - name: work")).toEqual({ code: "settings-file-not-json" });
    expect(refusalOf("[]")).toEqual({ code: "settings-file-not-settings" });
    expect(refusalOf(`{"profiles": []}`)).toEqual({ code: "settings-file-not-settings" });
    expect(refusalOf(`{"schemaVersion": "1"}`)).toEqual({ code: "settings-file-not-settings" });
    expect(refusalOf(`{"schemaVersion": 2}`)).toEqual({ code: "settings-file-newer", version: 2, newest: 1 });
  });

  test("needs no more than its version, and may start with a byte order mark", () => {
    expect(readSettingsFile(`\uFEFF{"schemaVersion": 1}`)).toEqual({ file: { schemaVersion: 1, profiles: [], promptTemplates: [], workspaces: [], plugins: [], preferences: {} }, problems: [] });
  });

  test("an entry that can't be read is left out by name, and the others are read", () => {
    const { file, problems } = readSettingsFile(
      textOf({
        profiles: [{ name: "work", harness: "claude", model: "opus" }, { name: "odd", harness: "emacs" }, { harness: "pi" }, { name: "loud", harness: "pi", color: "plaid" }],
        promptTemplates: [{ name: "Review", text: "Review {{what}}" }, { name: "Empty", text: " " }],
        plugins: [{ name: "checklist", settings: { size: 3 } }],
        preferences: { keepAwake: "sometimes", olderAfter: "1-week" },
      } as never),
    );
    expect(file.profiles).toEqual([{ name: "work", harness: "claude", model: "opus" }]);
    expect(file.promptTemplates).toEqual([{ name: "Review", text: "Review {{what}}" }]);
    expect(file.plugins).toEqual([]);
    expect(file.preferences).toEqual({ olderAfter: "1-week" });
    expect(problems).toEqual([
      { code: "settings-entry-invalid", kind: "profile", name: "odd", field: "harness" },
      { code: "settings-entry-invalid", kind: "profile", name: "?", field: "name" },
      { code: "settings-entry-invalid", kind: "profile", name: "loud", field: "color" },
      { code: "settings-entry-invalid", kind: "prompt-template", name: "Empty", field: "text" },
      { code: "settings-entry-invalid", kind: "plugin", name: "checklist", field: "settings" },
      { code: "settings-entry-invalid", kind: "preference", name: "keepAwake", field: "keepAwake" },
    ]);
  });

  test("what it has that this Mirador doesn't know is passed over", () => {
    const { file, problems } = readSettingsFile(textOf({ themes: ["dark"], profiles: [{ name: "work", harness: "claude", avatar: "cat.png" }], preferences: { fontSize: 14 } } as never));
    expect(file.profiles).toEqual([{ name: "work", harness: "claude" }]);
    expect(file.preferences).toEqual({});
    expect(problems).toEqual([]);
  });

  test("of two entries with one name the first counts, and a profile of that name on another agent is another profile", () => {
    const { file, problems } = readSettingsFile(
      textOf({
        profiles: [
          { name: "work", harness: "claude", model: "opus" },
          { name: "work ", harness: "claude", model: "haiku" },
          { name: "work", harness: "pi" },
        ],
      }),
    );
    expect(file.profiles).toEqual([
      { name: "work", harness: "claude", model: "opus" },
      { name: "work", harness: "pi" },
    ]);
    expect(problems).toEqual([{ code: "settings-entry-twice", kind: "profile", name: "work" }]);
  });

  test("a group inside a group comes out beside it", () => {
    const { file, problems } = readSettingsFile(
      textOf({ workspaces: [{ path: "~/loose" }, { group: "Work", workspaces: [{ path: "~/a" }, { group: "Clients", workspaces: [{ path: "~/b" }, { path: "~/a" }] }] }] } as never),
    );
    expect(file.workspaces).toEqual([
      { path: "~/loose" },
      { group: "Work", workspaces: [{ path: "~/a" }] },
      { group: "Clients", workspaces: [{ path: "~/b" }] },
    ]);
    expect(problems).toEqual([{ code: "settings-entry-twice", kind: "workspace", name: "~/a" }]);
  });

  test("an environment is of variables, each a value, a command, unset, or left out", () => {
    const environment = { TOKEN: { needsValue: true }, KEY: { command: "pass show key" }, OLD: { unset: true }, PLAIN: "x" } as const;
    const { file, problems } = readSettingsFile(
      textOf({
        profiles: [
          { name: "work", harness: "claude", environment },
          { name: "bad", harness: "claude", environment: { "NOT A NAME": "x" } },
          { name: "worse", harness: "claude", environment: { KEY: { command: "" } } },
        ],
      }),
    );
    expect(file.profiles).toEqual([{ name: "work", harness: "claude", environment }]);
    expect(problems.map((problem) => "name" in problem && problem.name)).toEqual(["bad", "worse"]);
  });
});
