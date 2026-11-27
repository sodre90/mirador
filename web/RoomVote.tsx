import { useState, type KeyboardEvent } from "react";
import { answerTo, questionsOf } from "../shared/ask.ts";
import type { AskItem, AskQuestion } from "../shared/model.ts";
import type { CanvasItemAuthor } from "../shared/room-canvas.ts";
import { MOST_OWN_ANSWER_CHARACTERS, pickOf, picksOf, type RoomConfirmedAnswer, type RoomQuestionVotes } from "../shared/room-votes.ts";
import { agentMarks, PersonAvatar, usePersonName, usePersonNames } from "./Chat.tsx";
import { connection } from "./connection.ts";
import { formatNumber, t } from "./i18n/index.ts";
import { answerShown } from "./shown-answer.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";

const words = t.rooms.vote;

const NOBODY_VOTED: Pick<RoomQuestionVotes, "ballots" | "confirmers"> = { ballots: [], confirmers: [] };

/** What a confirmer sends for one question: the words they wrote, where they wrote some, else none of its options where they said so, else the option they picked themselves. */
function confirmedAnswer(ownWords: string, noneFits: boolean, option: number | null): RoomConfirmedAnswer | null {
  const own = ownWords.trim();
  if (own) return { own };
  if (noneFits) return { none: true };
  return option === null ? null : { option };
}

function labelOf(question: AskQuestion, answer: RoomConfirmedAnswer) {
  if ("own" in answer) return answer.own;
  if ("none" in answer) return words.noneOfThese;
  return question.options[answer.option]!.label;
}

const replacedAt = <T,>(values: T[], index: number, value: T) => values.map((each, at) => (at === index ? value : each));

const isGiven = (answer: RoomConfirmedAnswer | null): answer is RoomConfirmedAnswer => answer !== null;

function VoteOption({ label, voters, picked, isAnswer, open, onPick }: { label: string; voters: string[]; picked: boolean; isAnswer: boolean; open: boolean; onPick: () => void }) {
  const names = usePersonNames(voters).join(", ");
  return (
    <li className={["room-vote-option", picked && "picked", isAnswer && "answer"].filter(Boolean).join(" ")}>
      <button type="button" aria-pressed={picked} disabled={!open} onClick={onPick}>
        {label}
      </button>
      {voters.length > 0 && (
        <span className="room-vote-voters" role="img" aria-label={words.chosenBy(names)} data-hint={names}>
          {voters.map((personId) => (
            <PersonAvatar key={personId} personId={personId} />
          ))}
          <span className="room-vote-count">{formatNumber(voters.length)}</span>
        </span>
      )}
    </li>
  );
}

function VoteQuestion({
  question,
  index,
  answered,
  ballots,
  yourPick,
  open,
  ownWords,
  noneFits,
  onPick,
  onOwnWords,
  onNoneFits,
  onEnter,
}: {
  question: AskQuestion;
  index: number;
  answered: string | undefined;
  ballots: RoomQuestionVotes["ballots"];
  yourPick: number | null;
  open: boolean;
  /** Only where you confirm and may answer in your own words. */
  ownWords: string | null;
  /** Only where you confirm, the question takes an answer of another kind, and you may not write your own words. */
  noneFits: boolean | null;
  onPick: (option: number) => void;
  onOwnWords: (words: string) => void;
  onNoneFits: (fits: boolean) => void;
  onEnter: () => void;
}) {
  const typingAidAttributes = useTypingAidAttributes();
  const confirmOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onEnter();
  };
  return (
    <div className="room-vote-question">
      <div className="room-vote-ask">{question.question}</div>
      <ul className="room-vote-options" aria-label={question.question}>
        {question.options.map((option, optionIndex) => (
          <VoteOption
            key={optionIndex}
            label={option.label}
            voters={picksOf(ballots, index, optionIndex).map(({ personId }) => personId)}
            picked={yourPick === optionIndex && noneFits !== true}
            isAnswer={answered === option.label}
            open={open}
            onPick={() => onPick(optionIndex)}
          />
        ))}
        {noneFits !== null && (
          <li className={["room-vote-option", "room-vote-none", noneFits && "picked"].filter(Boolean).join(" ")}>
            <button type="button" aria-pressed={noneFits} onClick={() => onNoneFits(!noneFits)}>
              {words.noneOfThese}
            </button>
          </li>
        )}
      </ul>
      {ownWords !== null && (
        <input
          {...typingAidAttributes}
          className="room-vote-own"
          value={ownWords}
          maxLength={MOST_OWN_ANSWER_CHARACTERS}
          placeholder={words.otherAnswer}
          aria-label={words.otherAnswer}
          onChange={(event) => onOwnWords(event.target.value)}
          onKeyDown={confirmOnEnter}
        />
      )}
    </div>
  );
}

function ConfirmedLine({ item }: { item: AskItem }) {
  const answer = item.answer!;
  const confirmer = usePersonName(answer.answeredBy ?? null);
  const label = answerShown(answer);
  return <div className="room-vote-status">{answer.answeredBy ? words.confirmed(confirmer, label) : words.answered(label)}</div>;
}

function WaitingLine({ confirmers }: { confirmers: string[] }) {
  const names = usePersonNames(confirmers);
  return <div className="room-vote-status">{words.confirmsIt(names)}</div>;
}

/**
 * A question an agent of the room asks, which everyone there votes on: each picks one option of each of its questions
 * and sees who picked what. The person whose task it is, and the owner, confirm the answer the agent gets: their own
 * pick, or, where the question takes an answer of another kind, words of their own, or, for whom may not write them,
 * none of its options; never what others picked for them.
 */
export function RoomVote({
  roomId,
  item,
  votes,
  you,
  takesOwnWords,
  asker,
  onShowOnCanvas,
}: {
  roomId: string;
  item: AskItem;
  votes: RoomQuestionVotes | undefined;
  you: string | null;
  takesOwnWords: boolean;
  /** The agent that asked this question, shown so concurrent questions from different agents stay distinct. */
  asker?: CanvasItemAuthor;
  /** Brings this question onto the room's canvas, shown on standalone waiting cards. */
  onShowOnCanvas?: () => void;
}) {
  const questions = questionsOf(item);
  const { ballots, confirmers } = votes ?? NOBODY_VOTED;
  const open = item.status === "waiting";
  const confirms = open && you !== null && confirmers.includes(you);
  const [ownWords, setOwnWords] = useState<string[]>(() => questions.map(() => ""));
  const [noneFits, setNoneFits] = useState<boolean[]>(() => questions.map(() => false));
  const writesOwnWords = (question: AskQuestion) => confirms && takesOwnWords && question.allowOther === true;
  const saysNoneFits = (question: AskQuestion) => confirms && !takesOwnWords && question.allowOther === true;
  const answers = questions.map((question, index) =>
    confirmedAnswer(writesOwnWords(question) ? (ownWords[index] ?? "") : "", saysNoneFits(question) && noneFits[index] === true, pickOf(ballots, index, you)),
  );
  const given = answers.filter(isGiven);
  const ready = given.length === questions.length;
  const confirm = () => {
    if (confirms && ready) connection.send({ type: "room.confirm", roomId, itemId: item.id, answers: given });
  };
  const vote = (question: number, option: number) => {
    setNoneFits((current) => replacedAt(current, question, false));
    connection.send({ type: "room.vote", roomId, itemId: item.id, question, option });
  };
  return (
    <section className={`room-vote${open ? " open" : ""}`} aria-label={item.title} data-item-id={item.id}>
      {(asker || onShowOnCanvas) && (
        <div className="room-vote-head">
          {asker && (
            <span className="room-vote-asker">
              {asker.harness && (
                <span className={`avatar agent-${asker.harness}`} aria-hidden="true">
                  {agentMarks[asker.harness]}
                </span>
              )}
              <span>{t.rooms.asks(asker.name)}</span>
            </span>
          )}
          {onShowOnCanvas && (
            <button type="button" className="link room-vote-canvas" onClick={onShowOnCanvas}>
              {words.showOnCanvas}
            </button>
          )}
        </div>
      )}
      {questions.map((question, index) => (
        <VoteQuestion
          key={index}
          question={question}
          index={index}
          answered={answerTo(item, index)?.label}
          ballots={ballots}
          yourPick={pickOf(ballots, index, you)}
          open={open}
          ownWords={writesOwnWords(question) ? (ownWords[index] ?? "") : null}
          noneFits={saysNoneFits(question) ? noneFits[index] === true : null}
          onPick={(option) => vote(index, option)}
          onOwnWords={(written) => setOwnWords((current) => replacedAt(current, index, written))}
          onNoneFits={(fits) => setNoneFits((current) => replacedAt(current, index, fits))}
          onEnter={confirm}
        />
      ))}
      {confirms && (
        <div className="room-vote-confirm">
          <button type="button" className="primary" disabled={!ready} onClick={confirm}>
            {ready ? words.confirmAnswer(given.map((answer, index) => labelOf(questions[index]!, answer)).join(" · ")) : words.confirm}
          </button>
          {!ready && <span className="room-vote-hint">{words.pickToConfirm}</span>}
        </div>
      )}
      {open && !confirms && confirmers.length > 0 && <WaitingLine confirmers={confirmers} />}
      {item.status === "answered" && item.answer && <ConfirmedLine item={item} />}
      {item.status === "cancelled" && <div className="room-vote-status">{words.withdrawn}</div>}
    </section>
  );
}
