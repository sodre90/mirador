import { describe, expect, test } from "bun:test";
import { applyEnvironment, maskSecrets, parseEnvironment } from "../shared/profile-environment.ts";

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
      unset: ["ANTHROPIC_API_KEY"],
      errors: [],
    });
  });

  test("reports lines it does not understand and values that would need expansion", () => {
    const { errors } = parseEnvironment('local -a claude_env=(\nANTHROPIC_MODEL="$model"\nOK=1');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toStartWith("Line 1 ");
    expect(errors[1]).toContain("ANTHROPIC_MODEL uses $");
  });
});

test("applyEnvironment unsets before it sets", () => {
  const environment = parseEnvironment("-u A\n-u B\nB=new\nC=3");
  expect(applyEnvironment({ A: "1", B: "2", KEEP: "k" }, environment)).toEqual({ KEEP: "k", B: "new", C: "3" });
});

test("maskSecrets hides the values of token-like variables only", () => {
  expect(maskSecrets('ANTHROPIC_AUTH_TOKEN="sk-123"\nANTHROPIC_BASE_URL=https://x\nOPENROUTER_API_KEY=abc\n-u ANTHROPIC_API_KEY')).toBe(
    "ANTHROPIC_AUTH_TOKEN=••••••\nANTHROPIC_BASE_URL=https://x\nOPENROUTER_API_KEY=••••••\n-u ANTHROPIC_API_KEY",
  );
});
