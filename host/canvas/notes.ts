import type { ShowItem } from "../../shared/model.ts";

/** What happened on the canvas that the agent has not heard of, told with the user's next message and then once heard. */
export interface CanvasNote {
  text: string;
  heard(): void;
}

export function withCanvasNotes(notes: CanvasNote[], message: string) {
  return [...notes.map(({ text }) => text), message].join("\n\n");
}

export function noteOfPageErrors(pages: Pick<ShowItem, "id" | "title" | "errorsForAgent">[]) {
  return pages
    .map(({ id, title, errorsForAgent = [] }) =>
      [`The page "${title}" (canvas item ${id}), shown while nobody was viewing, reported errors when the user opened it:`, ...errorsForAgent.map((error) => `- ${error}`)].join("\n"),
    )
    .join("\n\n");
}
