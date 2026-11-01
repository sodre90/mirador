import { expect, test } from "bun:test";
import { noteOfPageErrors, withCanvasNotes } from "../host/canvas/notes.ts";

test("canvas notes come before the user's message, each in a paragraph of its own", () => {
  const note = (text: string) => ({ text, heard: () => {} });
  expect(withCanvasNotes([note("Ticked."), note("A page failed.")], "Go on")).toBe("Ticked.\n\nA page failed.\n\nGo on");
  expect(withCanvasNotes([], "Go on")).toBe("Go on");
});

test("the note of page errors names each page by title and canvas item, with its errors under it", () => {
  const pages = [
    { id: "p1", title: "Charts", errorsForAgent: ["SyntaxError: a", "Failed to load x"] },
    { id: "p2", title: "Map", errorsForAgent: ["A script on the page threw an error; this browser hides its message."] },
  ];
  expect(noteOfPageErrors(pages)).toBe(
    [
      'The page "Charts" (canvas item p1), shown while nobody was viewing, reported errors when the user opened it:',
      "- SyntaxError: a",
      "- Failed to load x",
      "",
      'The page "Map" (canvas item p2), shown while nobody was viewing, reported errors when the user opened it:',
      "- A script on the page threw an error; this browser hides its message.",
    ].join("\n"),
  );
});
