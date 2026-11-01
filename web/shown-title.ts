import { isUntitled, type Conversation } from "../shared/model.ts";
import { t } from "./i18n/index.ts";

/** A conversation's title as the page shows it: the untitled default in the page's language, any other as it was named. */
export const shownTitle = (conversation: Pick<Conversation, "title" | "titleSetByUser">) =>
  isUntitled(conversation) ? t.shell.conversationTitle.untitled : conversation.title;
