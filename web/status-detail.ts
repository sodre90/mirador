import type { Conversation } from "../shared/model.ts";
import { t } from "./i18n/index.ts";

/** What the conversation's status says beyond its state: what the host is busy with in the page's language, or the agent's error. */
export const statusDetailOf = ({ busyWith, statusDetail }: Pick<Conversation, "busyWith" | "statusDetail">) =>
  busyWith ? t.chat.busyWith[busyWith] : statusDetail;
