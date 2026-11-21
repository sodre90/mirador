import { describe, expect, test } from "bun:test";
import { WRITING_SIGNAL_EVERY_MS } from "../shared/rooms.ts";
import { writersIn, writingLine, WritingSignals } from "../web/room-writing.ts";

function signalsWithClock() {
  let now = 0;
  const told: boolean[] = [];
  const signals = new WritingSignals(
    (writing) => told.push(writing),
    () => now,
  );
  return { signals, told, wait: (ms: number) => (now += ms) };
}

describe("telling the host you write", () => {
  test("tells it at the first keystroke, then at most every few seconds while you go on", () => {
    const { signals, told, wait } = signalsWithClock();
    signals.typed("H");
    signals.typed("He");
    wait(WRITING_SIGNAL_EVERY_MS - 1);
    signals.typed("Hel");
    expect(told).toEqual([true]);
    wait(1);
    signals.typed("Hell");
    expect(told).toEqual([true, true]);
  });

  test("tells it you stopped when you empty the box, once, and only after it was told you write", () => {
    const { signals, told } = signalsWithClock();
    signals.typed("");
    expect(told).toEqual([]);
    signals.typed("Hi");
    signals.typed("  ");
    signals.typed("");
    signals.stopped();
    expect(told).toEqual([true, false]);
  });

  test("after a message goes, tells it again at the first keystroke of the next, and nothing as the box empties", () => {
    const { signals, told } = signalsWithClock();
    signals.typed("First");
    signals.sent();
    signals.typed("");
    signals.typed("S");
    expect(told).toEqual([true, true]);
  });
});

describe("who writes", () => {
  const writing = [
    { personId: "ann", threadId: null },
    { personId: "bela", threadId: "t1" },
    { personId: "you", threadId: null },
  ];

  test("in the room or in a thread, you left out", () => {
    expect(writersIn(writing, null, "you")).toEqual(["ann"]);
    expect(writersIn(writing, "t1", "you")).toEqual(["bela"]);
    expect(writersIn(writing, "t2", "you")).toEqual([]);
  });

  test("names one or two, and says several for more", () => {
    expect([writingLine([]), writingLine(["Ann"]), writingLine(["Ann", "Béla"]), writingLine(["Ann", "Béla", "Cecil"])]).toEqual([
      null,
      "Ann is writing…",
      "Ann and Béla are writing…",
      "Several people are writing…",
    ]);
  });
});
