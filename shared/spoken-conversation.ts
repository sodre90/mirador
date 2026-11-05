import { answersSummary, questionsOf } from "./ask.ts";
import type { AskAnswerEntry, AskItem, StoredEvent } from "./model.ts";
import { heardChoice, otherOptionsSentences, questionSentences, spokenLabel, type OfferedOptions } from "./spoken-asks.ts";
import { inEnglish, nothingToSend, spokenCommand } from "./spoken-commands.ts";
import { lastReply, spokenTurn } from "./spoken-replies.ts";
import type { TimelineBlock } from "./timeline.ts";

/** Rising as the microphone opens, falling once it has heard, low when something went wrong. */
export type Chime = "listening" | "heard" | "trouble";

/** How reading something aloud ended: heard to the end, cut short, or failed with what to show. */
export type ReadingOutcome = { kind: "heard" } | { kind: "stopped" } | { kind: "failed"; problem: string };

/**
 * Where a spoken conversation is: waiting to be taken up, listening, waiting on the agent, speaking, or waiting for an
 * approval that has to be given on the screen.
 */
export type SpokenPhase = "idle" | "listening" | "working" | "speaking" | "waiting-for-approval";

export interface SpokenState {
  phase: SpokenPhase;
  /** What went wrong last, shown large until the next try. */
  problem: string | null;
  /** While listening: the recognizer has started, so what is said now is heard. */
  microphoneOpen: boolean;
}

/** What the conversation does to the world; the Mac and the phone give their own, the tests theirs. */
export interface SpokenConversationEffects {
  chime(chime: Chime): Promise<void>;
  /**
   * Opens the microphone until the given time at the latest; that it opened comes back through microphoneOpened(), and
   * what is heard through heard(), heardNothing() or listeningFailed().
   */
  listen(until: number): void;
  stopListening(): void;
  /** False when the machine isn't connected. */
  send(message: string): boolean;
  readReply(key: string, reply: string): Promise<ReadingOutcome>;
  say(key: string, sentences: string[]): Promise<ReadingOutcome>;
  stopSpeaking(): void;
  answer(itemId: string, answer: AskAnswerEntry, answers?: AskAnswerEntry[]): void;
  ticking(on: boolean): void;
  changed(state: SpokenState): void;
  now(): number;
}

/** After a reply, the microphone waits this long for the first words, however many rounds hear only noise. */
export const KEEP_LISTENING_MS = 120_000;

/** Words the agent gets with an answer that names no option, as what was said may be a question back or misheard. */
export const SAID_ALOUD = "Answered aloud, in their own words.";

const CONVERSATION_HELP = [
  "Say stop or thanks to end the conversation, or repeat that to hear my last reply again.",
  "Anything else goes to the agent as your next message.",
];
const QUESTION_HELP = [
  "Say yes to take the one I recommend, the others to hear the rest, or the number of one.",
  "Anything else goes to the agent as your answer.",
  "Stop ends the conversation.",
];
export const NO_REPLY = ["The agent stopped without a reply."];
export const APPROVAL_NEEDED = ["The agent is waiting for your approval on the screen."];
const NOTHING_TO_REPEAT = ["There is no reply to repeat yet."];
export const NOT_CONNECTED = "Not sent: the machine is not connected.";

/** What the conversation follows of what is shown: its events and timeline, the question waiting, and approvals. */
export interface ConversationView {
  events: StoredEvent[];
  timeline: TimelineBlock[];
  ask: AskItem | null;
  awaitingApproval: boolean;
}

interface Answering {
  item: AskItem;
  position: number;
  answers: AskAnswerEntry[];
  offered: OfferedOptions;
  said: string[];
}

/**
 * A spoken conversation with the agent, hands-free, as Keep talking and car mode have it: what is said is sent after
 * a pause, the reply is read aloud, then the microphone opens again. Questions the agent asks are read aloud and
 * answered by voice; an approval only the screen can give is said once.
 */
export class SpokenConversation {
  private state: SpokenState = { phase: "idle", problem: null, microphoneOpen: false };
  private listeningUntil = 0;
  private answering: Answering | null = null;
  private lastReply: { key: string; text: string } | null = null;
  /** Each reading or listening has its number, so that one overtaken by another doesn't act when it ends. */
  private round = 0;
  /** Each question is asked aloud once; answered on the screen, or the conversation stopped, it isn't taken up again. */
  private readonly takenUp = new Set<string>();
  private view: ConversationView | null = null;
  /** The last event before the message whose turn is awaited; null while no turn is. */
  private awaitedAfter: number | null = null;
  private askedBefore: string | null = null;

  constructor(private readonly effects: SpokenConversationEffects) {}

  get phase() {
    return this.state.phase;
  }

  /** The big button: talk, finish talking, or cut a reading short to talk. */
  tap() {
    if (this.state.phase === "listening") return this.effects.stopListening();
    if (this.state.phase === "speaking") this.effects.stopSpeaking();
    if (this.state.phase === "working") return;
    void this.listen(this.effects.now() + KEEP_LISTENING_MS);
  }

  /** A message dictated in the message box was sent after these events: the conversation goes on from its turn. */
  sentFromTheMessageBox(events: StoredEvent[]) {
    this.awaitedAfter = events.at(-1)?.seq ?? 0;
    this.round++;
    this.effects.stopListening();
    this.working();
  }

  /** Stopped, or the screen left: everything stops, and nothing said meanwhile is sent. */
  end() {
    this.round++;
    this.answering = null;
    this.awaitedAfter = null;
    this.effects.ticking(false);
    this.effects.stopListening();
    this.effects.stopSpeaking();
    this.set({ phase: "idle" });
  }

  microphoneOpened() {
    if (this.state.phase === "listening") this.set({ phase: "listening", microphoneOpen: true });
  }

  heard(text: string) {
    if (this.state.phase !== "listening") return;
    if (nothingToSend(text)) return this.heardOnlyNoise();
    void this.effects.chime("heard");
    if (this.answering) return this.heardAnswer(this.answering, text);
    const command = spokenCommand(text);
    if (command === "stop") return this.set({ phase: "idle" });
    if (command === "help") return void this.sayThenListen("help", CONVERSATION_HELP);
    if (command === "repeat") return void this.repeat();
    if (!this.effects.send(text.trim())) return this.trouble(NOT_CONNECTED);
    this.awaitedAfter = this.view?.events.at(-1)?.seq ?? 0;
    this.working();
  }

  /** Words made up from noise, or sounds of thinking: listening goes on while its time lasts, with a chime as it opens again. */
  private heardOnlyNoise() {
    if (this.effects.now() < this.listeningUntil) return void this.listen(this.listeningUntil);
    this.set({ phase: "idle" });
  }

  /** Silence, or a recognizer that gave up: listening goes on while its time lasts. */
  heardNothing() {
    if (this.state.phase !== "listening") return;
    if (this.effects.now() < this.listeningUntil) return this.effects.listen(this.listeningUntil);
    this.set({ phase: "idle" });
  }

  listeningFailed(problem: string) {
    if (this.state.phase === "listening") this.trouble(problem);
  }

  /** Follows what the conversation shows: the awaited turn ending, questions asked and gone, approvals. */
  follow(view: ConversationView) {
    this.view = view;
    this.followTheTurn(view);
    if (!view.awaitingApproval && this.state.phase === "waiting-for-approval") this.working();
    this.followTheQuestion(view.ask);
    if (view.awaitingApproval) this.needsApproval();
  }

  /** While a question is asked aloud, what is heard answers it. */
  get answeringAQuestion() {
    return this.answering !== null;
  }

  private followTheTurn({ events, timeline }: ConversationView) {
    if (this.awaitedAfter === null) return;
    const outcome = spokenTurn(events, this.awaitedAfter);
    if (outcome === "going-on") return;
    this.awaitedAfter = null;
    const reply = outcome === "ended" ? lastReply(timeline) : null;
    this.turnEnded(reply && { key: reply.key, text: reply.text });
  }

  private followTheQuestion(ask: AskItem | null) {
    if (this.askedBefore !== null && this.askedBefore !== ask?.id) this.askGone(this.askedBefore);
    this.askedBefore = ask?.id ?? null;
    if (ask) this.asked(ask);
  }

  /** The turn the message started ended: its last reply, if it has one, is read, then the microphone opens again. */
  turnEnded(reply: { key: string; text: string } | null) {
    this.effects.ticking(false);
    if (this.state.phase !== "working" && this.state.phase !== "waiting-for-approval") return;
    this.answering = null;
    if (!reply) return void this.sayThenListen("no-reply", NO_REPLY);
    this.lastReply = reply;
    void this.readThenListen(reply);
  }

  /** The agent asks something while it works: asked aloud, a question at a time, and answered by voice. */
  asked(item: AskItem) {
    if (this.state.phase !== "working" || this.answering || this.takenUp.has(item.id) || questionsOf(item).length === 0) return;
    this.takenUp.add(item.id);
    this.effects.ticking(false);
    this.answering = { item, position: 0, answers: [], offered: "all", said: [] };
    this.askAloud(this.answering);
  }

  /** The question was answered or withdrawn some other way, as on the screen. */
  askGone(itemId: string) {
    if (this.answering?.item.id !== itemId) return;
    this.answering = null;
    this.round++;
    this.effects.stopListening();
    this.effects.stopSpeaking();
    this.working();
  }

  /** An approval only the screen can give: said once, then the conversation waits for the turn to end. */
  needsApproval() {
    if (this.state.phase !== "working") return;
    this.effects.ticking(false);
    this.set({ phase: "waiting-for-approval" });
    void this.effects.say("approval", APPROVAL_NEEDED);
  }

  private working() {
    this.set({ phase: "working" });
    this.effects.ticking(true);
  }

  private async listen(until: number) {
    const round = ++this.round;
    this.listeningUntil = until;
    this.set({ phase: "listening" });
    await this.effects.chime("listening");
    if (round === this.round && this.state.phase === "listening") this.effects.listen(until);
  }

  private async speakThenListen(speaking: () => Promise<ReadingOutcome>) {
    const round = ++this.round;
    this.set({ phase: "speaking" });
    const outcome = await speaking();
    if (round !== this.round) return;
    if (outcome.kind === "heard") return void this.listen(this.effects.now() + KEEP_LISTENING_MS);
    if (outcome.kind === "failed") return this.trouble(outcome.problem);
    this.set({ phase: "idle" });
  }

  private sayThenListen(key: string, sentences: string[]) {
    return this.speakThenListen(() => this.effects.say(key, sentences));
  }

  private readThenListen(reply: { key: string; text: string }) {
    return this.speakThenListen(() => this.effects.readReply(reply.key, reply.text));
  }

  private repeat() {
    if (this.lastReply) return this.readThenListen(this.lastReply);
    return this.sayThenListen("nothing-to-repeat", NOTHING_TO_REPEAT);
  }

  private askAloud(asking: Answering) {
    const questions = questionsOf(asking.item);
    const { sentences, offered } = questionSentences(questions[asking.position]!, { position: asking.position, of: questions.length });
    asking.offered = offered;
    this.sayToAnswer(asking, sentences);
  }

  private sayToAnswer(asking: Answering, sentences: string[]) {
    asking.said = sentences;
    void this.sayThenListen(`ask:${asking.item.id}:${asking.position}`, sentences);
  }

  private heardAnswer(asking: Answering, text: string) {
    const command = spokenCommand(text);
    if (command === "stop") {
      this.answering = null;
      return this.set({ phase: "idle" });
    }
    if (command === "repeat") return this.sayToAnswer(asking, asking.said);
    if (command === "help") return this.sayToAnswer(asking, QUESTION_HELP);
    const question = questionsOf(asking.item)[asking.position]!;
    const choice = heardChoice(inEnglish(text), question, asking.offered);
    if (choice.kind === "others") {
      if (asking.offered === "all") return this.askAloud(asking);
      asking.offered = "all";
      return this.sayToAnswer(asking, otherOptionsSentences(question));
    }
    const answered = choice.kind === "pick" ? { label: question.options[choice.index]!.label } : { label: text.trim(), note: SAID_ALOUD };
    this.answered(asking, answered);
  }

  private answered(asking: Answering, answered: AskAnswerEntry) {
    asking.answers.push(answered);
    if (asking.position + 1 < questionsOf(asking.item).length) {
      asking.position++;
      return this.askAloud(asking);
    }
    const several = asking.item.questions !== undefined;
    if (several) this.effects.answer(asking.item.id, { label: answersSummary(asking.answers) }, asking.answers);
    else this.effects.answer(asking.item.id, answered);
    this.answering = null;
    const confirmed = several ? "Got it, I'll send those answers." : answered.note === SAID_ALOUD ? "Got it, I'll pass that on." : `Going with ${spokenLabel(answered.label)}.`;
    this.working();
    this.effects.ticking(false);
    void this.effects.say(`answered:${asking.item.id}`, [confirmed]).then(() => {
      if (this.state.phase === "working") this.effects.ticking(true);
    });
  }

  private trouble(problem: string) {
    void this.effects.chime("trouble");
    this.set({ phase: "idle", problem });
  }

  private set(next: { phase: SpokenPhase; problem?: string | null; microphoneOpen?: boolean }) {
    this.state = { phase: next.phase, problem: next.problem ?? null, microphoneOpen: next.microphoneOpen ?? false };
    this.effects.changed(this.state);
  }
}
