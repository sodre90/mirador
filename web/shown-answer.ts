import { shownAnswer } from "../shared/ask.ts";
import type { CanvasAnswer } from "../shared/model.ts";
import { t } from "./i18n/index.ts";

/** An answer as the page shows it, with none of the options in the reader's language. */
export const answerShown = (answer: Pick<CanvasAnswer, "label" | "answers">) => shownAnswer(answer, t.rooms.vote.noneOfThese);
