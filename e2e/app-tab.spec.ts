import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, reloadFromRestartedHost, sendMessage, signIn, untilFramePainted } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const profileName = "app-tab";

/** An opencode stand-in that is an agent of its own, taking prompts and ending its turns at once. */
function fakeOpencode() {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
}

/** The counter app the unit tests use, installed the way an owner installs a plugin: a folder in Mirador's data folder. */
function installCounterApp() {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "apps", "counter"), join(host.dataDir, "plugins", "counter"), { recursive: true });
}

test.beforeAll(async () => {
  fakeOpencode();
  installCounterApp();
  writeFileSync(join(host.root, "prompts"), "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/**
 * What reached the page around the app's view, written to app-trace.txt in a failed test's results: the host's app messages,
 * every message an app frame posted and which frame it came from, frame loads, media requests and the spec's marks.
 * For the "Show the clip" click that sometimes gets no answer (vcs-3arc).
 */
class AppTrace {
  private readonly started = Date.now();
  private readonly lines: string[] = [];

  async record(page: Page) {
    page.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => this.hostMessage("got", String(payload)));
      socket.on("framesent", ({ payload }) => this.hostMessage("sent", String(payload)));
    });
    page.on("framenavigated", (frame) => this.add(`frame loaded ${frame === page.mainFrame() ? "main" : "child"} ${withoutQuery(frame.url())}`));
    page.on("request", (request) => {
      if (/\/media/.test(request.url())) this.add(`request ${request.method()} ${withoutQuery(request.url())}`);
    });
    await page.exposeFunction("recordAppTrace", (line: string) => this.add(line));
    await page.addInitScript(() => {
      const record = (window as unknown as { recordAppTrace: (line: string) => void }).recordAppTrace;
      if (window !== window.top) {
        window.addEventListener("message", (event) => {
          if (event.data?.kind === "hidden") record(`frame ${location.pathname} told it is hidden`);
        });
        document.addEventListener(
          "pause",
          (event) => {
            const { top, bottom } = (event.target as Element).getBoundingClientRect();
            record(`frame ${location.pathname} media paused, ${top < innerHeight && bottom > 0 ? "in view" : "out of view"}, page ${document.visibilityState}`);
          },
          true,
        );
        return;
      }
      window.addEventListener("message", (event) => {
        const kind = String(event.data?.kind ?? "");
        if (!kind.startsWith("app-") && kind !== "shell-ready") return;
        const frames = [...document.querySelectorAll("iframe")];
        const sender = frames.find((frame) => frame.contentWindow === event.source);
        const where = sender ? `iframe ${frames.indexOf(sender)} of ${frames.length}, ${sender.checkVisibility() ? "visible" : "hidden"}` : "unknown sender";
        record(`frame posted ${kind} from ${where}`);
      });
    });
  }

  async markVisibleView(page: Page, what: string) {
    const where = await page.evaluate(() => {
      const frames = [...document.querySelectorAll("iframe")];
      const shown = frames.filter((frame) => frame.closest(".canvas-frame.app") && frame.checkVisibility());
      return shown.map((frame) => `iframe ${frames.indexOf(frame)} of ${frames.length}`).join(", ") || "no visible app frame";
    });
    const pageLoad = await view(page).locator("#page-load").textContent({ timeout: 1000 }).catch(() => "unknown");
    this.add(`${what} on page ${pageLoad}, app view in ${where}`);
  }

  add(line: string) {
    this.lines.push(`${String(Date.now() - this.started).padStart(6)} ms  ${line}`);
  }

  text() {
    return this.lines.join("\n");
  }

  private hostMessage(direction: string, payload: string) {
    const type = /"type":"([^"]+)"/.exec(payload)?.[1];
    if (!type || !/^(apps?\.|plugins\.)/.test(type)) return;
    const file = /"file":"([^"]+)"/.exec(payload)?.[1];
    this.add(`host ${direction} ${type}${file ? ` ${file}` : ""}`);
  }
}

const withoutQuery = (url: string) => url.split("?")[0]!.replace(/\/media\/[^/]+\//, "/media/<token>/");

let trace = new AppTrace();
test.beforeEach(async ({ page }) => {
  trace = new AppTrace();
  await trace.record(page);
});
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const tracePath = testInfo.outputPath("app-trace.txt");
  writeFileSync(tracePath, trace.text());
  await testInfo.attach("app-trace", { path: tracePath, contentType: "text/plain" });
});

const appToggle = (page: Page) => page.locator(".canvas-header:visible .app-toggle");
const canvasTitle = (page: Page) => page.locator(".canvas-header:visible .canvas-title");
const viewFrame = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.app iframe");
const view = (page: Page) => viewFrame(page).contentFrame();
const counterFile = () => join(host.projectDir, "counter.json");
/** The conversation on screen. */
const current = (page: Page) => new URL(page.url()).hash.slice("#/c/".length);

async function showApp(page: Page) {
  await expect(appToggle(page)).toBeVisible({ timeout: 30_000 });
  if ((await appToggle(page).getAttribute("aria-pressed")) !== "true") await appToggle(page).click();
}

/** Puts the app's tab aside if it is in front, so an opening has somewhere to come forward to. */
async function hideApp(page: Page) {
  await expect(appToggle(page)).toBeVisible({ timeout: 30_000 });
  if ((await appToggle(page).getAttribute("aria-pressed")) === "true") await appToggle(page).click();
  await expect(appToggle(page)).toHaveAttribute("aria-pressed", "false");
}

/** The stub agent offers no model to pick, so this is `startConversation` without that wait. */
async function startConversationWithoutModel(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

async function sendAndWait(page: Page, text: string) {
  await sendMessage(page, text);
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
}

test("the agent opens an app that its changes, your clicks and outside edits all reach live, in each conversation on its own document", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const first = await startConversationWithoutModel(page);
  await sendAndWait(page, "Start");
  let pageLoad = "";
  let second = "";

  await test.step("app_open starts the file and shows the app in its tab", async () => {
    const opened = await callCanvasTool(host, first, "app_open", { app: "counter", file: "counter.json" });
    expect(opened).toContain("Counter is open on counter.json; the user sees it in the canvas.");
    expect(opened).toContain("The count is 0.");
    await expect(appToggle(page)).toHaveText("Counter");
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(canvasTitle(page)).toHaveText("Counter");
    await expect(view(page).locator("#count")).toHaveText("0");
    expect(JSON.parse(readFileSync(counterFile(), "utf8"))).toEqual({ count: 0 });
    pageLoad = (await view(page).locator("#page-load").textContent())!;
  });

  await test.step("the agent's operation reaches the view without reloading it", async () => {
    expect(await callCanvasTool(host, first, "apply", { op: { op: "add", by: 2 } })).toBe("counter.json: Added 2; the count is 2.");
    await expect(view(page).locator("#count")).toHaveText("2");
    await expect(view(page).locator("#last-change")).toHaveText("agent: Added 2; the count is 2.");
    await expect(view(page).locator("#page-load")).toHaveText(pageLoad);
  });

  await test.step("an operation the app refuses changes nothing, and the agent hears why", async () => {
    expect(await callCanvasTool(host, first, "apply", { op: { op: "multiply" } })).toContain('Unknown operation; use { op: "add", by: <number> }.');
    await expect(view(page).locator("#count")).toHaveText("2");
  });

  await test.step("a click in the view is your operation, and the file holds it", async () => {
    await view(page).getByRole("button", { name: "Add one" }).click();
    await expect(view(page).locator("#count")).toHaveText("3");
    await expect(view(page).locator("#last-change")).toHaveText("you: Added 1; the count is 3.");
    expect(JSON.parse(readFileSync(counterFile(), "utf8"))).toEqual({ count: 3 });
  });

  await test.step("an edit of the file outside Mirador shows in the view", async () => {
    writeFileSync(counterFile(), '{ "count": 40 }\n');
    await expect(view(page).locator("#count")).toHaveText("40");
    await expect(view(page).locator("#last-change")).toHaveText("outside: Edited outside Mirador");
    await expect(view(page).locator("#page-load")).toHaveText(pageLoad);
  });

  await test.step("words the view sends go to this conversation's agent, naming the app and its file", async () => {
    await view(page).getByRole("button", { name: "Ask about the count" }).click();
    await expect(page.locator(".canvas-panel:visible .app-sent")).toHaveText("Sent to the agent. The answer comes in the chat.");
    await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
    await expect.poll(() => readFileSync(join(host.root, "prompts"), "utf8")).toContain("About counter.json, open in Counter (app_state reads it, apply changes it):\n\nIs 40 a good count?\n");
    await expect(page.locator(".timeline:visible .message.user").last()).toContainText("Is 40 a good count?");
  });

  await test.step("the view reads a file next to the document, and is refused one outside its folder", async () => {
    writeFileSync(join(host.projectDir, "note.txt"), "Remember the milk\n");
    writeFileSync(join(host.root, "outside.txt"), "not for the view");
    await view(page).getByRole("button", { name: "Read the note" }).click();
    await expect(view(page).locator("#file-text")).toHaveText("Remember the milk");
    await view(page).getByRole("button", { name: "Read the file outside" }).click();
    await expect(view(page).locator("#file-text")).toHaveText("../outside.txt is outside the workspace.");
  });

  await test.step("another conversation of the workspace takes the app up from the one that opened it, and reads every change", async () => {
    second = await startConversationWithoutModel(page);
    await sendAndWait(page, "Start");
    await expect(page.locator(".canvas-header:visible")).toBeVisible();
    await expect(appToggle(page)).toHaveCount(0);
    const state = await callCanvasTool(host, second, "app_state", {});
    await expect(appToggle(page)).toHaveText("Counter");
    await expect(view(page).locator("#count")).toHaveText("40");
    expect(state).toContain("Counter on counter.json was open in another conversation of this workspace, which this conversation took up.");
    expect(state).toContain("The count is 40.");
    expect(state).toContain("1. agent: Added 2; the count is 2.\n2. user: Added 1; the count is 3.\n3. edited outside Mirador: Edited outside Mirador");
  });

  await test.step("a conversation whose agent never used the app shows it once the user adds it from the bar's More menu", async () => {
    const { hash } = new URL(page.url());
    const shownHere = current(page);
    await startConversationWithoutModel(page);
    await sendAndWait(page, "Start");
    await expect(appToggle(page)).toHaveCount(0);
    await page.locator(".canvas-header:visible").getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menu").locator("li").first(), "a menu doesn't start with a line").not.toHaveAttribute("role", "separator");
    await page.getByRole("menuitem", { name: "Show Counter on counter.json" }).click();
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(view(page).locator("#count")).toHaveText("40");
    expect(await callCanvasTool(host, shownHere, "app_state", {})).toContain("Counter on counter.json\n\nThe count is 40.");
    await page.evaluate((back) => (location.hash = back), hash);
    await expect(page).toHaveURL(new RegExp(`${hash}$`));
  });

  await test.step("what the view keeps in localStorage stays in the workspace, through a reload and a restart of the host", async () => {
    await expect(view(page).locator("#same-storage")).toHaveText("localStorage is the app's storage");
    await expect(view(page).locator("#remembered")).toHaveText("nothing remembered");
    await untilFramePainted(page, viewFrame(page));
    await view(page).getByRole("button", { name: "Remember the count" }).click();
    await expect.poll(() => view(page).locator("body").evaluate(() => localStorage.getItem("remembered"))).toBe("the count was 40");
    await expect(async () => {
      await page.reload();
      await showApp(page);
      await expect(view(page).locator("#remembered")).toHaveText("the count was 40", { timeout: 2000 });
    }).toPass();
    await host.restart();
    await reloadFromRestartedHost(page);
    await showApp(page);
    await expect(view(page).locator("#remembered")).toHaveText("the count was 40");
  });

  await test.step("the view streams a video next to the document, and sends the user's words with a frame of it", async () => {
    cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "red-clip.webm"), join(host.projectDir, "clip.webm"));
    await trace.markVisibleView(page, "clicking Show the clip");
    await view(page).getByRole("button", { name: "Show the clip" }).click();
    await expect(view(page).locator("#clip-state")).toHaveText("showing 64×48");
    await view(page).getByRole("button", { name: "Ask about the frame" }).click();
    await expect(view(page).locator("#prompt-state")).toHaveText("sent with the frame");
    const sent = page.locator(".timeline:visible .message.user").last();
    await expect(sent).toContainText("What is in this frame?");
    await expect.poll(() => sent.locator(".message-images img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64);
    await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
  });

  await test.step("the user runs the app's task from the view and sees it end; the agent runs one with app_run, which brings the app forward, and hears its summary", async () => {
    await view(page).getByRole("button", { name: "Count up" }).click();
    await expect(view(page).locator("#task")).toHaveText("count-up done 100% (step 3 of 3): Counted up from 40 to 43.");
    await expect(view(page).locator("#last-change")).toHaveText("you: Added 1; the count is 43.");
    expect(await callCanvasTool(host, first, "app_state", {})).toContain("- count-up: Count up three times");
    await appToggle(page).click();
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "false");
    const shownConversation = new URL(page.url()).hash.slice("#/c/".length);
    expect(await callCanvasTool(host, shownConversation, "app_run", { task: "count-up" })).toBe("Counted up from 43 to 46.");
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(view(page).locator("#last-change")).toHaveText("agent: Added 1; the count is 46.");
    expect(JSON.parse(readFileSync(counterFile(), "utf8"))).toEqual({ count: 46 });
  });

  await test.step("the user stops a task under way; while one runs, the agent and the view can't start another, but the view may ask for the same one again", async () => {
    await view(page).getByRole("button", { name: "Wait" }).click();
    await expect(view(page).locator("#task")).toHaveText("wait running (waiting)");
    expect(await callCanvasTool(host, first, "app_run", { task: "count-up" })).toContain("Wait until stopped is still running");
    const notices = page.locator(".notices .notice");
    await view(page).getByRole("button", { name: "Wait" }).click();
    await view(page).locator("body").evaluate(() => (window as unknown as { mirador: { run(task: string): void } }).mirador.run("sing"));
    await expect(notices).toHaveText(["Counter has no task called sing; its tasks: count-up, sign, write-count, wait, fail."]);
    await notices.click();
    await view(page).getByRole("button", { name: "Count up" }).click();
    await expect(notices).toHaveText(["Wait until stopped is still running; wait for it to end, or stop it in the app."]);
    await notices.click();
    await view(page).getByRole("button", { name: "Stop the task" }).click();
    await expect(view(page).locator("#task")).toHaveText("wait stopped (waiting)");
  });

  await test.step("an agent opening another file moves only its own tab; the conversation beside it keeps its document", async () => {
    const here = current(page);
    const elsewhere = here === first ? second : first;
    const goTo = async (conversationId: string) => {
      await page.evaluate((target) => (location.hash = `#/c/${target}`), conversationId);
      await expect(page).toHaveURL(new RegExp(`#/c/${conversationId}$`));
    };
    await goTo(elsewhere);
    await hideApp(page);
    await goTo(here);
    await showApp(page);
    await expect(view(page).locator("#document-file")).toHaveText("counter.json");
    expect(await callCanvasTool(host, elsewhere, "app_open", { app: "counter", file: "second.json" })).toContain("Counter is open on second.json");
    await expect(view(page).locator("#document-file")).toHaveText("counter.json");
    expect(await callCanvasTool(host, here, "apply", { op: { op: "add", by: 1 } })).toBe("counter.json: Added 1; the count is 47.");
    await expect(view(page).locator("#count")).toHaveText("47");
    await goTo(elsewhere);
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(view(page).locator("#document-file")).toHaveText("second.json");
    await expect(view(page).locator("#count")).toHaveText("0");
    await goTo(here);
    await expect(view(page).locator("#document-file")).toHaveText("counter.json");
  });

  await test.step("the app's tab comes forward when the agent opens the file already open, in that agent's conversation only", async () => {
    const { hash } = new URL(page.url());
    const here = hash.slice("#/c/".length);
    const other = here === first ? second : first;
    const goTo = async (conversationId: string) => {
      await page.evaluate((target) => (location.hash = target), `#/c/${conversationId}`);
      await expect(page).toHaveURL(new RegExp(`#/c/${conversationId}$`));
      await expect(appToggle(page)).toBeVisible();
    };
    const putAside = async () => {
      if ((await appToggle(page).getAttribute("aria-pressed")) === "true") await appToggle(page).click();
      await expect(appToggle(page)).toHaveAttribute("aria-pressed", "false");
    };
    await goTo(other);
    await putAside();
    await goTo(here);
    await putAside();
    expect(await callCanvasTool(host, other, "app_open", { app: "counter", file: "second.json" })).toContain("Counter is open on second.json");
    await goTo(other);
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "true");
    await putAside();
    await goTo(here);
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "false");
    expect(await callCanvasTool(host, here, "app_open", { app: "counter", file: "second.json" })).toContain("Counter is open on second.json");
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "true");
    await goTo(other);
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "false");
    await goTo(here);
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "true");
  });

  await test.step("a canvas the user hid comes back with the app's tab when the agent opens the app again", async () => {
    const { hash } = new URL(page.url());
    await page.locator(".layout-toggles:visible").getByRole("button", { name: "Hide canvas" }).click();
    await expect(page.locator(".canvas-panel:visible")).toHaveCount(0);
    expect(await callCanvasTool(host, hash.slice("#/c/".length), "app_open", { app: "counter", file: "second.json" })).toContain("Counter is open on second.json");
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(view(page).locator("#count")).toHaveText("0");
  });

  await test.step("an app the agent opens while the user is in another conversation is in front when they come back, and gives the other one no tab", async () => {
    await appToggle(page).click();
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "false");
    const { hash } = new URL(page.url());
    const here = current(page);
    await startConversationWithoutModel(page);
    await sendAndWait(page, "Start");
    const away = current(page);
    expect(await callCanvasTool(host, here, "app_open", { app: "counter", file: "third.json" })).toContain("Counter is open on third.json");
    await callCanvasTool(host, away, "show", { title: "A page shown meanwhile", html: "<p>Meanwhile</p>" });
    await expect(appToggle(page)).toHaveCount(0);
    await page.evaluate((back) => (location.hash = back), hash);
    await expect(page).toHaveURL(new RegExp(`${hash}$`));
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(view(page).locator("#count")).toHaveText("0");
  });

  await test.step("a question the agent asks after opening the app while the user is away is in front when they come back, and the app once it is answered", async () => {
    const { hash } = new URL(page.url());
    const here = hash.slice("#/c/".length);
    const elsewhere = here === first ? second : first;
    await page.evaluate((other) => (location.hash = other), `#/c/${elsewhere}`);
    await expect(page).toHaveURL(new RegExp(`#/c/${elsewhere}$`));
    expect(await callCanvasTool(host, here, "app_open", { app: "counter", file: "fourth.json" })).toContain("Counter is open on fourth.json");
    const answer = callCanvasTool(host, here, "ask", { question: "Keep the count?", options: [{ label: "Yes" }, { label: "No" }] });
    await expect(page.locator(".kept-canvas .ask", { hasText: "Keep the count?" }), "the question reached the canvas kept out of sight").toHaveCount(1);
    await page.evaluate((back) => (location.hash = back), hash);
    await expect(page).toHaveURL(new RegExp(`${hash}$`));
    const question = page.locator(".canvas-panel:visible .ask");
    await expect(question).toContainText("Keep the count?");
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "false");
    await question.getByRole("radio", { name: "Yes" }).check();
    await question.getByRole("button", { name: "Submit" }).click();
    expect(await answer).toBe("The user chose: Yes");
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(view(page).locator("#count")).toHaveText("0");
  });

  await test.step("going to another conversation and back finds the app's page as it was, its video paused while out of sight", async () => {
    const { hash } = new URL(page.url());
    const elsewhere = hash.endsWith(first) ? second : first;
    const loaded = (await view(page).locator("#page-load").textContent())!;
    await trace.markVisibleView(page, "clicking Show the clip");
    await view(page).getByRole("button", { name: "Show the clip" }).click();
    await expect(view(page).locator("#clip-state")).toHaveText("showing 64×48");
    const clip = view(page).locator("#clip");
    await clip.evaluate((video: HTMLVideoElement) => {
      video.loop = true;
      return video.play();
    });
    await expect.poll(() => clip.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
    await page.evaluate((other) => (location.hash = other), `#/c/${elsewhere}`);
    await expect(page).toHaveURL(new RegExp(`#/c/${elsewhere}$`));
    await expect(appToggle(page)).toBeVisible();
    await page.evaluate((back) => (location.hash = back), hash);
    await expect(page).toHaveURL(new RegExp(`${hash}$`));
    await expect(view(page).locator("#page-load")).toHaveText(loaded);
    await expect(view(page).locator("#clip-state")).toHaveText("showing 64×48");
    expect(await clip.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  });

  await test.step("a view kept behind another conversation still gets the changes of the document the two share", async () => {
    const { hash } = new URL(page.url());
    const here = current(page);
    const elsewhere = here === first ? second : first;
    expect(await callCanvasTool(host, here, "app_open", { app: "counter", file: "shared.json" })).toContain("Counter is open on shared.json");
    expect(await callCanvasTool(host, elsewhere, "app_open", { app: "counter", file: "shared.json" })).toContain("Counter is open on shared.json");
    const loaded = (await view(page).locator("#page-load").textContent())!;
    await page.evaluate((other) => (location.hash = other), `#/c/${elsewhere}`);
    await showApp(page);
    await expect(view(page).locator("#count")).toHaveText("0");
    await appToggle(page).click();
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "false");
    expect(await callCanvasTool(host, here, "apply", { op: { op: "add", by: 5 } })).toBe("shared.json: Added 5; the count is 5.");
    await page.evaluate((back) => (location.hash = back), hash);
    await expect(view(page).locator("#count")).toHaveText("5");
    await expect(view(page).locator("#page-load")).toHaveText(loaded);
    await page.locator(".canvas-header:visible").getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menuitem", { name: "Show Counter on shared.json" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  await test.step("hiding the canvas pane and showing it again finds the app's page as it was, its video paused while hidden", async () => {
    const loaded = (await view(page).locator("#page-load").textContent())!;
    await trace.markVisibleView(page, "clicking Show the clip");
    await view(page).getByRole("button", { name: "Show the clip" }).click();
    const clip = view(page).locator("#clip");
    await expect(view(page).locator("#clip-state")).toHaveText("showing 64×48");
    await clip.evaluate((video: HTMLVideoElement) => {
      video.loop = true;
      return video.play();
    });
    await expect.poll(() => clip.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
    await page.locator(".layout-toggles:visible").getByRole("button", { name: "Hide canvas" }).click();
    await expect(page.locator(".canvas-panel:visible")).toHaveCount(0);
    await page.locator(".layout-toggles:visible").getByRole("button", { name: "Show canvas" }).click();
    await expect(view(page).locator("#page-load")).toHaveText(loaded);
    expect(await clip.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  });

  await test.step("the app's view built again shows at once, on the document as it is, without a restart of the host", async () => {
    const loaded = (await view(page).locator("#page-load").textContent())!;
    const count = (await view(page).locator("#count").textContent())!;
    appendFileSync(join(host.dataDir, "plugins", "counter", "view.js"), '\ndocument.body.insertAdjacentHTML("beforeend", "<p id=\\"rebuilt\\">built again</p>");\n');
    await expect(view(page).locator("#rebuilt")).toHaveText("built again");
    await expect(view(page).locator("#page-load")).not.toHaveText(loaded);
    await expect(view(page).locator("#count")).toHaveText(count);
  });

  await test.step("app_open on a file the app edits starts the app's document beside it, for that file", async () => {
    const here = current(page);
    writeFileSync(join(host.projectDir, "week.tally"), "");
    const opened = await callCanvasTool(host, here, "app_open", { app: "counter", file: "week.tally" });
    expect(opened).toContain("Counter is open on week.json, the document for week.tally; the user sees it in the canvas.");
    expect(opened).toContain("The count is 0. Started for week.tally.");
    expect(JSON.parse(readFileSync(join(host.projectDir, "week.json"), "utf8"))).toEqual({ count: 0, startedFor: "week.tally" });
    await expect(view(page).locator("#count")).toHaveText("0");
  });

  await test.step("app_open refuses a file through a link that leads out of the workspace, and the view stays where it was", async () => {
    const here = current(page);
    const outside = mkdtempSync(join(tmpdir(), "app-tab-outside-"));
    writeFileSync(join(outside, "secret.json"), '{ "count": 41 }\n');
    symlinkSync(outside, join(host.projectDir, "linked"));
    expect(await callCanvasTool(host, here, "app_open", { app: "counter", file: "linked/secret.json" })).toContain("linked/secret.json is outside the workspace");
    expect(await callCanvasTool(host, here, "app_open", { app: "counter", file: "linked/new.json" })).toContain("linked/new.json is outside the workspace");
    expect(readdirSync(outside)).toEqual(["secret.json"]);
    await expect(view(page).locator("#count")).toHaveText("0");
  });

  await test.step("the view lists the workspace's files and opens another of them, which brings the tab forward in no other conversation", async () => {
    const { hash } = new URL(page.url());
    const elsewhere = hash.endsWith(first) ? second : first;
    await page.evaluate((other) => (location.hash = other), `#/c/${elsewhere}`);
    await showApp(page);
    const keptElsewhere = await view(page).locator("#document-file").textContent();
    await hideApp(page);
    await page.evaluate((back) => (location.hash = back), hash);
    await expect(view(page).locator("#document-file")).toHaveText("week.json");
    mkdirSync(join(host.projectDir, "plans"), { recursive: true });
    writeFileSync(join(host.projectDir, "plans", "week.json"), '{ "count": 7 }\n');
    await view(page).getByRole("button", { name: "List files" }).click();
    await expect(view(page).locator("#file-list")).toContainText("plans/week.json");
    await expect(view(page).locator("#file-list")).toContainText("counter.json");
    const filesHeard = Number(await view(page).locator("#files-heard").textContent());
    await view(page).getByLabel("File to open").fill("plans/week.json");
    await view(page).getByRole("button", { name: "Open", exact: true }).click();
    await expect(view(page).locator("#open-result")).toHaveText("opened");
    await expect(view(page).locator("#count")).toHaveText("7");
    await expect(view(page).locator("#document-file")).toHaveText("plans/week.json");
    await expect(view(page).locator("#files-heard")).toHaveText(String(filesHeard + 1));
    expect(await callCanvasTool(host, current(page), "apply", { op: { op: "add", by: 1 } })).toBe("plans/week.json: Added 1; the count is 8.");
    await page.evaluate((other) => (location.hash = other), `#/c/${elsewhere}`);
    await expect(appToggle(page)).toHaveAttribute("aria-pressed", "false");
    await showApp(page);
    await expect(view(page).locator("#document-file")).toHaveText(keptElsewhere!);
    await page.evaluate((back) => (location.hash = back), hash);
  });

  await test.step("the view may not open a file outside the workspace, or one that doesn't exist, or another file while a task runs", async () => {
    const opening = async (file: string) => {
      await view(page).getByLabel("File to open").fill(file);
      await view(page).getByRole("button", { name: "Open", exact: true }).click();
      return view(page).locator("#open-result");
    };
    await expect(await opening("../outside.json")).toHaveText(/^\.\.\/outside\.json is outside the workspace/);
    await expect(await opening("plans/missing.json")).toHaveText("plans/missing.json doesn't exist.");
    expect(existsSync(join(host.projectDir, "plans", "missing.json"))).toBe(false);
    await view(page).getByRole("button", { name: "Wait" }).click();
    await expect(view(page).locator("#task")).toHaveText(/^wait running/);
    await expect(await opening("counter.json")).toHaveText("Wait until stopped is still running; wait for it to end, or stop it, before opening another file.");
    await expect(view(page).locator("#task")).toHaveText(/^wait running/);
    const filesHeard = Number(await view(page).locator("#files-heard").textContent());
    await view(page).getByRole("button", { name: "Stop the task" }).click();
    await expect(view(page).locator("#task")).toHaveText("wait stopped (waiting)");
    await expect(view(page).locator("#files-heard")).toHaveText(String(filesHeard + 1));
    await expect(view(page).locator("#document-file")).toHaveText("plans/week.json");
  });

  await test.step("from a document in a subfolder, the view reads a file up in the workspace", async () => {
    writeFileSync(join(host.projectDir, "root-note.txt"), "Kept at the root\n");
    await view(page).getByRole("button", { name: "Read up from the document" }).click();
    await expect(view(page).locator("#file-text")).toHaveText("Kept at the root");
  });

  await test.step("an agent's turn tells the view that the workspace's files may have changed", async () => {
    const filesHeard = Number(await view(page).locator("#files-heard").textContent());
    await sendAndWait(page, "Start");
    await expect(view(page).locator("#files-heard")).toHaveText(String(filesHeard + 1));
  });

  await test.step("a phone from before each conversation had a document of its own, naming only the workspace and app, sees and changes the document shown last", async () => {
    await callCanvasTool(host, first, "app_open", { app: "counter", file: "older-phone.json" });
    const heard = await page.evaluate(
      () =>
        new Promise<{ file: string; count: number }[]>((resolve) => {
          const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
          const states: { file: string; count: number }[] = [];
          let named = { workspaceId: "", app: "" };
          socket.onmessage = ({ data }) => {
            const message = JSON.parse(String(data));
            if (message.type === "snapshot") {
              const { workspaceId, app } = message.openApps.find((open: { file: string }) => open.file === "older-phone.json");
              named = { workspaceId, app };
              socket.send(JSON.stringify({ type: "app.subscribe", ...named }));
            }
            if (message.type !== "app.state") return;
            states.push({ file: message.state.file, count: message.state.document.count });
            if (states.length === 1) socket.send(JSON.stringify({ type: "app.apply", ...named, op: { op: "add", by: 1 } }));
            if (message.state.document.count === 1) {
              socket.send(JSON.stringify({ type: "app.unsubscribe", ...named }));
              socket.close();
              resolve([states[0]!, states.at(-1)!]);
            }
          };
        }),
    );
    expect(heard).toEqual([
      { file: "older-phone.json", count: 0 },
      { file: "older-phone.json", count: 1 },
    ]);
    expect(JSON.parse(readFileSync(join(host.projectDir, "older-phone.json"), "utf8"))).toEqual({ count: 1 });
  });

  await test.step("the view reads the workspace's git refs, a file as it was at a tag and the files changed since, and hears a commit", async () => {
    await view(page).getByRole("button", { name: "Read git refs" }).click();
    await expect(view(page).locator("#git-refs")).toHaveText("not a repository");
    // Without the developer's own git config, whose signing or hooks would make this step about them.
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", host.projectDir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], {
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
      }).trim();
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "base");
    git("tag", "-a", "v1", "-m", "first");
    await view(page).getByRole("button", { name: "Read git refs" }).click();
    await expect(view(page).locator("#git-refs")).toHaveText(`HEAD ${git("rev-parse", "--short=7", "HEAD")}; tags: v1`);
    writeFileSync(join(host.projectDir, "root-note.txt"), "Changed since the tag\n");
    await view(page).getByLabel("Git ref").fill("v1");
    await view(page).getByLabel("Path at the ref").fill("root-note.txt");
    await view(page).getByRole("button", { name: "Read at the ref" }).click();
    await expect(view(page).locator("#file-at")).toHaveText("Kept at the root");
    await view(page).getByLabel("Path at the ref").fill("not-yet.txt");
    await view(page).getByRole("button", { name: "Read at the ref" }).click();
    await expect(view(page).locator("#file-at")).toHaveText("not there");
    await view(page).getByLabel("Path at the ref").fill("../outside.txt");
    await view(page).getByRole("button", { name: "Read at the ref" }).click();
    await expect(view(page).locator("#file-at")).toHaveText("../outside.txt is outside the workspace.");
    await view(page).getByRole("button", { name: "Changed since the ref" }).click();
    await expect(view(page).locator("#changed")).toHaveText("root-note.txt");
    await view(page).getByLabel("Git ref").fill("--output=x");
    await view(page).getByRole("button", { name: "Changed since the ref" }).click();
    await expect(view(page).locator("#changed")).toHaveText("--output=x isn't a git ref a view may name.");
    const gitHeard = Number(await view(page).locator("#git-heard").textContent());
    git("commit", "-qam", "note");
    await expect(view(page).locator("#git-heard")).toHaveText(String(gitHeard + 1));
  });
});
