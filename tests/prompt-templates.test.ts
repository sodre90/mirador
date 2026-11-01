import { describe, expect, test } from "bun:test";
import { adjacentPlaceholder, defaultPromptTemplates, filledIn, matchingTemplates, parametersOf, placeholdersIn, promptTemplateProblem } from "../shared/prompt-templates.ts";

describe("prompt templates", () => {
  test("ask for each {{parameter}} once, in the order it first appears, spaces around its name ignored", () => {
    expect(parametersOf("Review {{ Pull request }} against {{Base}}; post on {{Pull request}}. {{}} {single}")).toEqual(["Pull request", "Base"]);
    expect(parametersOf("No parameters")).toEqual([]);
  });

  test("fill every place a parameter is in, and leave text that only looks like one", () => {
    const text = "Review {{ Pull request }} against {{Base}}; post on {{Pull request}}. {{}} {single}";
    expect(filledIn(text, { "Pull request": "https://github.com/o/r/pull/5", Base: "main" })).toBe(
      "Review https://github.com/o/r/pull/5 against main; post on https://github.com/o/r/pull/5. {{}} {single}",
    );
    expect(filledIn(text, {})).toBe("Review  against ; post on . {{}} {single}");
  });

  test("need a name and a text, within their limits", () => {
    expect(promptTemplateProblem({ id: "t", name: "Review", text: "x" })).toBeNull();
    expect(promptTemplateProblem({ id: "t", name: "  ", text: "x" })).toBe("A template needs a name.");
    expect(promptTemplateProblem({ id: "t", name: "Review", text: " \n" })).toBe("A template needs a text.");
    expect(promptTemplateProblem({ id: "", name: "Review", text: "x" })).toBe("A template needs an id.");
    expect(promptTemplateProblem({ id: "t", name: "Review", text: "x".repeat(20_001) })).toMatch(/at most 20000 characters/);
  });

  test("each default asks for what it works on: a pull request, a ticket, or what to explain", () => {
    expect(defaultPromptTemplates.map(({ name, text }) => [name, parametersOf(text)])).toEqual([
      ["Deep PR review", ["Pull request"]],
      ["Start on a ticket", ["Ticket"]],
      ["Code tour", ["What to explain"]],
    ]);
  });
});

describe("filling a template in the message box", () => {
  const text = "Review {{Pull request}} against {{Base}}. {{}}";
  const pullRequest = { start: 7, end: 23 };
  const base = { start: 32, end: 40 };

  test("finds each placeholder still to fill in, and not empty braces", () => {
    expect(placeholdersIn(text)).toEqual([pullRequest, base]);
    expect(text.slice(base.start, base.end)).toBe("{{Base}}");
  });

  test("Tab goes to the next placeholder and ⇧Tab to the one before, coming round at the ends", () => {
    expect(adjacentPlaceholder(text, pullRequest, 1)).toEqual(base);
    expect(adjacentPlaceholder(text, base, 1)).toEqual(pullRequest);
    expect(adjacentPlaceholder(text, base, -1)).toEqual(pullRequest);
    expect(adjacentPlaceholder(text, pullRequest, -1)).toEqual(base);
    expect(adjacentPlaceholder(text, { start: 0, end: 0 }, 1)).toEqual(pullRequest);
  });

  test("Tab goes on from a value just typed in a placeholder's place", () => {
    const typed = "Review #42 against {{Base}}.";
    expect(adjacentPlaceholder(typed, { start: 10, end: 10 }, 1)).toEqual({ start: 19, end: 27 });
    expect(adjacentPlaceholder("Review #42 against main.", { start: 10, end: 10 }, 1)).toBeNull();
  });
});

describe("finding a template by typing", () => {
  const templates = [
    { name: "Deep PR review", text: "Review {{Pull request}} deeply" },
    { name: "Release notes", text: "Write release notes from the review of {{Tag}}" },
    { name: "Explain", text: "Explain how this works" },
  ];
  const names = (query: string) => matchingTemplates(templates, query).map(({ name }) => name);

  test("keeps the templates holding every word, in any case, names matching first", () => {
    expect(names("")).toEqual(["Deep PR review", "Release notes", "Explain"]);
    expect(names("REVIEW")).toEqual(["Deep PR review", "Release notes"]);
    expect(names("notes review")).toEqual(["Release notes"]);
    expect(names("release")).toEqual(["Release notes"]);
    expect(names("works")).toEqual(["Explain"]);
    expect(names("nothing like it")).toEqual([]);
  });
});
