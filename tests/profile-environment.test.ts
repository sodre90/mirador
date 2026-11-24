import { describe, expect, test } from "bun:test";
import { applyEnvironment, assignmentLine, commandLineOf, maskSecrets, parseEnvironment } from "../shared/profile-environment.ts";

describe("parseEnvironment", () => {
  test("reads the lines of a shell env argument array", () => {
    const pasted = `
      -u ANTHROPIC_API_KEY
      # unlimited token
      ANTHROPIC_AUTH_TOKEN="sk-123"
      ANTHROPIC_BASE_URL=https://gateway.example # work gateway
      export API_TIMEOUT_MS=600000
      LITERAL='$not-expanded'
      EMPTY=
    `;
    expect(parseEnvironment(pasted)).toEqual({
      set: {
        ANTHROPIC_AUTH_TOKEN: "sk-123",
        ANTHROPIC_BASE_URL: "https://gateway.example",
        API_TIMEOUT_MS: "600000",
        LITERAL: "$not-expanded",
        EMPTY: "",
      },
      commands: {},
      unset: ["ANTHROPIC_API_KEY"],
      errors: [],
    });
  });

  test("a # starts a comment only at the start of a line or after a space, as in a shell", () => {
    const pasted = ["KEY=sk-ab#cd", "URL=https://h/p#frag", "NOTE=x #note", "SPACED=y   # note", 'QUOTED="a b" # note', "EMPTY= # note", "-u OLD # gone", "-u OTHER"].join("\n");
    expect(parseEnvironment(pasted)).toEqual({
      set: { KEY: "sk-ab#cd", URL: "https://h/p#frag", NOTE: "x", SPACED: "y", QUOTED: "a b", EMPTY: "" },
      commands: {},
      unset: ["OLD", "OTHER"],
      errors: [],
    });
  });

  test("an unset name followed by a # without a space is no name", () => {
    expect(parseEnvironment("-u OLD#gone").errors).toHaveLength(1);
  });

  test("reads $(command) as the command whose output the variable gets", () => {
    const { set, commands, errors } = parseEnvironment(
      [
        "ANTHROPIC_AUTH_TOKEN=$(security find-generic-password -s 'my gateway' -w)",
        'export QUOTED="$(cat "$HOME/.token")" # note (with parentheses)',
        "NESTED=$(cat $(echo ~/.token))",
        "LITERAL='$(not run)'",
        "REPLACED=$(old)",
        "REPLACED=new",
        "REPLACING=old",
        "REPLACING=$(new)",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(set).toEqual({ LITERAL: "$(not run)", REPLACED: "new" });
    expect(commands).toEqual({
      ANTHROPIC_AUTH_TOKEN: "security find-generic-password -s 'my gateway' -w",
      QUOTED: 'cat "$HOME/.token"',
      NESTED: "cat $(echo ~/.token)",
      REPLACING: "new",
    });
  });

  test("takes no command that is only a part of the value, nor an empty one", () => {
    const { commands, errors } = parseEnvironment(["PART=a$(b)", "TWO=$(a)-$(b)", "EMPTY=$()"].join("\n"));
    expect(commands).toEqual({});
    expect(errors).toHaveLength(3);
  });

  test("reports lines it does not understand and values that would need expansion", () => {
    const { errors } = parseEnvironment('local -a claude_env=(\nANTHROPIC_MODEL="$model"\nOK=1');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toStartWith("Line 1 ");
    expect(errors[1]).toContain("ANTHROPIC_MODEL uses $");
  });

  test("a JSON value is told it needs quotes, and parses once it has them", () => {
    const value = '[{"name":"owners-command","description":"Owned"}]';
    expect(parseEnvironment(`OPENCODE_FAKE_ACP_COMMANDS=${value}`)).toEqual({
      set: {},
      commands: {},
      unset: [],
      errors: ["Line 1: the value of OPENCODE_FAKE_ACP_COMMANDS has spaces or quotes, so it needs quotes around the whole value, as in OPENCODE_FAKE_ACP_COMMANDS='the value'"],
    });
    expect(parseEnvironment(`OPENCODE_FAKE_ACP_COMMANDS='${value}'`)).toEqual({
      set: { OPENCODE_FAKE_ACP_COMMANDS: value },
      commands: {},
      unset: [],
      errors: [],
    });
  });

  test("a value with a single quote of its own is shown wrapped in double quotes", () => {
    expect(parseEnvironment("NOTE=Owner's note").errors).toEqual([
      'Line 1: the value of NOTE has spaces or quotes, so it needs quotes around the whole value, as in NOTE="the value"',
    ]);
  });
});

test("applyEnvironment unsets before it sets", () => {
  const environment = parseEnvironment("-u A\n-u B\nB=new\nC=3");
  expect(applyEnvironment({ A: "1", B: "2", KEEP: "k" }, environment)).toEqual({ KEEP: "k", B: "new", C: "3" });
});

test("applyEnvironment leaves a variable a command gives the value of to whoever ran the command", () => {
  expect(applyEnvironment({ TOKEN: "inherited", KEEP: "k" }, parseEnvironment("TOKEN=$(print-token)"))).toEqual({ KEEP: "k" });
});

describe("the line that sets a variable", () => {
  test.each(["plain", "two words", "a#b", "a # b", "it's", 'say "hi"', "$literal", "", '{"model":"qwen3"}'])("gives back %p", (value) => {
    expect(parseEnvironment(assignmentLine("NAME", value)!)).toEqual({ set: { NAME: value }, commands: {}, unset: [], errors: [] });
  });

  test.each(["two\nlines", `both ' and "`, "it's $5"])("is none for %p, which no line can write", (value) => {
    expect(assignmentLine("NAME", value)).toBeNull();
  });

  test("gives back a command, and is none for one it can't write", () => {
    expect(parseEnvironment(commandLineOf("NAME", "op read 'op://a/b' | tr -d x")!).commands).toEqual({ NAME: "op read 'op://a/b' | tr -d x" });
    expect(commandLineOf("NAME", "two\nlines")).toBeNull();
    expect(commandLineOf("NAME", "echo ')'")).toBeNull();
  });
});

test("maskSecrets hides the values of token-like variables only", () => {
  expect(maskSecrets('ANTHROPIC_AUTH_TOKEN="sk-123"\nANTHROPIC_BASE_URL=https://x\nOPENROUTER_API_KEY=abc\n-u ANTHROPIC_API_KEY')).toBe(
    "ANTHROPIC_AUTH_TOKEN=••••••\nANTHROPIC_BASE_URL=https://x\nOPENROUTER_API_KEY=••••••\n-u ANTHROPIC_API_KEY",
  );
});
