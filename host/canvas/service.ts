import { answersSummary, askPageName, pagesOnOpening, questionsOf, type AskPage } from "../../shared/ask.ts";
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
import { OpeningPages } from "./opening-pages.ts";
import { HostProblemError } from "../../shared/host-problems.ts";
import { workingCopyOf } from "../worktrees.ts";

const RENDER_REPORT_TIMEOUT_MS = 6000;

export interface ShowRequest {
  title: string;
  html: string;
}

/** One question, or several that the user answers page by page and the agent hears all at once. */
export type AskRequest = AskQuestion | { questions: AskQuestion[] };

/**
 * GPT models fill in every field a tool takes, so a call with questions can also carry a single question's fields
 * beside them; the questions win. A context page given only beside them goes to the first question, so it isn't lost.
 */
export function severalQuestionsRequest(questions: AskQuestion[], htmlBesideThem: string | undefined): AskRequest {
  const [first, ...rest] = questions;
  const firstTakesHtml = first !== undefined && !first.html && !!htmlBesideThem;
  return { questions: firstTakesHtml ? [{ ...first, html: htmlBesideThem }, ...rest] : questions };
}

export interface RenderReport {
  errors: string[];
}

/** How a page rendered, or why that is not known: nobody is viewing it, or the page took too long to say. */
export type RenderOutcome = RenderReport | "no-viewer" | "no-report";

/** Why a tool call stopped waiting for its question's answer, whose answer then goes as the user's next message. */
export type AnswerWaitGivenUp = "turn-ended" | "time-up" | { pageErrors: string[] };

const hasErrorsForAgent = (item: CanvasItem): item is ShowItem | AskItem => item.kind !== "plugin" && item.status !== "cancelled" && (item.errorsForAgent?.length ?? 0) > 0;

interface AnswerWaiter {
  answered(answer: Pick<CanvasAnswer, "label" | "note">): void;
  withdrawn(): void;
}

export class CanvasService {
  private readonly answerWaiters = new Map<string, AnswerWaiter>();
  private readonly askingTurns = new Map<string, { conversationId: string; turnEnded: AbortController }>();
  private readonly renderWaiters = new Map<string, (report: RenderReport) => void>();
  private readonly openingPages = new Map<string, OpeningPages>();
  private readonly brokenAsksOfTurn = new Map<string, string[]>();

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
    if (render === "no-viewer" || render === "no-report") this.awaitFirstView(item.id);
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

  /** A page from the history of a session Mirador continues, back on its canvas as it was shown. */
  restorePage(conversationId: string, request: ShowRequest): ShowItem {
    return this.save({ ...this.restoredBase(conversationId), kind: "show", title: request.title, html: request.html, status: "shown" });
  }

  /** A question from the history of a session Mirador continues, with the answer the history holds; one it holds none for is closed. */
  restoreAsk(conversationId: string, request: AskRequest, { shownBefore, toolResult, nextUserMessage }: PastAsk): AskItem {
    const asked: AskItem = {
      ...this.restoredBase(conversationId),
      kind: "ask",
      ...("questions" in request ? severalQuestionsAsked(request.questions) : singleQuestionAsked(request)),
      ...(shownBefore.length > 0 && { shownBefore }),
      status: "cancelled",
    };
    const answer = pastAnswerOf(asked, toolResult, nextUserMessage);
    return this.save(answer ? { ...asked, status: "answered", answer } : asked);
  }

  /**
   * Another conversation's items, as they were, on this one's canvas: under their own ids for the conversation that
   * continues theirs, under new ones for a fork. A question still waiting there waits for no one here.
   */
  restoreItems(conversationId: string, items: CanvasItem[], { sameIds }: { sameIds: boolean }) {
    const idOf = new Map(items.map(({ id }) => [id, sameIds ? id : crypto.randomUUID()]));
    items.forEach((item) => {
      const moved = { ...item, id: idOf.get(item.id)!, conversationId };
      if (moved.kind === "ask" && moved.shownBefore) moved.shownBefore = moved.shownBefore.map((id) => idOf.get(id) ?? id);
      this.save(moved.status === "waiting" ? { ...moved, status: "cancelled" } : moved);
    });
  }

  private lastRestoredAt = 0;

  /** Restored items keep the order the agent made them in, however fast they are saved. */
  private restoredBase(conversationId: string) {
    this.lastRestoredAt = Math.max(Date.now(), this.lastRestoredAt + 1);
    return { id: crypto.randomUUID(), conversationId, createdAt: this.lastRestoredAt };
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

  /**
   * The answer, or why the wait gave up first: the pages the question opens with are broken, the turn that asked ended,
   * or `limitMs` passed. The question stays open, and an answer given later goes to the agent as the user's next message.
   */
  async waitForAnswerDuringTurn(
    item: AskItem,
    signal: AbortSignal,
    limitMs: number | null = null,
  ): Promise<Pick<CanvasAnswer, "label" | "note" | "answers"> | AnswerWaitGivenUp> {
    const turnEnded = new AbortController();
    const pagesBroke = new AbortController();
    this.askingTurns.set(item.id, { conversationId: item.conversationId, turnEnded });
    const timeUp = limitMs === null ? [] : [AbortSignal.timeout(limitMs)];
    this.hearOpeningPages(item, (errors) => {
      if (errors.length > 0) pagesBroke.abort();
    });
    try {
      return await this.waitForAnswer(item, AbortSignal.any([signal, turnEnded.signal, pagesBroke.signal, ...timeUp]));
    } catch (error) {
      if (signal.aborted) throw error;
      if (pagesBroke.signal.aborted) return { pageErrors: this.tellOfBrokenPages(item) };
      if (turnEnded.signal.aborted) return "turn-ended";
      if (timeUp.some((time) => time.aborted)) return "time-up";
      throw error;
    } finally {
      this.askingTurns.delete(item.id);
      this.stopHearingOpeningPages(item);
    }
  }

  /** The errors the pages a question opens with report to someone viewing it, for an agent that doesn't wait for the answer. */
  async errorsOfOpeningPages(item: AskItem): Promise<string[]> {
    if (pagesOnOpening(item).length === 0 || !this.hub.isShown(item.conversationId)) return [];
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, RENDER_REPORT_TIMEOUT_MS);
      this.hearOpeningPages(item, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (this.store.findCanvasItem(item.id)?.status === "waiting") return this.tellOfBrokenPages(item);
    this.stopHearingOpeningPages(item);
    return [];
  }

  /** An agent that asks again in the turn it heard a question's pages are broken has fixed them: the new question takes the broken one's place. */
  takeBackBrokenAsks(conversationId: string) {
    this.brokenAsksOfTurn.get(conversationId)?.forEach((itemId) => this.cancelAsk(itemId));
    this.brokenAsksOfTurn.delete(conversationId);
  }

  /** The errors a question's pages reported that the agent has not heard of, for the tool result that tells it of them. */
  takeAskErrors(itemId: string): string[] {
    const item = this.store.findCanvasItem(itemId);
    if (item?.kind !== "ask" || !item.errorsForAgent) return [];
    this.heardErrorsOf(itemId);
    return item.errorsForAgent;
  }

  /**
   * A turn can end while a tool call of its own still waits on a question: Codex's code mode hands the model back the
   * script running the ask after 30 s, and the model may end its turn there. Nobody would read that tool call's answer.
   */
  turnEnded(conversationId: string) {
    this.brokenAsksOfTurn.delete(conversationId);
    this.askingTurns.forEach(({ conversationId: askedIn, turnEnded }) => {
      if (askedIn === conversationId) turnEnded.abort();
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
    await this.conversations.send(item.conversationId, `${outcome}\n\n${answerAsMessage(item, given)}`).catch(() => {});
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
    const conversation = this.conversations.get(page.conversationId);
    const workspace = this.store.findWorkspace(conversation.workspaceId);
    if (!workspace) throw new HostProblemError({ code: "workspace-gone" });
    return saveIntoWorkspace(workingCopyOf(workspace, conversation).path, path, file, { replace });
  }

  /** Takes back a question no one waits for any more, so that a late answer doesn't arrive as a message. */
  cancelAsk(itemId: string) {
    const item = this.store.findCanvasItem(itemId);
    if (item?.status !== "waiting") return;
    this.answerWaiters.delete(itemId);
    this.save({ ...item, status: "cancelled" });
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

  /** How one of a question's pages rendered; a question no longer open has nothing left to fix. */
  reportAskPage(itemId: string, page: AskPage, report: RenderReport) {
    const item = this.store.findCanvasItem(itemId);
    if (item?.kind !== "ask" || item.status !== "waiting") return;
    const errors = report.errors.map((error) => `${askPageName(item, page)}: ${error}`);
    if (!this.openingPages.get(itemId)?.take(page, errors)) this.keepAskErrors(itemId, errors);
  }

  /** The errors of pages that reported after the agent's call had returned, and of questions still open. */
  pageErrorsNote(conversationId: string): CanvasNote | null {
    const items = this.store.listCanvasItems(conversationId).filter(hasErrorsForAgent);
    if (items.length === 0) return null;
    return { text: noteOfPageErrors(items), heard: () => items.forEach(({ id }) => this.heardErrorsOf(id)) };
  }

  private hearOpeningPages(item: AskItem, allReported: (errors: string[]) => void) {
    const pages = pagesOnOpening(item);
    if (pages.length > 0) this.openingPages.set(item.id, new OpeningPages(pages, allReported));
  }

  private stopHearingOpeningPages({ id }: AskItem) {
    this.keepAskErrors(id, this.openingPages.get(id)?.errors ?? []);
    this.openingPages.delete(id);
  }

  private tellOfBrokenPages(item: AskItem) {
    this.stopHearingOpeningPages(item);
    const errors = this.takeAskErrors(item.id);
    if (errors.length > 0) this.brokenAsksOfTurn.set(item.conversationId, [...(this.brokenAsksOfTurn.get(item.conversationId) ?? []), item.id]);
    return errors;
  }

  /** Each view of a question reports its pages' errors again, so only new ones are kept. */
  private keepAskErrors(itemId: string, errors: string[]) {
    const item = this.store.findCanvasItem(itemId);
    if (item?.kind !== "ask") return;
    const { errorsForAgent = [], errorsHeard = [] } = item;
    const newErrors = errors.filter((error) => ![...errorsForAgent, ...errorsHeard].includes(error));
    if (newErrors.length > 0) this.save({ ...item, errorsForAgent: [...errorsForAgent, ...newErrors] });
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
    if (!latest || latest.kind === "plugin") return;
    const { errorsForAgent = [], ...heard } = latest;
    this.save(heard.kind === "ask" ? { ...heard, errorsHeard: [...(heard.errorsHeard ?? []), ...errorsForAgent] } : heard);
  }

  private waitForRenderReport(item: CanvasItem): Promise<RenderOutcome> {
    if (!this.hub.isShown(item.conversationId)) return Promise.resolve("no-viewer");
    return new Promise((resolve) => {
      const settle = (outcome: RenderOutcome) => {
        clearTimeout(timer);
        this.renderWaiters.delete(item.id);
        resolve(outcome);
      };
      const timer = setTimeout(() => settle("no-report"), RENDER_REPORT_TIMEOUT_MS);
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

/** A question as a session's history has it: the pages shown with it, what the tool returned, and what the user wrote next. */
export interface PastAsk {
  shownBefore: string[];
  toolResult: string;
  nextUserMessage: string | null;
}

interface ReadAnswer {
  entries: AskAnswerEntry[];
  note?: string;
}

/** The answer `answerAsToolResult` or `answerAsMessage` wrote for the question, read back; null when neither holds one. */
export function pastAnswerOf(item: AskItem, toolResult: string, nextUserMessage: string | null): CanvasAnswer | null {
  const questions = questionsOf(item);
  const questionLine = (index: number) => new RegExp(`^${index + 1}\\. ${escapeRegExp(questions[index]?.question.split("\n")[0] ?? "")}`);
  const fromToolResult = readAnswer(toolResult, {
    chosenLine: () => /^\s*The user chose: (.*)$/,
    noteLine: /^\s*Their note: (.*)$/,
    overallNoteLine: /^Their note on all the answers: (.*)$/,
    ...(item.questions && { questionLine }),
  });
  const answerLinePrefix = (index: number) =>
    item.questions ? `${index + 1}. "${questions[index]?.question}": ` : `My answer to your question "${item.question}": `;
  const fromNextMessage =
    nextUserMessage === null
      ? null
      : readAnswer(nextUserMessage, {
          chosenLine: (index) => new RegExp(`^${escapeRegExp(answerLinePrefix(index))}(.*)$`),
          noteLine: /^\s*Note: (.*)$/,
          overallNoteLine: /^Note on all the answers: (.*)$/,
        });
  const read = [
    { answer: fromToolResult, deliveredAs: "tool-result" as const },
    { answer: fromNextMessage, deliveredAs: "next-message" as const },
  ].find(({ answer }) => answer?.entries.length === questions.length);
  if (!read?.answer) return null;
  const { entries, note } = read.answer;
  if (!item.questions) return { label: entries[0]!.label, ...(entries[0]!.note && { note: entries[0]!.note }), deliveredAs: read.deliveredAs };
  const answers = entries.map((entry, index) => ({ ...entry, question: questions[index]!.question }));
  return { label: answersSummary(answers), ...(note && { note }), answers, deliveredAs: read.deliveredAs };
}

interface AnswerFormat {
  chosenLine: (index: number) => RegExp;
  noteLine: RegExp;
  overallNoteLine: RegExp;
  /** The line that names a question before its answer, where the format has one. */
  questionLine?: (index: number) => RegExp;
}

function readAnswer(text: string, { chosenLine, noteLine, overallNoteLine, questionLine }: AnswerFormat): ReadAnswer {
  const read: ReadAnswer = { entries: [] };
  const fields: { lines: string[]; store: (text: string) => void }[] = [];
  const startField = (firstLine: string, store: (text: string) => void) => {
    const lines = [firstLine];
    fields.push({ lines, store });
    return lines;
  };
  let openLines: string[] | null = null;
  for (const line of text.split("\n")) {
    const chosen = chosenLine(read.entries.length).exec(line)?.[1];
    const overallNote = overallNoteLine.exec(line)?.[1];
    const note = noteLine.exec(line)?.[1];
    const latest = read.entries.at(-1);
    if (chosen !== undefined) {
      const entry: AskAnswerEntry = { label: chosen };
      read.entries.push(entry);
      openLines = startField(chosen, (label) => (entry.label = label));
    } else if (overallNote !== undefined) {
      openLines = startField(overallNote, (written) => (read.note = written));
    } else if (note !== undefined && latest) {
      openLines = startField(note, (written) => (latest.note = written));
    } else if (questionLine?.(read.entries.length).test(line)) {
      openLines = null;
    } else {
      openLines?.push(line);
    }
  }
  fields.forEach(({ lines, store }) => {
    while (lines.length > 1 && lines.at(-1)!.trim() === "") lines.pop();
    store(lines.join("\n"));
  });
  return read;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function answerAsMessage(item: AskItem, { label, note, answers }: GivenAnswer) {
  if (answers) {
    const each = answers.flatMap((entry, index) => [`${index + 1}. "${entry.question}": ${entry.label}`, ...noteLine(entry.note, "   Note: ")]);
    return ["My answers to your questions:", ...each, ...noteLine(note, "Note on all the answers: ")].join("\n");
  }
  return [`My answer to your question "${item.question}": ${label}`, ...noteLine(note, "Note: ")].join("\n");
}
