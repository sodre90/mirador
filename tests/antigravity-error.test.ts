import { describe, expect, test } from "bun:test";
import type { HarnessId } from "../shared/model.ts";
import { antigravityErrorReplyIn, isAntigravityAuthError } from "../shared/antigravity-error.ts";

const endedWith = (lastChunk: string, stopReason = "end_turn") => ({ stopReason, lastChunk });

describe("an Antigravity model error that ends a turn as a reply", () => {
  test("reads any final '\\n⚠ …\\n' chunk as the error, including multi-line bodies", () => {
    const errorOf = (lastChunk: string, harness: HarnessId = "antigravity", stopReason = "end_turn") =>
      antigravityErrorReplyIn(endedWith(lastChunk, stopReason), harness);
    expect(errorOf("\n⚠ Something is wrong with the request\n")).toBe("⚠ Something is wrong with the request");
    expect(errorOf("\n⚠ bad key\n")).toBe("⚠ bad key");
    expect(errorOf('\n⚠ request failed (code 429): {\n  "error": "Too many requests"\n}\n')).toBe('⚠ request failed (code 429): {\n  "error": "Too many requests"\n}');
    expect(errorOf("\n⚠ bad key\n", "antigravity", "cancelled")).toBeNull();
    expect(errorOf("\n⚠ bad key\n", "antigravity", "max_tokens")).toBeNull();
    expect(errorOf("\n⚠ bad key\n", "claude")).toBeNull();
    expect(errorOf("\n⚠ bad key\n", "opencode")).toBeNull();
    expect(errorOf("Here is a warning:\n⚠ be careful\n")).toBeNull();
    expect(errorOf("⚠ without leading newline\n")).toBeNull();
    expect(errorOf("\n⚠ without trailing newline")).toBeNull();
    expect(errorOf("All done.")).toBeNull();
    expect(errorOf("")).toBeNull();
  });

  test("marks 401 and unauthenticated responses as needing sign-in", () => {
    expect(isAntigravityAuthError("⚠ request failed (code 401): {\"error\":\"bad\"}")).toBe(true);
    expect(isAntigravityAuthError("⚠ request failed with empty body (code 401)")).toBe(true);
    expect(isAntigravityAuthError("⚠ Request had invalid authentication credentials.")).toBe(true);
    expect(isAntigravityAuthError("⚠ Authentication required")).toBe(true);
    expect(isAntigravityAuthError("⚠ Something is wrong with the request")).toBe(false);
    expect(isAntigravityAuthError("⚠ request failed (code 429): Too many requests")).toBe(false);
    expect(isAntigravityAuthError("⚠ Error on line 401 of input")).toBe(false);
  });
});
