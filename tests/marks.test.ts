import { describe, expect, test } from "bun:test";
import { markInitials, workspaceMarkColor } from "../shared/marks.ts";

describe("marks", () => {
  test("a workspace's mark takes its colour from the name, the same in every window and on the phone", () => {
    expect(["mirador", "jira-intel", "dotfiles", "notes"].map(workspaceMarkColor)).toEqual(["#12a594", "#8e4ec6", "#12a594", "#d9822b"]);
  });

  test("a mark shows one letter from each of two words, or the first two of one", () => {
    expect(markInitials("home-server")).toBe("HS");
    expect(markInitials("mac.mini.local")).toBe("MM");
    expect(markInitials("mac+mini")).toBe("MM");
    expect(markInitials("Mac")).toBe("MA");
    expect(markInitials("élan vital")).toBe("ÉV");
  });

  test("an apostrophe stays in its word, and no mark shows one", () => {
    expect(markInitials("O'Brien")).toBe("OB");
    expect(markInitials("d’Artagnan")).toBe("DA");
    expect(markInitials("Péter’s MacBook")).toBe("PM");
    expect(markInitials("Peter's MacBook")).toBe("PM");
  });

  test("a decomposed name reads as the composed one", () => {
    expect(markInitials("élan vital")).toBe("ÉV");
  });

  test("emoji are no letters, and a name of only emoji shows them whole", () => {
    expect(markInitials("🖥️ box")).toBe("BO");
    expect(markInitials("🖥️")).toBe("🖥️");
  });

  test("a name without letters shows its first two characters, and an empty one a question mark", () => {
    expect(markInitials("---")).toBe("--");
    expect(markInitials("  ")).toBe("?");
  });
});
