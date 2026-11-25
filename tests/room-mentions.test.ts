import { expect, test } from "bun:test";
import { MOST_PEOPLE_TAGGED, mentionsIn, stillTagged, textAroundMentions, withTagAtCaret } from "../shared/room-mentions.ts";
import { ROOM_MESSAGE_MOST_CHARACTERS } from "../shared/rooms.ts";
import { pickOf } from "../shared/room-votes.ts";

const people = [
  { personId: "mia", name: "Mia" },
  { personId: "mia-k", name: "Mia K" },
  { personId: "zhou", name: "周杰" },
  { personId: "nameless", name: "" },
];

test("a tag is an @ that starts a word, followed by a whole name in any case; the longest name that fits wins, and each person is tagged once", () => {
  expect(mentionsIn("@mia k, then @Mia, then @MIA", people)).toEqual([
    { personId: "mia-k", written: "mia k" },
    { personId: "mia", written: "Mia" },
  ]);
  expect(mentionsIn("ann@mia.com @Miami @Mia_ @@Mia (@周杰)", people)).toEqual([
    { personId: "mia", written: "Mia" },
    { personId: "zhou", written: "周杰" },
  ]);
  expect(mentionsIn("@ alone, and @", people)).toEqual([]);
});

test("the text is cut around the tags the host found, each with its @, so a tag shows only where it was written", () => {
  const mentions = [
    { personId: "mia-k", written: "Mia K" },
    { personId: "mia", written: "Mia" },
  ];
  expect(textAroundMentions("Hi @Mia K and @mia!", mentions)).toEqual([
    { text: "Hi " },
    { text: "@Mia K", mention: mentions[0] },
    { text: " and " },
    { text: "@mia", mention: mentions[1] },
    { text: "!" },
  ]);
  expect(textAroundMentions("@Mia", [mentions[1]!])).toEqual([{ text: "@Mia", mention: mentions[1] }]);
  expect(textAroundMentions("no tags @Olga", mentions)).toEqual([{ text: "no tags @Olga" }]);
  expect(textAroundMentions("plain", [])).toEqual([{ text: "plain" }]);
  const overlapping = [{ personId: "x", written: "A @B" }, { personId: "b", written: "B" }];
  expect(textAroundMentions("@A @B", overlapping)).toEqual([{ text: "@A @B", mention: overlapping[0] }]);
});

test("one message tags at most the first MOST_PEOPLE_TAGGED people, found within as much text as a person may write", () => {
  const crowd = Array.from({ length: MOST_PEOPLE_TAGGED + 5 }, (_, index) => ({ personId: `p${index}`, name: `Guest${String.fromCharCode(97 + index)}` }));
  const tagged = mentionsIn(crowd.map(({ name }) => `@${name}`).join(" "), crowd);
  expect(tagged.map(({ personId }) => personId)).toEqual(crowd.slice(0, MOST_PEOPLE_TAGGED).map(({ personId }) => personId));
  expect(mentionsIn(`${"x".repeat(ROOM_MESSAGE_MOST_CHARACTERS - 3)} @Mia`, people)).toEqual([]);
  expect(mentionsIn(`${"x".repeat(ROOM_MESSAGE_MOST_CHARACTERS - 5)} @Mi`, [{ personId: "mi", name: "Mi" }])).toEqual([{ personId: "mi", written: "Mi" }]);
});

test("finding and cutting around tags takes time in step with the text, however many tags it holds", () => {
  const mia = { personId: "mia", written: "Mia" };
  const text = "@Mia ".repeat(100_000);
  const started = performance.now();
  expect(mentionsIn(text, people)).toEqual([mia]);
  expect(textAroundMentions(text, [mia])).toHaveLength(200_000);
  expect(performance.now() - started).toBeLessThan(2_000);
});

test("what a confirmer confirms of a question is their own pick alone, none while they have not picked, whatever others picked", () => {
  const ballots = [
    { personId: "mia", question: 0, option: 2 },
    { personId: "gus", question: 0, option: 1 },
    { personId: "stan", question: 0, option: 1 },
  ];
  expect([pickOf(ballots, 0, "mia"), pickOf(ballots, 0, "ann"), pickOf(ballots, 1, "mia"), pickOf(ballots, 0, null)]).toEqual([2, null, null, null]);
});

test("an agent tagged while the message was written stays tagged as long as its whole name follows an @, the longest name that fits winning", () => {
  const builder = { id: "p1", name: "Builder" };
  const miasBuilder = { id: "b1", name: "Builder (Mia)" };
  const agents = [builder, miasBuilder];
  const tagsLeftIn = (text: string, tagged = agents) => stillTagged(text, tagged, people, agents).map(({ id }) => id);
  expect(tagsLeftIn("@Builder (Mia) look")).toEqual(["b1"]);
  expect(tagsLeftIn("@Builder (Mia is away) look")).toEqual(["p1"]);
  expect(tagsLeftIn("@Builder (Mia), and @builder")).toEqual(["p1", "b1"]);
  expect(tagsLeftIn("@Builder look", [miasBuilder])).toEqual([]);
  expect(tagsLeftIn("@Builders look, me@Builder")).toEqual([]);
});

test("agents that share a name are each tagged by it, and one no longer offered stays tagged", () => {
  const tagged = [
    { id: "p1", name: "Builder" },
    { id: "p2", name: "builder" },
  ];
  expect(stillTagged("@Builder look", tagged, people, []).map(({ id }) => id)).toEqual(["p1", "p2"]);
});

test("puts a tag in at the caret, a space apart from the word before it", () => {
  expect(withTagAtCaret("", 0, "Builder")).toEqual({ text: "@Builder ", caret: 9 });
  expect(withTagAtCaret("hi", 2, "Builder")).toEqual({ text: "hi @Builder ", caret: 12 });
  expect(withTagAtCaret("hi ", 3, "Builder")).toEqual({ text: "hi @Builder ", caret: 12 });
  expect(withTagAtCaret("go now", 0, "Builder")).toEqual({ text: "@Builder go now", caret: 9 });
  expect(withTagAtCaret("a b", 1, "Builder")).toEqual({ text: "a @Builder b", caret: 11 });
});
