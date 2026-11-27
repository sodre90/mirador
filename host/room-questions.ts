import { answersSummary, NONE_OF_THE_OPTIONS, questionsOf } from "../shared/ask.ts";
import { HostProblemError } from "../shared/host-problems.ts";
import type { AskAnswerEntry, AskItem, AskQuestion } from "../shared/model.ts";
import { PERSON_WITHOUT_A_NAME, personGoesBy } from "../shared/people.ts";
import { MOST_OWN_ANSWER_CHARACTERS, type RoomConfirmedAnswer, type RoomQuestionVotes } from "../shared/room-votes.ts";
import { approvesIn, asksAgentsAs, taskOf, type Room } from "../shared/rooms.ts";
import { shownAsWritten } from "../shared/written-text.ts";
import type { CanvasService, RoomAnswerer } from "./canvas/service.ts";
import type { Hub } from "./hub.ts";
import { SenderLimit } from "./join-requests.ts";
import type { Store } from "./store.ts";

/** How many picks and confirmations a minute one person may make, far more than anyone choosing makes. */
export const MOST_VOTES_A_MINUTE = 60;

export type QuestionsStore = Pick<
  Store,
  "findRoom" | "findCanvasItem" | "listCanvasItems" | "findRoomBroughtCanvasItem" | "listRoomBroughtCanvasItems" | "ownerId" | "listRoomMessages" | "setRoomVote" | "listRoomVotes" | "listPeople"
>;

/** Called when a room confirms an answer to a question asked by a brought agent. */
export type BroughtAskConfirmer = (
  roomId: string,
  agentId: string,
  itemId: string,
  answer: AskAnswerEntry,
  answers: AskAnswerEntry[] | undefined,
  authorId: string,
  answerer: RoomAnswerer | undefined,
) => void;

/**
 * Who may confirm the answer the question's agent gets: the person whose task its turn works on, while they may still ask
 * the room's agents, and the owner; the owner alone once they prompted the agent's conversation itself in that turn.
 * Nobody once it no longer waits.
 */
export function confirmersOf(store: Pick<QuestionsStore, "ownerId" | "listRoomMessages">, room: Room, item: AskItem): string[] {
  if (item.status !== "waiting") return [];
  const ownerId = store.ownerId();
  const messagesById = new Map(store.listRoomMessages(room.id).map((message) => [message.id, message]));
  const answering = item.madeInRoom && !item.madeInRoom.ownerAloneAnswers && messagesById.get(item.madeInRoom.answering);
  const task = answering ? taskOf(answering, messagesById, ownerId) : null;
  const mayStillAsk = room.people.some(({ personId, role }) => personId === task?.personId && asksAgentsAs(role));
  return [...(task && task.personId !== ownerId && mayStillAsk ? [task.personId] : []), ownerId];
}

/** The questions the room's agents ask there now, which its people vote on. */
export function questionsIn(store: Pick<QuestionsStore, "listCanvasItems" | "listRoomBroughtCanvasItems">, room: Room): AskItem[] {
  return [
    ...room.agents.flatMap(({ conversationId }) => (conversationId ? store.listCanvasItems(conversationId) : [])),
    ...store.listRoomBroughtCanvasItems(room.id),
  ].filter((item): item is AskItem => item.kind === "ask");
}

/**
 * An agent's question in a room is everyone's to vote on: each person there picks one option of each of its questions,
 * and may pick again until the answer is confirmed. The person whose task the agent works on, or the owner, confirms
 * the answer, which the agent gets as from them. A pick names an option by its place, never words of its own.
 */
export class RoomQuestions {
  constructor(
    private readonly store: QuestionsStore,
    private readonly hub: Pick<Hub, "publishToRoom">,
    private readonly canvas: Pick<CanvasService, "answer">,
    private readonly picking = new SenderLimit(Date.now, MOST_VOTES_A_MINUTE),
    private readonly broughtAskAnswered: BroughtAskConfirmer = () => {},
  ) {}

  vote(roomId: string, itemId: string, question: number, option: number, personId: string) {
    const { room, item } = this.waitingQuestion(roomId, itemId, personId);
    if (!isOptionOf(questionsOf(item)[question], option)) throw new Error("That question has no such option.");
    if (!this.picking.allows(personId)) throw new HostProblemError({ code: "room-voting-too-fast" });
    this.store.setRoomVote(itemId, roomId, { personId, question, option });
    this.changed(room, item);
  }

  /**
   * The answer goes to the agent as the confirmer's, and the question closes; `answers` holds one for each of its
   * questions. The agent is told who confirmed it, and in what role, unless it was the owner.
   */
  confirm(roomId: string, itemId: string, answers: RoomConfirmedAnswer[], personId: string) {
    const { room, item, broughtAgentId } = this.waitingQuestion(roomId, itemId, personId);
    if (!confirmersOf(this.store, room, item).includes(personId)) throw new HostProblemError({ code: "room-confirm-not-yours" });
    const questions = questionsOf(item);
    if (answers.length !== questions.length) throw new HostProblemError({ code: "answer-all-questions", count: questions.length });
    if (!this.picking.allows(personId)) throw new HostProblemError({ code: "room-voting-too-fast" });
    const entries = answers.map((answer, index) => this.entryOf(room, questions[index]!, answer, personId));
    const answerer = this.answererOf(room, personId, answers);
    const chosen = item.questions ? { label: answersSummary(entries) } : entries[0]!;
    const multi = item.questions ? entries : undefined;
    if (broughtAgentId !== null) this.broughtAskAnswered(room.id, broughtAgentId, itemId, chosen, multi, personId, answerer);
    else this.canvas.answer(itemId, chosen, multi, personId, answerer);
  }

  /** Where each question of the room's agents stands, for a page that opens the room. */
  votesIn(roomId: string): RoomQuestionVotes[] {
    const room = this.store.findRoom(roomId);
    return room ? questionsIn(this.store, room).map((item) => this.votesOn(room, item)) : [];
  }

  /** A question of the room's agent opened, closed or changed: the room's pages hear where it stands. */
  changed(room: Room, item: AskItem) {
    this.hub.publishToRoom(room.id, { type: "room.votes", roomId: room.id, votes: this.votesOn(room, item) });
  }

  /** Who may confirm follows who is in the room in which role, and a person taken out takes their picks along, so its questions are told again. */
  peopleChanged(roomId: string) {
    const room = this.store.findRoom(roomId);
    if (room) questionsIn(this.store, room).forEach((item) => this.changed(room, item));
  }

  private votesOn(room: Room, item: AskItem): RoomQuestionVotes {
    return { itemId: item.id, ballots: this.store.listRoomVotes(item.id), confirmers: confirmersOf(this.store, room, item) };
  }

  /** The room, which the person is in, and the question one of its agents asks there now that still waits for its answer. */
  private waitingQuestion(roomId: string, itemId: string, personId: string): { room: Room; item: AskItem; broughtAgentId: string | null } {
    const room = this.store.findRoom(roomId);
    if (!room || !(personId === this.store.ownerId() || room.people.some((person) => person.personId === personId))) throw new HostProblemError({ code: "room-gone" });
    const own = this.store.findCanvasItem(itemId);
    if (own?.kind === "ask" && room.agents.some(({ conversationId }) => conversationId === own.conversationId)) {
      if (own.status !== "waiting") throw new HostProblemError({ code: "room-question-not-waiting" });
      return { room, item: own, broughtAgentId: null };
    }
    const brought = this.store.findRoomBroughtCanvasItem(itemId);
    if (brought?.roomId === roomId && brought.item.kind === "ask") {
      if (brought.item.status !== "waiting") throw new HostProblemError({ code: "room-question-not-waiting" });
      return { room, item: brought.item, broughtAgentId: brought.agentId };
    }
    throw new HostProblemError({ code: "unknown-question" });
  }

  /** A confirmer other than the owner, as the agent is told of them: their role in the room, their name, and which answers are their own words. */
  private answererOf(room: Room, personId: string, answers: RoomConfirmedAnswer[]): RoomAnswerer | undefined {
    if (personId === this.store.ownerId()) return undefined;
    const { role } = room.people.find((person) => person.personId === personId)!;
    const name = personGoesBy(
      this.store.listPeople().find(({ id }) => id === personId),
      PERSON_WITHOUT_A_NAME,
    );
    return { author: { role, name }, ownWords: answers.map((answer) => "own" in answer) };
  }

  /**
   * An option by its place, or, where the question takes an answer of another kind, none of its options, or the
   * confirmer's own words where their own tasks wait for no approval: the owner's and an approver's never do, and
   * nobody's in a room whose people's tasks start by themselves. None of the options asks no approval: it holds no words.
   */
  private entryOf(room: Room, question: AskQuestion, answer: RoomConfirmedAnswer, personId: string): AskAnswerEntry {
    if ("option" in answer) {
      if (!isOptionOf(question, answer.option)) throw new Error("That question has no such option.");
      return { label: question.options[answer.option]!.label };
    }
    if ("none" in answer) {
      if (!question.allowOther) throw new HostProblemError({ code: "room-own-answer-not-taken" });
      return { label: NONE_OF_THE_OPTIONS };
    }
    const isOwner = personId === this.store.ownerId();
    if (!question.allowOther || !(isOwner || approvesIn(room, personId) || !room.peoplesTasksWait)) throw new HostProblemError({ code: "room-own-answer-not-taken" });
    const own = (isOwner ? answer.own : shownAsWritten(answer.own)).trim();
    if (!own) throw new Error("An answer in your own words needs words.");
    if (own.length > MOST_OWN_ANSWER_CHARACTERS) throw new HostProblemError({ code: "room-message-too-long", most: MOST_OWN_ANSWER_CHARACTERS });
    return { label: own };
  }
}

const isOptionOf = (question: AskQuestion | undefined, option: number) => question !== undefined && Number.isInteger(option) && option >= 0 && option < question.options.length;
