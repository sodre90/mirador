import type { Conversation } from "../shared/model.ts";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";

const words = t.shell.sidebar;

export const setFavourite = (conversationId: string, favourite: boolean) => connection.send({ type: "conversation.set-favourite", conversationId, favourite });

export const favouriteLabel = ({ favourite }: Pick<Conversation, "favourite">) => (favourite ? words.removeFavourite : words.addFavourite);

/** Next to a conversation's title: filled on a favourite, and clicking it adds or removes the conversation. */
export function FavouriteStar({ conversation }: { conversation: Conversation }) {
  const favourite = conversation.favourite === true;
  return (
    <button
      type="button"
      className={["icon", "favourite-star", favourite && "on"].filter(Boolean).join(" ")}
      aria-pressed={favourite}
      aria-label={favouriteLabel(conversation)}
      data-hint={favourite ? hints.removeFavourite : hints.addFavourite}
      onClick={(event) => {
        event.stopPropagation();
        setFavourite(conversation.id, !favourite);
      }}
    >
      {favourite ? "★" : "☆"}
    </button>
  );
}
