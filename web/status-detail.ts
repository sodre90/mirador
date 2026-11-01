import type { Conversation } from "../shared/model.ts";
import { t } from "./i18n/index.ts";
import { problemText } from "./problem-text.ts";

/** What the conversation's status says beyond its state: what the host is busy with in the page's language, or the agent's error. */
export const statusDetailOf = ({ busyWith, statusDetail, statusProblem }: Pick<Conversation, "busyWith" | "statusDetail" | "statusProblem">) =>
  busyWith ? t.chat.busyWith[busyWith] : statusProblem ? problemText(statusProblem, t.problems) : statusDetail;
