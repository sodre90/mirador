import { answersSummary, questionsOf } from "../../shared/ask.ts";
import type { PluginOffer } from "../../shared/apps.ts";
import type {
  AskAnswerEntry,
  AskItem,
  AskQuestion,
  CanvasAnswer,
  CanvasItem,
  CanvasItemBase,
  ShowItem,
} from "../../shared/model.ts";
import type { ConversationService } from "../conversations.ts";
import type { Hub } from "../hub.ts";
import type { Store } from "../store.ts";
import type { SystemNotifications } from "../system-notifications.ts";
import type { PageLibraries } from "../../shared/canvas-export.ts";
import { standalonePage } from "./export.ts";
import { saveIntoWorkspace } from "./save-to-project.ts";
import { noteOfPageErrors, type CanvasNote } from "./notes.ts";
import { HostProblemError } from "../../shared/host-problems.ts";

const RENDER_REPORT_TIMEOUT_MS = 6000;

export interface ShowRequest {
  title: string;
  html: string;
}

/** One question, or several that the user answers page by page and the agent hears all at once. */
export type AskRequest = AskQuestion | { questions: AskQuestion[] };

export interface RenderReport {
  errors: string[];
}

export type RenderOutcome = RenderReport | "no-viewer";

interface AnswerWaiter {
  answered(answer: Pick<CanvasAnswer, "label" | "note">): void;
  withdrawn(): void;
}

export class CanvasService {
  private readonly answerWaiters = new Map<string, AnswerWaiter>();
  private readonly renderWaiters = new Map<string, (report: RenderReport) => void>();

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly conversations: ConversationService,
    private readonly notifications: SystemNotifications,
    /** Every address the canvas libraries are served at, as a page may name any of them; the first is the one agents were given. */
    private readonly assetsOrigins: string[],
  ) {}

  list(conversationId: string): CanvasItem[] {
    return this.store.listCanvasItems(conversationId);
  }

  async show(conversationId: string, request: ShowRequest): Promise<{ item: CanvasItem; render: RenderOutcome }> {
    const item = this.save({
      id: crypto.randomUUID(),
      conversationId,
      kind: "show",
      title: request.title,
      html: request.html,
      status: "shown",
      createdAt: Date.now(),
    });
    const render = await this.waitForRenderReport(item);
    if (render === "no-viewer") this.awaitFirstView(item.id);
    return { item, render };
  }

  openAsk(conversationId: string, request: AskRequest, { installsPluginOffer }: { installsPluginOffer?: string } = {}): AskItem {
    const shownBefore = this.pagesShownSinceUserSpoke(conversationId).map(({ id }) => id);
    const asked = "questions" in request ? severalQuestionsAsked(request.questions) : singleQuestionAsked(request);
    const item = this.save({
      id: crypto.randomUUID(),
      conversationId,
      kind: "ask",
      ...asked,
      ...(shownBefore.length > 0 && { shownBefore }),
      ...(installsPluginOffer && { installsPluginOffer }),
      status: "waiting",
      createdAt: Date.now(),
    });
    this.notifications.notify(conversationId, { kind: "question", question: item.title });
    return item;
  }

  /** Resolves with the user's answer, or rejects when `signal` aborts first; a later answer then arrives as the next message. */
  waitForAnswer(item: CanvasItem, signal: AbortSignal): Promise<Pick<CanvasAnswer, "label" | "note" | "answers">> {
    return new Promise((resolve, reject) => {
      const stopWaiting = () => {
        this.answerWaiters.delete(item.id);
        reject(signal.reason ?? new Error("aborted"));
      };
      if (signal.aborted) return stopWaiting();
      signal.addEventListener("abort", stopWaiting, { once: true });
      this.answerWaiters.set(item.id, {
        answered: (answer) => {
          signal.removeEventListener("abort", stopWaiting);
          resolve(answer);
        },
        withdrawn: () => {
          signal.removeEventListener("abort", stopWaiting);
          reject(new Error("The user withdrew the question."));
        },
      });
    });
  }

  answer(itemId: string, label: string, note?: string, answers?: AskAnswerEntry[]) {
    const item = this.store.findCanvasItem(itemId);
    if (!item || item.kind !== "ask") throw new HostProblemError({ code: "unknown-question" });
    if (item.status !== "waiting") throw new HostProblemError({ code: "question-already-answered" });
    const given = answersFor(item, label, note, answers);
    const waiter = this.answerWaiters.get(itemId);
    this.answerWaiters.delete(itemId);
    this.save({ ...item, status: "answered", answer: { ...given, deliveredAs: waiter ? "tool-result" : "next-message" } });
    if (waiter) waiter.answered(given);
    else if (item.installsPluginOffer) void this.installThenTell(item, item.installsPluginOffer, given);
    else this.conversations.send(item.conversationId, answerAsMessage(item, given)).catch(() => {});
  }

  private pluginInstaller: PluginInstaller = {
    offer: async () => {
      throw new Error("Mirador can't install plugins here.");
    },
    settle: async () => "Mirador can't install plugins here.",
  };

  /** How an official plugin is offered to the user, and installed once they say so. */
  installsPluginsWith(installer: PluginInstaller) {
    this.pluginInstaller = installer;
  }

  /** Clones the official plugin for the user to see what it brings; nothing of it runs until they answer Install. */
  offerPlugin(name: string): Promise<PluginOffer> {
    return this.pluginInstaller.offer(name);
  }

  private async installThenTell(item: AskItem, offerId: string, given: GivenAnswer) {
    const outcome = await this.pluginInstaller.settle(offerId, given.label === INSTALL_ANSWER);
    await this.conversations.send(item.conversationId, `${answerAsMessage(item, given)}\n${outcome}`).catch(() => {});
  }

  /** What the canvas has for the agent to hear of with the user's next message. */
  notesForAgent(conversationId: string): CanvasNote[] {
    return [this.pageErrorsNote(conversationId)].filter((note) => note !== null);
  }

  /** A page the agent showed, as a file of its own that draws outside Mirador. */
  async exportPage(itemId: string, libraries: PageLibraries) {
    const page = this.store.findCanvasItem(itemId);
    if (page?.kind !== "show" || page.html === undefined) throw new HostProblemError({ code: "only-shown-pages-saved" });
    return { page, html: await standalonePage({ title: page.title, html: page.html }, this.assetsOrigins, libraries) };
  }

  /** Writes the page into the conversation's workspace, at a path inside it; the path it was saved at comes back. The page is built here from its HTML, or comes as a PNG its viewer's frame drew. */
  async saveIntoProject(itemId: string, path: string, replace: boolean, content: PageLibraries | Uint8Array) {
    const page = this.store.findCanvasItem(itemId);
    if (page?.kind !== "show" || page.html === undefined) throw new HostProblemError({ code: "only-shown-pages-saved" });
    const file = typeof content === "string" ? (await this.exportPage(itemId, content)).html : content;
    const workspace = this.store.findWorkspace(this.conversations.get(page.conversationId).workspaceId);
    if (!workspace) throw new HostProblemError({ code: "workspace-gone" });
    return saveIntoWorkspace(workspace.path, path, file, { replace });
  }

  withdrawWaitingAsks(conversationId: string) {
    this.store
      .listCanvasItems(conversationId)
      .filter((item) => item.status === "waiting")
      .forEach((item) => {
        const waiter = this.answerWaiters.get(item.id);
        this.answerWaiters.delete(item.id);
        this.save({ ...item, status: "cancelled" });
        waiter?.withdrawn();
      });
  }

  reportRender(itemId: string, report: RenderReport) {
    const waiter = this.renderWaiters.get(itemId);
    if (waiter) waiter(report);
    else this.keepFirstViewForAgent(itemId, report);
  }

  /** The errors pages shown while nobody viewed them reported when the user first opened them. */
  pageErrorsNote(conversationId: string): CanvasNote | null {
    const pages = this.store.listCanvasItems(conversationId).filter((item): item is ShowItem => item.kind === "show" && (item.errorsForAgent?.length ?? 0) > 0);
    if (pages.length === 0) return null;
    return { text: noteOfPageErrors(pages), heard: () => pages.forEach(({ id }) => this.heardErrorsOf(id)) };
  }

  /** Nobody saw the page render, so its first view's report goes to the agent instead. */
  private awaitFirstView(itemId: string) {
    const latest = this.store.findCanvasItem(itemId);
    if (latest?.kind === "show") this.save({ ...latest, unverified: true });
  }

  private keepFirstViewForAgent(itemId: string, { errors }: RenderReport) {
    const item = this.store.findCanvasItem(itemId);
    if (item?.kind !== "show" || !item.unverified) return;
    const { unverified: _viewed, ...viewed } = item;
    this.save(errors.length > 0 ? { ...viewed, errorsForAgent: errors } : viewed);
  }

  private heardErrorsOf(itemId: string) {
    const latest = this.store.findCanvasItem(itemId);
    if (latest?.kind !== "show") return;
    const { errorsForAgent: _heard, ...heard } = latest;
    this.save(heard);
  }

  private waitForRenderReport(item: CanvasItem): Promise<RenderOutcome> {
    if (!this.hub.isShown(item.conversationId)) return Promise.resolve("no-viewer");
    return new Promise((resolve) => {
      const settle = (outcome: RenderOutcome) => {
        clearTimeout(timer);
        this.renderWaiters.delete(item.id);
        resolve(outcome);
      };
      const timer = setTimeout(() => settle("no-viewer"), RENDER_REPORT_TIMEOUT_MS);
      this.renderWaiters.set(item.id, settle);
    });
  }

  /** A question replaces the page on the canvas, so it carries the pages its turn showed before it. */
  private pagesShownSinceUserSpoke(conversationId: string) {
    const items = this.store.listCanvasItems(conversationId);
    const sinceLastQuestion = items.slice(items.findLastIndex((item) => item.kind === "ask") + 1);
    const userSpokeAt = this.store.lastUserMessageAt(conversationId) ?? 0;
    return sinceLastQuestion.filter((item) => item.kind === "show" && item.createdAt >= userSpokeAt);
  }

  private save<T extends CanvasItem>(change: T): T {
    const item = { ...change, updatedAt: Date.now() };
    this.store.saveCanvasItem(item);
    this.hub.publishToConversation(item.conversationId, { type: "canvas.upserted", item });
    if (item.kind === "ask") this.conversations.questionsChanged(item.conversationId);
    return item;
  }
}

type AskedFields = Pick<CanvasItemBase, "title"> & Partial<Omit<AskItem, keyof CanvasItemBase | "answer" | "shownBefore">>;

const singleQuestionAsked = ({ question, html, options, allowOther, optionWidth }: AskQuestion): AskedFields => ({
  title: question,
  question,
  html,
  options,
  allowOther: allowOther ?? false,
  ...(optionWidth && { optionWidth }),
});

const severalQuestionsAsked = (questions: AskQuestion[]): AskedFields => ({
  title: `${questions.length} questions: ${questions[0]!.question}`,
  question: questions[0]!.question,
  questions,
});

type GivenAnswer = Pick<CanvasAnswer, "label" | "note" | "answers">;

/** What the user sent, checked against what was asked: one answer for a question, one for each of several. */
function answersFor(item: AskItem, label: string, note: string | undefined, answers: AskAnswerEntry[] | undefined): GivenAnswer {
  const questions = questionsOf(item);
  if (!item.questions) {
    if (answers) throw new HostProblemError({ code: "question-takes-one-answer" });
    return { label, note: note?.trim() || undefined };
  }
  if (!answers || answers.length !== questions.length || answers.some((entry) => !entry.label.trim())) {
    throw new HostProblemError({ code: "answer-all-questions", count: questions.length });
  }
  const entries = answers.map(({ label, note }, index) => ({ question: questions[index]!.question, label, note: note?.trim() || undefined }));
  return { label: answersSummary(entries), note: note?.trim() || undefined, answers: entries };
}

const noteLine = (note: string | undefined, prefix: string) => (note ? [`${prefix}${note}`] : []);

export function answerAsToolResult({ label, note, answers }: GivenAnswer) {
  if (answers) {
    const each = answers.flatMap((entry, index) => [`${index + 1}. ${entry.question}`, `   The user chose: ${entry.label}`, ...noteLine(entry.note, "   Their note: ")]);
    return [`The user answered ${answers.length} questions:`, ...each, ...noteLine(note, "Their note on all the answers: ")].join("\n");
  }
  return [`The user chose: ${label}`, ...noteLine(note, "Their note: ")].join("\n");
}

/** The answer to an install question that has Mirador install the plugin. */
export const INSTALL_ANSWER = "Install";

/** Offers an official plugin by its name, then installs or discards the offer once the user answers; `settle` resolves to what came of it, in words for the agent. */
export interface PluginInstaller {
  offer(name: string): Promise<PluginOffer>;
  settle(offerId: string, accepted: boolean): Promise<string>;
}

function answerAsMessage(item: AskItem, { label, note, answers }: GivenAnswer) {
  if (answers) {
    const each = answers.flatMap((entry, index) => [`${index + 1}. "${entry.question}": ${entry.label}`, ...noteLine(entry.note, "   Note: ")]);
    return ["My answers to your questions:", ...each, ...noteLine(note, "Note on all the answers: ")].join("\n");
  }
  return [`My answer to your question "${item.question}": ${label}`, ...noteLine(note, "Note: ")].join("\n");
}
