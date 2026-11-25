import { expect, test } from "bun:test";
import { noteOfPageErrors, withCanvasNotes } from "../host/canvas/notes.ts";

test("canvas notes come before the user's message, each in a paragraph of its own", () => {
  const note = (text: string) => ({ text, heard: () => {} });
  expect(withCanvasNotes([note("Ticked."), note("A page failed.")], "Go on")).toBe("Ticked.\n\nA page failed.\n\nGo on");
  expect(withCanvasNotes([], "Go on")).toBe("Go on");
});

test("the note of page errors names each page and question by title and canvas item, with its errors under it", () => {
  const items = [
    { kind: "show" as const, id: "p1", title: "Charts", errorsForAgent: ["SyntaxError: a", "Failed to load x"] },
    { kind: "ask" as const, id: "q1", title: "Color?", errorsForAgent: ['option "Red": Mermaid: Parse error on line 3'] },
  ];
  expect(noteOfPageErrors(items)).toBe(
    [
      'The page "Charts" (canvas item p1) reported errors after your show call had returned:',
      "- SyntaxError: a",
      "- Failed to load x",
      "",
      'The pages of your question "Color?" (canvas item q1) reported errors:',
      '- option "Red": Mermaid: Parse error on line 3',
    ].join("\n"),
  );
});
