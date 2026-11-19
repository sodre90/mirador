import { writeFileSync } from "node:fs";
import { test, type Page, type TestInfo } from "@playwright/test";

/** One line for a message the page sent or got, or nothing to leave it out. */
export type DescribeMessage = (message: { type: string } & Record<string, unknown>, direction: "sent" | "got") => string | null | undefined;

interface Conversation {
  id: string;
  status: string;
  waitingFor: string | null;
}

/**
 * What a test's pages and the host said to each other, for flakes the Windows runners leave no Playwright trace of:
 * written to app-trace.txt in a failed test's results, which the Windows workflow keeps beside its error page. Each
 * page's socket and navigations are in it, each conversation's status as it changes, what `describe` picks out of the
 * messages, and the dialogs still open when the test failed.
 */
export class AppTrace {
  private readonly started = Date.now();
  private readonly lines: string[] = [];
  private readonly statuses = new Map<string, string>();
  private readonly pages = new Map<string, Page>();

  constructor(private readonly describe: DescribeMessage = () => null) {}

  record(page: Page, who: string) {
    this.pages.set(who, page);
    page.on("websocket", (socket) => {
      this.add(`${who} socket opening`);
      socket.on("close", () => this.add(`${who} socket closed`));
      socket.on("socketerror", (error) => this.add(`${who} socket error: ${error}`));
      socket.on("framesent", ({ payload }) => this.message(who, "sent", String(payload)));
      socket.on("framereceived", ({ payload }) => this.message(who, "got", String(payload)));
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this.add(`${who} shows ${new URL(frame.url()).hash || "/"}`);
    });
  }

  add(line: string) {
    this.lines.push(`${String(Date.now() - this.started).padStart(6)} ms  ${line}`);
  }

  async keepIfFailed(testInfo: TestInfo) {
    if (testInfo.status === testInfo.expectedStatus) return;
    await Promise.all([...this.pages].map(([who, page]) => this.openDialogsOn(page, who)));
    const tracePath = testInfo.outputPath("app-trace.txt");
    writeFileSync(tracePath, this.lines.join("\n"));
    await testInfo.attach("app-trace", { path: tracePath, contentType: "text/plain" });
  }

  private async openDialogsOn(page: Page, who: string) {
    if (page.isClosed()) return;
    const dialogs = await page.locator("[role=dialog]:visible, [role=alertdialog]:visible").allInnerTexts().catch(() => []);
    dialogs.forEach((text) => this.add(`${who} still shows a dialog: ${text.replace(/\s+/g, " ").trim()}`));
  }

  private message(who: string, direction: "sent" | "got", payload: string) {
    const message = JSON.parse(payload);
    if (message.type === "conversation.upserted") this.conversationStatus(who, message.conversation);
    const described = this.describe(message, direction);
    if (described) this.add(`${who} ${direction} ${described}`);
  }

  private conversationStatus(who: string, { id, status, waitingFor }: Conversation) {
    const state = `${status}, waiting for ${waitingFor}`;
    if (this.statuses.get(`${who} ${id}`) === state) return;
    this.statuses.set(`${who} ${id}`, state);
    this.add(`${who} got ${id}: ${state}`);
  }
}

/** Gives each test of the spec a trace of its page, kept when the test fails; the function returns the running test's. */
export function traceEachTest(describe?: DescribeMessage) {
  let trace = new AppTrace(describe);
  test.beforeEach(async ({ page }) => {
    trace = new AppTrace(describe);
    trace.record(page, "page");
  });
  test.afterEach(async ({}, testInfo) => trace.keepIfFailed(testInfo));
  return () => trace;
}

/** A rewind's and an undo's requests and answers, with why one failed. */
export const describeGoingBack: DescribeMessage = (message) =>
  /^conversation\.(rewind|rewound|revert)/.test(message.type) ? `${message.type}${typeof message.message === "string" ? `: ${message.message}` : ""}` : null;
