import { useState, type KeyboardEvent } from "react";
import { answerTo, questionsOf } from "../shared/ask.ts";
import type { AskItem, AskQuestion } from "../shared/model.ts";
import { MOST_OWN_ANSWER_CHARACTERS, pickOf, picksOf, type RoomConfirmedAnswer, type RoomQuestionVotes } from "../shared/room-votes.ts";
import { PersonAvatar, usePersonName, usePersonNames } from "./Chat.tsx";
import { connection } from "./connection.ts";
import { formatNumber, t } from "./i18n/index.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";

const words = t.rooms.vote;

const NOBODY_VOTED: Pick<RoomQuestionVotes, "ballots" | "confirmers"> = { ballots: [], confirmers: [] };

/** What a confirmer sends for one question: the words they wrote, where they wrote some, else the option they picked themselves. */
function confirmedAnswer(ownWords: string, option: number | null): RoomConfirmedAnswer | null {
  const own = ownWords.trim();
  if (own) return { own };
  return option === null ? null : { option };
}

const labelOf = (question: AskQuestion, answer: RoomConfirmedAnswer) => ("own" in answer ? answer.own : question.options[answer.option]!.label);

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
  onPick,
  onOwnWords,
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
  onPick: (option: number) => void;
  onOwnWords: (words: string) => void;
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
            picked={yourPick === optionIndex}
            isAnswer={answered === option.label}
            open={open}
            onPick={() => onPick(optionIndex)}
          />
        ))}
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
  return <div className="room-vote-status">{answer.answeredBy ? words.confirmed(confirmer, answer.label) : words.answered(answer.label)}</div>;
}

function WaitingLine({ confirmers }: { confirmers: string[] }) {
  const names = usePersonNames(confirmers);
  return <div className="room-vote-status">{words.confirmsIt(names)}</div>;
}

/**
 * A question an agent of the room asks, which everyone there votes on: each picks one option of each of its questions
 * and sees who picked what. The person whose task it is, and the owner, confirm the answer the agent gets: their own
 * pick, or, where the question takes them, words of their own; never what others picked for them.
 */
export function RoomVote({ roomId, item, votes, you, takesOwnWords }: { roomId: string; item: AskItem; votes: RoomQuestionVotes | undefined; you: string | null; takesOwnWords: boolean }) {
  const questions = questionsOf(item);
  const { ballots, confirmers } = votes ?? NOBODY_VOTED;
  const open = item.status === "waiting";
  const confirms = open && you !== null && confirmers.includes(you);
  const [ownWords, setOwnWords] = useState<string[]>(() => questions.map(() => ""));
  const answers = questions.map((question, index) => confirmedAnswer(takesOwnWords && question.allowOther ? (ownWords[index] ?? "") : "", pickOf(ballots, index, you)));
  const given = answers.filter(isGiven);
  const ready = given.length === questions.length;
  const confirm = () => {
    if (confirms && ready) connection.send({ type: "room.confirm", roomId, itemId: item.id, answers: given });
  };
  const vote = (question: number, option: number) => connection.send({ type: "room.vote", roomId, itemId: item.id, question, option });
  return (
    <section className={`room-vote${open ? " open" : ""}`} aria-label={item.title} data-item-id={item.id}>
      {questions.map((question, index) => (
        <VoteQuestion
          key={index}
          question={question}
          index={index}
          answered={answerTo(item, index)?.label}
          ballots={ballots}
          yourPick={pickOf(ballots, index, you)}
          open={open}
          ownWords={confirms && takesOwnWords && question.allowOther ? (ownWords[index] ?? "") : null}
          onPick={(option) => vote(index, option)}
          onOwnWords={(written) => setOwnWords((current) => current.map((each, at) => (at === index ? written : each)))}
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
