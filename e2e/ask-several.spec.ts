import { expect, type Locator, test } from "@playwright/test";
import { addWorkspace, answerCanvasQuestion, callCanvasTool, openFromCanvasHistory, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.describe.configure({ mode: "serial" });

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("several questions come one page at a time, can be changed on a review page, and are answered together", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const next = ask.getByRole("button", { name: "Next" });
  const toolResult = callCanvasTool(host, conversationId, "ask", {
    questions: [
      { question: "Which color?", options: [{ label: "Red" }, { label: "Blue" }] },
      { question: "Which size?", options: [{ label: "Small" }, { label: "Large" }], allowOther: true },
    ],
  });

  await expect(ask.getByRole("heading", { name: "Which color?" })).toBeVisible();
  await expect(ask).toContainText("Question 1 of 2");
  await expect(ask.getByRole("button", { name: "Back" })).toBeDisabled();
  await expect(next).toBeDisabled();
  await ask.getByRole("radio", { name: "Red", exact: true }).check();
  await next.click();

  await expect(ask.getByRole("heading", { name: "Which size?" })).toBeVisible();
  await expect(ask).toContainText("Question 2 of 2");
  await expect(ask.getByRole("button", { name: "Submit" })).toHaveCount(0);

  await test.step("leaving the conversation and coming back keeps the page and the answers", async () => {
    await startConversation(page);
    await page.goto(`${host.origin}/#/c/${conversationId}`);
    await expect(ask.getByRole("heading", { name: "Which size?" })).toBeVisible();
    await ask.getByRole("button", { name: "Back" }).click();
    await expect(ask.getByRole("radio", { name: "Red", exact: true })).toBeChecked();
    await next.click();
  });

  await test.step("Shift+Enter starts a new line of your own answer, and Enter goes on to the next page", async () => {
    const ownAnswer = ask.getByRole("textbox", { name: "Your own answer" });
    await ask.getByRole("textbox", { name: /note/i }).fill("fits the wall");
    await ownAnswer.pressSequentially("Huge");
    await ownAnswer.press("Shift+Enter");
    await ownAnswer.pressSequentially("and round");
    await expect(ownAnswer).toHaveValue("Huge\nand round");
    await expect(ownAnswer).toHaveAttribute("rows", "2");
    await ownAnswer.press("Enter");
  });

  await test.step("the review page lists every answer, and Change goes back to its question", async () => {
    await expect(ask).toContainText("Review your answers");
    await expect(ask.locator(".ask-review li")).toHaveText([/Which color\?\s*Red/, /Which size\?\s*Huge\s*and round\s*— “fits the wall”/]);
    expect(await ask.locator(".ask-review strong").last().innerText()).toBe("Huge\nand round");
    await ask.locator(".ask-review li").first().getByRole("button", { name: "Change" }).click();
    await ask.getByRole("radio", { name: "Blue", exact: true }).check();
    await next.click();
    await next.click();
    await expect(ask.locator(".ask-review li").first()).toContainText("Blue");
  });

  await test.step("a note for all the answers is written on the review page and stays there", async () => {
    const closingNote = ask.getByRole("textbox", { name: "Note for the agent on all the answers" });
    await closingNote.fill("Keep it short");
    await ask.locator(".ask-review li").first().getByRole("button", { name: "Change" }).click();
    await next.click();
    await next.click();
    await expect(closingNote).toHaveValue("Keep it short");
    await ask.getByRole("button", { name: "Submit" }).click();
  });

  expect(await toolResult).toBe(
    [
      "The user answered 2 questions:",
      "1. Which color?",
      "   The user chose: Blue",
      "2. Which size?",
      "   The user chose: Huge\nand round",
      "   Their note: fits the wall",
      "Their note on all the answers: Keep it short",
    ].join("\n"),
  );
  await expect(page.locator(".settled-note")).toHaveText("✓ Answer sent: “Blue · Huge and round”");

  await test.step("in the canvas history each question shows with its options and the answer marked, the user's own words and notes too", async () => {
    await openFromCanvasHistory(page, "2 questions: Which color?");
    await expect(ask.locator(".ask-answer")).toContainText("You answered 2 questions");
    await expect(ask.locator(".ask-answer")).toContainText("Note on all the answers: “Keep it short”");
    const questions = ask.locator(".ask-question");
    await expect(questions).toHaveCount(2);
    const [color, size] = [questions.nth(0), questions.nth(1)];
    await expect(color).toContainText("Question 1 of 2");
    await expect(color.getByRole("heading", { name: "Which color?" })).toBeVisible();
    await expect(color.getByRole("radio", { name: "Blue", exact: true })).toBeChecked();
    await expect(color.getByRole("radio", { name: "Blue", exact: true })).toBeDisabled();
    await expect(color.getByRole("radio", { name: "Red", exact: true })).not.toBeChecked();
    await expect(color.locator(".ask-question-note")).toHaveCount(0);
    await expect(size).toContainText("Question 2 of 2");
    await expect(size.getByRole("heading", { name: "Which size?" })).toBeVisible();
    await expect(size.getByRole("radio", { name: "Large" })).not.toBeChecked();
    await expect(size.getByRole("radio", { name: "Your own answer" })).toBeChecked();
    expect(await size.locator(".ask-own-answer-text").innerText()).toBe("Huge\nand round");
    await expect(size.locator(".ask-question-note")).toHaveText("Your note: “fits the wall”");
  });
});

test("your own answer to one question can run over several lines with Shift+Enter, and Enter sends it", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const toolResult = callCanvasTool(host, conversationId, "ask", { question: "What should it say?", options: [{ label: "Hello" }, { label: "Goodbye" }], allowOther: true });
  const ownAnswer = ask.getByRole("textbox", { name: "Your own answer" });

  await test.step("the field takes the row beside its radio button", async () => {
    const row = (await ask.locator(".ask-other").boundingBox())!;
    const field = (await ownAnswer.boundingBox())!;
    expect(field.x - row.x).toBeLessThan(40);
    expect(field.x + field.width).toBeCloseTo(row.x + row.width, 0);
  });

  await ownAnswer.pressSequentially("First line");
  await ownAnswer.press("Shift+Enter");
  await ownAnswer.pressSequentially("Second line");
  await expect(ask.getByRole("radio", { name: "Something else" })).toBeChecked();
  await expect(ownAnswer).toHaveValue("First line\nSecond line");
  await ownAnswer.press("Enter");

  expect(await toolResult).toBe("The user chose: First line\nSecond line");
  await openFromCanvasHistory(page, "What should it say?");
  expect(await ask.locator(".ask-answer strong").innerText()).toBe("First line\nSecond line");
  await expect(ask.getByRole("radio", { name: "Your own answer" })).toBeChecked();
  await expect(ask.getByRole("radio", { name: "Hello" })).not.toBeChecked();
  expect(await ask.locator(".ask-own-answer-text").innerText()).toBe("First line\nSecond line");
});

test("Enter in the note sends the answer with it, and with nothing picked it neither sends nor starts a line", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const toolResult = callCanvasTool(host, conversationId, "ask", { question: "Ship it?", options: [{ label: "Yes" }, { label: "No" }] });
  const note = ask.getByRole("textbox", { name: /note/i });

  await test.step("with no option picked, Enter does nothing to the note and sends nothing", async () => {
    await note.pressSequentially("after the weekend");
    await note.press("Enter");
    await expect(note).toHaveValue("after the weekend");
    await expect(ask.locator(".ask-answer")).toHaveCount(0);
    await expect(page.locator(".ask-submit")).toBeVisible();
  });

  await test.step("Shift+Enter adds a line of the note, and Enter sends the answer with it", async () => {
    await ask.getByRole("radio", { name: "Yes" }).check();
    await note.press("Shift+Enter");
    await note.pressSequentially("with the docs");
    await expect(note).toHaveValue("after the weekend\nwith the docs");
    await note.press("Enter");
  });

  expect(await toolResult).toBe("The user chose: Yes\nTheir note: after the weekend\nwith the docs");
});

test("Enter in the note of one of several questions goes on to the next question", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const toolResult = callCanvasTool(host, conversationId, "ask", {
    questions: [
      { question: "Which color?", options: [{ label: "Red" }, { label: "Blue" }] },
      { question: "Which size?", options: [{ label: "Small" }, { label: "Large" }] },
    ],
  });
  const note = ask.getByRole("textbox", { name: /note/i });

  await ask.getByRole("radio", { name: "Red", exact: true }).check();
  await note.pressSequentially("matches the sofa");
  await note.press("Enter");
  await expect(ask.getByRole("heading", { name: "Which size?" })).toBeVisible();

  await ask.getByRole("radio", { name: "Large" }).check();
  await ask.getByRole("button", { name: "Next" }).click();
  await ask.getByRole("button", { name: "Submit" }).click();
  expect(await toolResult).toBe(
    ["The user answered 2 questions:", "1. Which color?", "   The user chose: Red", "   Their note: matches the sofa", "2. Which size?", "   The user chose: Large"].join("\n"),
  );
});

test("an answer in the canvas bar shows whole up to a cap, past which it is cut, and a long title gives way to it first", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const longAnswers = ["Close it: I have seen it work on the menu bar", "Close it: the wheel scrolls less after a resize", "Keep it open until the owner checks it by hand"];
  const toolResult = callCanvasTool(host, conversationId, "ask", {
    questions: longAnswers.map((answer, index) => ({ question: `Bead ${index + 1}?`, options: [{ label: answer }, { label: "Keep" }] })),
  });
  for (const answer of longAnswers) {
    await ask.getByRole("radio", { name: answer }).check();
    await ask.getByRole("button", { name: "Next" }).click();
  }
  await ask.getByRole("button", { name: "Submit" }).click();
  await toolResult;

  await openFromCanvasHistory(page, "3 questions: Bead 1?");
  const bar = page.locator(".canvas-header");
  const rightEdge = async (locator: Locator) => {
    const box = (await locator.boundingBox())!;
    return box.x + box.width;
  };
  const fullyShown = (locator: Locator) =>
    locator.evaluate((element) => {
      const text = document.createRange();
      text.selectNodeContents(element);
      return text.getBoundingClientRect().width <= element.getBoundingClientRect().width;
    });
  const outcome = bar.locator(".canvas-outcome");
  const everyButtonFits = async () => {
    for (const button of [/History \(/, "More", "Hide"]) {
      expect(await rightEdge(bar.getByRole("button", { name: button }))).toBeLessThanOrEqual(await rightEdge(bar));
    }
  };
  await expect(outcome).toHaveAttribute("title", `→ ${longAnswers.join(" · ")}`);
  await everyButtonFits();
  expect(await fullyShown(bar.locator(".canvas-title"))).toBe(true);
  expect(await fullyShown(outcome), "the long answer is cut at its cap").toBe(false);

  const longTitle = "Multiple MCP servers would work, but there is a lighter route that keeps one canvas server for every agent. Which should I build?";
  const shortAnswer = callCanvasTool(host, conversationId, "ask", { question: longTitle, options: [{ label: "System prompt" }, { label: "Multiple MCP servers" }] });
  await answerCanvasQuestion(page, "System prompt");
  await shortAnswer;
  await openFromCanvasHistory(page, "Multiple MCP servers would work");
  await expect(outcome).toHaveText("→ System prompt");
  await everyButtonFits();
  expect(await fullyShown(outcome), "a short answer shows whole").toBe(true);
  expect(await fullyShown(bar.locator(".canvas-title")), "the long title gives way").toBe(false);
});

test("the ask tool advertises one question or several, tells the agent to ask several with questions, and neither form is required alone", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const response = await fetch(`${host.origin}/mcp/${conversationId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${host.canvasTokenOf(conversationId)}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const body = await response.text();
  const message = JSON.parse(
    body
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice("data: ".length) ?? body,
  );
  const ask = message.result.tools.find(({ name }: { name: string }) => name === "ask");
  expect(Object.keys(ask.inputSchema.properties)).toEqual(expect.arrayContaining(["question", "options", "questions"]));
  expect(ask.inputSchema.required ?? []).toEqual([]);
  expect(ask.inputSchema.properties.questions.items.required).toEqual(expect.arrayContaining(["question", "options"]));
  expect(ask.inputSchema.properties.questions).toMatchObject({ minItems: 2, maxItems: 10 });
  expect(ask.description).toContain("When you have two or more things to ask, pass questions");
  expect(ask.description).toContain("never offer options such as \"Accept all\"");

  expect(await callCanvasTool(host, conversationId, "ask", { question: "Only a question" })).toContain("Give question and options, or questions");
});

test("a call that also fills in a single question's fields, as GPT does, asks the questions, with a page given beside them on the first", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const color = { question: "Which color?", html: "", allowOther: true, optionWidth: 300, options: [{ label: "Red", html: "", recommended: false }, { label: "Blue" }] };
  const toolResult = callCanvasTool(host, conversationId, "ask", {
    ...color,
    html: "<p>The wall is white</p>",
    questions: [color, { question: "Which size?", options: [{ label: "Small" }, { label: "Large" }] }],
  });

  await expect(ask).toContainText("Question 1 of 2");
  await expect(page.locator(".ask-context iframe").contentFrame().getByText("The wall is white")).toBeVisible();
  await ask.getByRole("radio", { name: "Red", exact: true }).check();
  await ask.getByRole("button", { name: "Next" }).click();
  await ask.getByRole("radio", { name: "Large" }).check();
  await ask.getByRole("button", { name: "Next" }).click();
  await ask.getByRole("button", { name: "Submit" }).click();
  expect(await toolResult).toBe(["The user answered 2 questions:", "1. Which color?", "   The user chose: Red", "2. Which size?", "   The user chose: Large"].join("\n"));
});

/** Bun closes a request that goes quiet for longer than its 10 s default, unless the listener says otherwise. */
const LONGER_THAN_BUNS_IDLE_TIMEOUT_MS = 12_000;

test("an answer the user takes their time over still reaches the agent", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const toolResult = callCanvasTool(host, conversationId, "ask", { question: "Ship it?", options: [{ label: "Yes" }, { label: "No" }] });
  await ask.getByRole("radio", { name: "Yes" }).check();
  await page.waitForTimeout(LONGER_THAN_BUNS_IDLE_TIMEOUT_MS);
  await ask.getByRole("button", { name: "Submit" }).click();
  expect(await toolResult).toBe("The user chose: Yes");
});

test("the option the agent recommends shows a Recommended tag, and recommending two where one is picked is refused", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const twoRecommended = { question: "Which?", options: [{ label: "A", recommended: true }, { label: "B", recommended: true }] };
  const refusal = "Recommend at most one option of a question the user picks one option of; only a question with multiple can recommend several.";
  expect(await callCanvasTool(host, conversationId, "ask", twoRecommended)).toBe(refusal);
  expect(await callCanvasTool(host, conversationId, "ask", { questions: [{ ...twoRecommended, multiple: true }, twoRecommended] }), "each question by its own multiple").toBe(refusal);

  const ask = page.locator(".ask");
  const toolResult = callCanvasTool(host, conversationId, "ask", { question: "Which database?", options: [{ label: "SQLite" }, { label: "Postgres", recommended: true }] });
  const options = ask.locator(".ask-option");
  await expect(options.nth(1).locator(".ask-option-recommended")).toHaveText("Recommended");
  await expect(options.nth(0).locator(".ask-option-recommended")).toHaveCount(0);
  await ask.getByRole("radio", { name: "Postgres", exact: true }).check();
  await ask.getByRole("button", { name: "Submit" }).click();
  expect(await toolResult, "the tag isn't part of the answer").toBe("The user chose: Postgres");
});

test("a question that takes several shows checkboxes, and the answer lists every option ticked", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const toolResult = callCanvasTool(host, conversationId, "ask", {
    question: "Which of these apply?",
    options: [{ label: "Red" }, { label: "Blue" }, { label: "Green" }],
    multiple: true,
  });

  await expect(ask.getByRole("radio")).toHaveCount(0);
  await expect(ask.getByText("Tick one or more options to answer")).toBeVisible();
  await expect(ask.getByRole("button", { name: "Submit" })).toBeDisabled();
  await expect(ask.getByRole("checkbox", { name: "Red", exact: true }), "styled as the radio buttons are").toHaveCSS("margin", "0px");
  await ask.getByRole("checkbox", { name: "Green", exact: true }).check();
  await ask.getByRole("checkbox", { name: "Red", exact: true }).check();
  await ask.getByRole("checkbox", { name: "Blue", exact: true }).check();
  await ask.getByRole("checkbox", { name: "Blue", exact: true }).uncheck();
  await ask.getByRole("button", { name: "Submit" }).click();

  expect(await toolResult).toBe('The user chose: "Red", "Green"');
  await openFromCanvasHistory(page, "Which of these apply?");
  await expect(ask.getByRole("checkbox", { name: "Red", exact: true })).toBeChecked();
  await expect(ask.getByRole("checkbox", { name: "Green", exact: true })).toBeChecked();
  await expect(ask.getByRole("checkbox", { name: "Blue", exact: true })).not.toBeChecked();
  await expect(ask.locator(".ask-own-answer")).toHaveCount(0);
});

test("a question that takes several tags every option the agent recommends, alone or among several questions, and ticks none of them by itself", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const tagsOfOptions = ask.locator(".ask-option").locator(".ask-option-head");
  const parts = { question: "Which parts?", multiple: true, options: [{ label: "Host", recommended: true }, { label: "Phone" }, { label: "Website", recommended: true }] };

  await test.step("a question on its own", async () => {
    const toolResult = callCanvasTool(host, conversationId, "ask", parts);
    await expect(tagsOfOptions).toHaveText(["HostRecommended", "Phone", "WebsiteRecommended"]);
    await expect(ask.getByRole("checkbox", { checked: true })).toHaveCount(0);
    await ask.getByRole("checkbox", { name: "Website", exact: true }).check();
    await ask.getByRole("button", { name: "Submit" }).click();
    expect(await toolResult, "the tag isn't part of the answer").toBe('The user chose: "Website"');
  });

  await test.step("one of several questions", async () => {
    const toolResult = callCanvasTool(host, conversationId, "ask", { questions: [parts, { question: "When?", options: [{ label: "Today", recommended: true }, { label: "Tomorrow" }] }] });
    await expect(tagsOfOptions).toHaveText(["HostRecommended", "Phone", "WebsiteRecommended"]);
    await ask.getByRole("checkbox", { name: "Host", exact: true }).check();
    await ask.getByRole("checkbox", { name: "Website", exact: true }).check();
    await ask.getByRole("button", { name: "Next" }).click();
    await expect(tagsOfOptions).toHaveText(["TodayRecommended", "Tomorrow"]);
    await ask.getByRole("radio", { name: "Today", exact: true }).check();
    await ask.getByRole("button", { name: "Next" }).click();
    await ask.getByRole("button", { name: "Submit" }).click();
    expect(await toolResult).toContain('1. Which parts?\n   The user chose: "Host", "Website"');
  });
});

test("a question that takes several keeps the ticked options and your own words apart, whatever punctuation they hold", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const toolResult = callCanvasTool(host, conversationId, "ask", {
    question: "Which fixes?",
    options: [{ label: "Cache" }, { label: "Cache; with a TTL" }, { label: "Neither" }],
    allowOther: true,
    multiple: true,
  });

  await ask.getByRole("checkbox", { name: "Cache; with a TTL", exact: true }).check();
  await ask.getByRole("textbox", { name: "Your own answer" }).fill("Neither; or both");
  await ask.getByRole("button", { name: "Submit" }).click();

  expect(await toolResult).toBe('The user chose: "Cache; with a TTL"\nIn their own words: Neither; or both');
  await openFromCanvasHistory(page, "Which fixes?");
  await expect(ask.getByRole("checkbox", { name: "Cache; with a TTL", exact: true })).toBeChecked();
  await expect(ask.getByRole("checkbox", { name: "Cache", exact: true })).not.toBeChecked();
  await expect(ask.getByRole("checkbox", { name: "Neither", exact: true })).not.toBeChecked();
  await expect(ask.getByRole("checkbox", { name: "Your own answer" })).toBeChecked();
  await expect(ask.locator(".ask-own-answer-text")).toHaveText("Neither; or both");
  await expect(ask.getByRole("radio")).toHaveCount(0);
});

test("your own words beside ticked options, unticked again, stay out of the answer as Tab moves past their field", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const somethingElse = ask.getByRole("checkbox", { name: "Something else" });
  const ownAnswer = ask.getByRole("textbox", { name: "Your own answer" });
  const toolResult = callCanvasTool(host, conversationId, "ask", { question: "Which apply?", options: [{ label: "Red" }, { label: "Blue" }], allowOther: true, multiple: true });

  await ask.getByRole("checkbox", { name: "Red", exact: true }).check();
  await ownAnswer.focus();
  await expect(somethingElse, "moving into the field ticks nothing").not.toBeChecked();
  await ownAnswer.pressSequentially("purple");
  await expect(somethingElse).toBeChecked();
  await ownAnswer.press("Shift+Tab");
  await page.keyboard.press("Space");
  await expect(somethingElse).not.toBeChecked();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(ask.getByRole("textbox", { name: /note/i })).toBeFocused();
  await expect(somethingElse).not.toBeChecked();
  await expect(ask.locator(".ask-selection")).toHaveText("Your answer: Red");
  await ask.getByRole("button", { name: "Submit" }).click();

  expect(await toolResult).toBe('The user chose: "Red"');
});

test("of several questions one can take several, whose answer the review page and the history show beside the others'", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const next = ask.getByRole("button", { name: "Next" });
  const toolResult = callCanvasTool(host, conversationId, "ask", {
    questions: [
      { question: "Which colours?", options: [{ label: "Red" }, { label: "Blue" }, { label: "Green" }], multiple: true },
      { question: "Which size?", options: [{ label: "Small" }, { label: "Large" }] },
    ],
  });

  await expect(next).toBeDisabled();
  await ask.getByRole("checkbox", { name: "Green", exact: true }).check();
  await ask.getByRole("checkbox", { name: "Red", exact: true }).check();
  await ask.getByRole("textbox", { name: /note/i }).fill("bright");
  await next.click();
  await ask.getByRole("radio", { name: "Large", exact: true }).check();
  await next.click();
  await expect(ask.locator(".ask-review")).toContainText("Which colours? Red; Green — “bright”");
  await ask.getByRole("button", { name: "Submit" }).click();

  expect(await toolResult).toBe('The user answered 2 questions:\n1. Which colours?\n   The user chose: "Red", "Green"\n   Their note: bright\n2. Which size?\n   The user chose: Large');
  await openFromCanvasHistory(page, "2 questions: Which colours?");
  await expect(ask.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await expect(ask.getByRole("checkbox", { name: "Blue", exact: true })).not.toBeChecked();
  await expect(ask.getByRole("radio", { name: "Large", exact: true })).toBeChecked();
});

const DISCUSS_RESULT = "The user didn't choose an answer: they want to discuss this question with you first.";
const TALK_IT_OVER = "Talk it over with them in the conversation, and ask again with the ask tool once it is settled, if it still needs a decision.";

test("Discuss closes a single question with nothing picked, sends the note as the user's words, and moves focus to the message box", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const toolResult = callCanvasTool(host, conversationId, "ask", { question: "Which database?", options: [{ label: "Postgres" }, { label: "SQLite" }] });

  await ask.getByRole("textbox", { name: /note/i }).fill("Neither fits: we need to sync offline");
  await ask.getByRole("button", { name: "Discuss" }).click();

  expect(await toolResult).toBe([DISCUSS_RESULT, "Their words: Neither fits: we need to sync offline", TALK_IT_OVER].join("\n"));
  await expect(page.locator(".composer textarea")).toBeFocused();
  await openFromCanvasHistory(page, "Which database?");
  await expect(ask.locator(".ask-answer")).toContainText("You asked to discuss this — “Neither fits: we need to sync offline”");
  await expect(ask.locator(".ask-answer")).not.toContainText("You chose");
  await expect(page.locator(".canvas-outcome").last()).toHaveText("→ Discussing");
});

test("Discuss without a note sends no words", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const toolResult = callCanvasTool(host, conversationId, "ask", { question: "Which cache?", options: [{ label: "Redis" }, { label: "None" }] });
  await page.locator(".ask").getByRole("button", { name: "Discuss" }).click();
  expect(await toolResult).toBe([DISCUSS_RESULT, TALK_IT_OVER].join("\n"));
});

test("Discuss on the first page of several questions closes them all with the note of that page", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const toolResult = callCanvasTool(host, conversationId, "ask", {
    questions: [
      { question: "Which color?", options: [{ label: "Red" }, { label: "Blue" }] },
      { question: "Which size?", options: [{ label: "Small" }, { label: "Large" }] },
    ],
  });

  await ask.getByRole("textbox", { name: /note/i }).fill("Let's talk about the palette");
  await ask.getByRole("button", { name: "Discuss" }).click();

  expect(await toolResult).toBe([DISCUSS_RESULT, "Their words: Let's talk about the palette", TALK_IT_OVER].join("\n"));
  await expect(page.locator(".composer textarea")).toBeFocused();
  await openFromCanvasHistory(page, "2 questions: Which color?");
  await expect(ask.locator(".ask-answer")).toContainText("You asked to discuss this");
});

test("Discuss on the review page sends the note on all the answers", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const toolResult = callCanvasTool(host, conversationId, "ask", {
    questions: [
      { question: "Which color?", options: [{ label: "Red" }, { label: "Blue" }] },
      { question: "Which size?", options: [{ label: "Small" }, { label: "Large" }] },
    ],
  });
  await ask.getByRole("radio", { name: "Red", exact: true }).check();
  await ask.getByRole("button", { name: "Next" }).click();
  await ask.getByRole("radio", { name: "Large", exact: true }).check();
  await ask.getByRole("button", { name: "Next" }).click();
  await ask.getByRole("textbox", { name: "Note for the agent on all the answers" }).fill("Actually, can we rethink both?");
  await ask.getByRole("button", { name: "Discuss" }).click();
  expect(await toolResult).toBe([DISCUSS_RESULT, "Their words: Actually, can we rethink both?", TALK_IT_OVER].join("\n"));
});

test("the Discuss button sits immediately left of Submit", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const toolResult = callCanvasTool(host, conversationId, "ask", { question: "Ship it?", options: [{ label: "Yes" }, { label: "No" }] });
  const discuss = await ask.getByRole("button", { name: "Discuss" }).boundingBox();
  const submit = await ask.getByRole("button", { name: "Submit" }).boundingBox();
  expect(discuss!.x + discuss!.width).toBeLessThanOrEqual(submit!.x);
  expect(submit!.x - (discuss!.x + discuss!.width)).toBeLessThan(40);
  await ask.getByRole("button", { name: "Discuss" }).click();
  await toolResult;
});

test("the Discuss button sits immediately left of Next with several questions, and Submit on the review page", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");
  const toolResult = callCanvasTool(host, conversationId, "ask", {
    questions: [
      { question: "Which color?", options: [{ label: "Red" }, { label: "Blue" }] },
      { question: "Which size?", options: [{ label: "Small" }, { label: "Large" }] },
    ],
  });
  const leftOf = async (right: string) => {
    const discuss = await ask.getByRole("button", { name: "Discuss" }).boundingBox();
    const other = await ask.getByRole("button", { name: right, exact: true }).boundingBox();
    expect(discuss!.x + discuss!.width).toBeLessThanOrEqual(other!.x);
    expect(other!.x - (discuss!.x + discuss!.width)).toBeLessThan(40);
  };
  await leftOf("Next");
  await ask.getByRole("radio", { name: "Red", exact: true }).check();
  await ask.getByRole("button", { name: "Next" }).click();
  await ask.getByRole("radio", { name: "Large", exact: true }).check();
  await ask.getByRole("button", { name: "Next" }).click();
  await leftOf("Submit");
  await ask.getByRole("button", { name: "Discuss" }).click();
  await toolResult;
});
