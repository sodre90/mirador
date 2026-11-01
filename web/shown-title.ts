import { UNTITLED, type Conversation } from "../shared/model.ts";
import { t } from "./i18n/index.ts";

/** A conversation's title as the page shows it: the untitled default in the page's language, any other as it was named. */
export const shownTitle = ({ title, titleSetByUser }: Pick<Conversation, "title" | "titleSetByUser">) =>
  title === UNTITLED && !titleSetByUser ? t.shell.conversationTitle.untitled : title;
