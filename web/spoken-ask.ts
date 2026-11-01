import { answersSummary, questionsOf } from "../shared/ask.ts";
import type { AskAnswerEntry, AskItem, CanvasItem } from "../shared/model.ts";
import { heardChoice, otherOptionsSentences, questionSentences, spokenLabel, type OfferedOptions } from "../shared/spoken-asks.ts";
import { connection } from "./connection.ts";
import { forgetSpokenReply, keepsTalkingIn, listenAgainIn, quietClock, sayAloud, stopReadingOf } from "./reply-player.ts";

/** A question the agent waits on, asked aloud in a spoken conversation, one of its questions at a time. */
interface Answering {
  item: AskItem;
  position: number;
  answers: AskAnswerEntry[];
  offered: OfferedOptions;
  /** What was said last, to say again on "repeat that". */
  said: string[];
  /** The agent isn't working while it waits on the answer, so its clock keeps quiet until this is called. */
  clockBack: () => void;
}

/** Words the agent gets with an answer that names no option, as what was said may be a question back or misheard. */
export const SAID_ALOUD = "Answered aloud, in their own words.";

const HELP = ["Say yes to take the one I recommend, the others to hear the rest, or the number of one.", "Anything else goes to the agent as your answer.", "Stop ends the conversation."];

const answering = new Map<string, Answering>();
/** Each question is asked aloud once; answered on the canvas, or the conversation stopped, it isn't taken up again. */
const takenUp = new Set<string>();

const spokenKey = (item: AskItem) => `ask:${item.id}`;

function say(conversationId: string, asking: Answering, sentences: string[]) {
  asking.said = sentences;
  void sayAloud(conversationId, spokenKey(asking.item), sentences).then((heard) => {
    if (heard && answering.get(conversationId) === asking) listenAgainIn(conversationId);
  });
}

function ask(conversationId: string, asking: Answering) {
  const questions = questionsOf(asking.item);
  const { sentences, offered } = questionSentences(questions[asking.position]!, { position: asking.position, of: questions.length });
  asking.offered = offered;
  say(conversationId, asking, sentences);
}

function end(conversationId: string) {
  const asking = answering.get(conversationId);
  if (!asking) return;
  answering.delete(conversationId);
  asking.clockBack();
  stopReadingOf(conversationId, spokenKey(asking.item));
}

/**
 * Asks a question the agent waits on aloud, while Keep talking keeps a dictated message's turn going; stops asking
 * once it is answered some other way, as on the canvas.
 */
export function askAloudWhenWaiting(conversationId: string, canvas: CanvasItem[]) {
  const current = answering.get(conversationId);
  if (current && !canvas.some((item) => item.id === current.item.id && item.status === "waiting")) end(conversationId);
  if (answering.has(conversationId) || !keepsTalkingIn(conversationId)) return;
  const waiting = canvas.find((item): item is AskItem => item.kind === "ask" && item.status === "waiting" && !takenUp.has(item.id));
  if (!waiting || questionsOf(waiting).length === 0) return;
  takenUp.add(waiting.id);
  const asking: Answering = { item: waiting, position: 0, answers: [], offered: "all", said: [], clockBack: quietClock() };
  answering.set(conversationId, asking);
  ask(conversationId, asking);
}

/** What is heard while a question is asked aloud answers it, rather than going to the agent as a message. */
export const answeringIn = (conversationId: string) => answering.has(conversationId);

export function repeatQuestion(conversationId: string) {
  const asking = answering.get(conversationId);
  if (asking) say(conversationId, asking, asking.said);
}

/** "Stop" ends the spoken conversation: the question stays on the canvas, and the reply that follows isn't read. */
export function stopAnswering(conversationId: string) {
  end(conversationId);
  forgetSpokenReply(conversationId);
}

function answer(conversationId: string, asking: Answering, answered: AskAnswerEntry) {
  asking.answers.push(answered);
  const questions = questionsOf(asking.item);
  if (asking.position + 1 < questions.length) {
    asking.position++;
    return ask(conversationId, asking);
  }
  const several = asking.item.questions !== undefined;
  const itemId = asking.item.id;
  connection.send(several ? { type: "ask.answer", itemId, label: answersSummary(asking.answers), answers: asking.answers } : { type: "ask.answer", itemId, ...answered });
  end(conversationId);
  const confirmed = several ? "Got it, I'll send those answers." : answered.note === SAID_ALOUD ? "Got it, I'll pass that on." : `Going with ${spokenLabel(answered.label)}.`;
  void sayAloud(conversationId, `${spokenKey(asking.item)}:answered`, [confirmed]);
}

/** "Help" says what can be said to the question, then listens for it. */
export function helpWithQuestion(conversationId: string) {
  const asking = answering.get(conversationId);
  if (asking) say(conversationId, asking, HELP);
}

/**
 * Words heard in English: yes to the option offered, the others, a number or a label's words choose here. Anything
 * else is the agent's to make sense of: it goes as the answer, and the agent can ask again.
 */
export function heardAnswer(conversationId: string, text: string) {
  const asking = answering.get(conversationId);
  if (!asking) return;
  const question = questionsOf(asking.item)[asking.position]!;
  const choice = heardChoice(text, question, asking.offered);
  if (choice.kind === "pick") return answer(conversationId, asking, { label: question.options[choice.index]!.label });
  if (choice.kind === "others") {
    if (asking.offered === "all") return ask(conversationId, asking);
    asking.offered = "all";
    return say(conversationId, asking, otherOptionsSentences(question));
  }
  answer(conversationId, asking, { label: text.trim(), note: SAID_ALOUD });
}
