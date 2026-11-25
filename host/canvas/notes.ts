import type { AskItem, ShowItem } from "../../shared/model.ts";

/** What happened on the canvas that the agent has not heard of, told with the user's next message and then once heard. */
export interface CanvasNote {
  text: string;
  heard(): void;
}

export function withCanvasNotes(notes: CanvasNote[], message: string) {
  return [...notes.map(({ text }) => text), message].join("\n\n");
}

type ItemWithErrors = Pick<ShowItem | AskItem, "kind" | "id" | "title" | "errorsForAgent">;

export const errorList = (errors: string[]) => errors.map((error) => `- ${error}`).join("\n");

const whatReported = ({ kind, id, title }: ItemWithErrors) =>
  kind === "show"
    ? `The page "${title}" (canvas item ${id}) reported errors after your show call had returned:`
    : `The pages of your question "${title}" (canvas item ${id}) reported errors:`;

export const noteOfPageErrors = (items: ItemWithErrors[]) => items.map((item) => `${whatReported(item)}\n${errorList(item.errorsForAgent ?? [])}`).join("\n\n");
