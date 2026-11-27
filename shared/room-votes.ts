/** One person's pick for one question an agent of a room asks: an option by its place, never words of their own. */
export interface RoomBallot {
  personId: string;
  question: number;
  option: number;
}

/** Where a question of a room's agent stands: everyone's picks, and who may confirm the answer its agent gets. */
export interface RoomQuestionVotes {
  itemId: string;
  ballots: RoomBallot[];
  confirmers: string[];
}

/**
 * What a confirmer sends the agent for one question: one of its options, or, where it takes an answer of another kind,
 * words of their own where they may write them, else that none of its options fits.
 */
export type RoomConfirmedAnswer = { option: number } | { own: string } | { none: true };

/** The longest answer in their own words a confirmer may send an agent. */
export const MOST_OWN_ANSWER_CHARACTERS = 2_000;

export const picksOf = (ballots: RoomBallot[], question: number, option: number) => ballots.filter((ballot) => ballot.question === question && ballot.option === option);

export const pickOf = (ballots: RoomBallot[], question: number, personId: string | null) =>
  ballots.find((ballot) => ballot.question === question && ballot.personId === personId)?.option ?? null;
