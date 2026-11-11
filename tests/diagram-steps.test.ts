import { describe, expect, test } from "bun:test";
import { assetText } from "../host/canvas/assets.ts";
import { canvasInstructions, canvasUseGuidance } from "../host/canvas/guidance.ts";
import { LANGUAGES } from "../shared/i18n/languages.ts";

describe("the step player's script", () => {
  test("parses, and holds its controls in every language", async () => {
    const script = await assetText("/diagram-steps.js");
    expect(() => new Function(script)).not.toThrow();
    for (const language of LANGUAGES) expect(script).toContain(`"${language}":{"back":`);
    expect(script).toContain('"back":"Vissza"');
  });

  test("can sit in a script tag of a saved page", async () => {
    expect(await assetText("/diagram-steps.js")).not.toMatch(/<\/script/i);
  });
});

describe("what agents are told", () => {
  const origin = "http://127.0.0.1:4601";

  test("how to load the player, step by step, from this host's assets", () => {
    const instructions = canvasInstructions(origin);
    expect(instructions).toContain(`<script src="${origin}/diagram-steps.js"></script>`);
    expect(instructions).toContain('class="diagram-steps"');
    expect(instructions).toContain("e1@{ animate: true }");
  });

  test("to use motion only where something moves", () => {
    expect(canvasUseGuidance()).toContain("Keep structure, comparisons and tables still.");
  });
});
