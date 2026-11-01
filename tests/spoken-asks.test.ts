import { describe, expect, test } from "bun:test";
import type { AskQuestion } from "../shared/model.ts";
import { heardChoice, otherOptionsSentences, questionSentences, recommendedIndex, spokenLabel } from "../shared/spoken-asks.ts";

const sounds: AskQuestion = {
  question: "What should signal the microphone's state",
  options: [
    { label: "Visual only", description: "A stronger mic button." },
    { label: "Short sounds (recommended)", description: "A chime as it opens, another once it has heard." },
    { label: "Sounds plus a stronger visual" },
  ],
};

const plain: AskQuestion = { question: "Which chart comes next?", options: [{ label: "By month" }, { label: "By `product` line" }] };

describe("reading a question aloud", () => {
  test("the agent's recommended option is found by its mark, and said without it", () => {
    expect(recommendedIndex(sounds.options)).toBe(1);
    expect(recommendedIndex(plain.options)).toBeNull();
    expect(spokenLabel("Short sounds (recommended)")).toBe("Short sounds");
    expect(spokenLabel("Recommended: `bun test`")).toBe("bun test");
    expect(spokenLabel("Ship it — recommended")).toBe("Ship it");
  });

  test("the agent's flag wins over a mark in another label", () => {
    expect(recommendedIndex([{ label: "Chimes (recommended)" }, { label: "Lights", recommended: true }])).toBe(1);
  });

  test("the word alone is no mark: an option advised against, or one about recommended things, isn't the recommended one", () => {
    for (const label of ["Not recommended: drop it now", "Keep the recommended defaults", "Drop it (not recommended)"]) {
      expect(recommendedIndex([{ label }, { label: "Wait a week" }]), label).toBeNull();
      expect(spokenLabel(label), label).toBe(label);
    }
  });

  test("with a recommended option, that one is read in full, and the others are offered", () => {
    expect(questionSentences(sounds, { position: 0, of: 1 })).toEqual({
      sentences: ["What should signal the microphone's state.", "I recommend Short sounds.", "A chime as it opens, another once it has heard.", "Go with it, or hear the others?"],
      offered: "recommended",
    });
  });

  test("without one, every option is read by its number, and one of several questions says which it is", () => {
    expect(questionSentences(plain, { position: 1, of: 3 })).toEqual({
      sentences: ["Question 2 of 3.", "Which chart comes next?", "One: By month.", "Two: By product line.", "Which one?"],
      offered: "all",
    });
  });

  test("the others keep the numbers they have in the question", () => {
    expect(otherOptionsSentences(sounds)).toEqual(["The others are:", "One: Visual only.", "Three: Sounds plus a stronger visual.", "Which one?"]);
  });
});

describe("what a spoken answer chooses", () => {
  test("a yes takes the recommended option, only once it was offered alone", () => {
    expect(heardChoice("Yes.", sounds, "recommended")).toEqual({ kind: "pick", index: 1 });
    expect(heardChoice("OK, go with it, please.", sounds, "recommended")).toEqual({ kind: "pick", index: 1 });
    expect(heardChoice("Yes.", sounds, "all")).toEqual({ kind: "unclear" });
  });

  test("asking for the others", () => {
    expect(heardChoice("Hear the others.", sounds, "recommended")).toEqual({ kind: "others" });
    expect(heardChoice("No.", sounds, "recommended")).toEqual({ kind: "others" });
    expect(heardChoice("Here are the others.", sounds, "recommended"), "as speech recognition hears it").toEqual({ kind: "others" });
    expect(heardChoice("What are the alternatives?", sounds, "recommended")).toEqual({ kind: "others" });
  });

  test("with no others to hear, a no goes to the agent as the answer", () => {
    const lone: AskQuestion = { question: "Ship it?", options: [{ label: "Ship it (recommended)" }] };
    expect(heardChoice("No.", lone, "recommended")).toEqual({ kind: "unclear" });
    expect(heardChoice("Hear the others.", lone, "recommended")).toEqual({ kind: "unclear" });
  });

  test("a number, as a word, a digit or an ordinal", () => {
    expect(heardChoice("Three.", sounds, "all")).toEqual({ kind: "pick", index: 2 });
    expect(heardChoice("The first one.", sounds, "all")).toEqual({ kind: "pick", index: 0 });
    expect(heardChoice("Option 2", sounds, "all")).toEqual({ kind: "pick", index: 1 });
    expect(heardChoice("I'll take number two.", sounds, "all")).toEqual({ kind: "pick", index: 1 });
    expect(heardChoice("Let's go number two.", sounds, "all")).toEqual({ kind: "pick", index: 1 });
    expect(heardChoice("Let's go for the third one.", sounds, "all")).toEqual({ kind: "pick", index: 2 });
    expect(heardChoice("I'd like option one.", sounds, "all")).toEqual({ kind: "pick", index: 0 });
    expect(heardChoice("Five.", sounds, "all"), "no fifth option").toEqual({ kind: "unclear" });
  });

  test("the words of one label, all of it or a part only it has", () => {
    expect(heardChoice("Visual only.", sounds, "all")).toEqual({ kind: "pick", index: 0 });
    expect(heardChoice("Let's go with visual only please", sounds, "all")).toEqual({ kind: "pick", index: 0 });
    expect(heardChoice("By product line.", plain, "all")).toEqual({ kind: "pick", index: 1 });
    expect(heardChoice("Month.", plain, "all")).toEqual({ kind: "pick", index: 0 });
    expect(heardChoice("Sounds.", sounds, "all"), "two labels have it").toEqual({ kind: "unclear" });
    expect(heardChoice("The one that beeps.", sounds, "all"), "for the voice model to judge").toEqual({ kind: "unclear" });
  });
});
