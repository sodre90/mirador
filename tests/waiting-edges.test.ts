import { expect, test } from "bun:test";
import type { Conversation } from "../shared/model.ts";
import { coveredByHeading, waitingInFoldedGroup, waitingOutOfView, type WaitingMark } from "../web/waiting-edges.ts";

const view = { top: 100, bottom: 500 };
const row = (top: number, tone: WaitingMark["tone"] = "decision", count = 1): WaitingMark => ({ top, bottom: top + 28, count, tone });
const conversation = (waitingFor: Conversation["waitingFor"]) => ({ waitingFor }) as Conversation;

test("nothing is out of view while every waiting row shows, even in part", () => {
  expect(waitingOutOfView([row(80), row(300), row(480)], view)).toEqual({ above: null, below: null });
});

test("rows wholly above or below the view count on their side, the most urgent of them setting the tone", () => {
  expect(waitingOutOfView([row(10, "done"), row(60, "failed"), row(300, "decision"), row(520, "done")], view)).toEqual({
    above: { count: 2, tone: "failed" },
    below: { count: 1, tone: "done" },
  });
});

test("a folded group's heading counts every conversation waiting in it", () => {
  expect(waitingOutOfView([row(600, "done", 3), row(700, "decision")], view)).toEqual({ above: null, below: { count: 4, tone: "decision" } });
});

test("a folded group stands for its conversations waiting for you, and for nothing when none waits", () => {
  expect(waitingInFoldedGroup([conversation(null), conversation("finished"), conversation("question")])).toEqual({ count: 2, tone: "decision" });
  expect(waitingInFoldedGroup([conversation(null), conversation(null)])).toBeNull();
});

test("a heading stuck at the top of the list covers it as far down as it reaches, and one pushed out by the next only as far as still shows", () => {
  expect(coveredByHeading([{ top: 100, bottom: 140 }, { top: 400, bottom: 440 }], 100)).toBe(40);
  expect(coveredByHeading([{ top: 85, bottom: 125 }, { top: 125, bottom: 165 }], 100)).toBe(25);
});

test("no heading covers the list while none is at its top, or the one there has scrolled away", () => {
  expect(coveredByHeading([{ top: 130, bottom: 170 }], 100)).toBe(0);
  expect(coveredByHeading([{ top: 20, bottom: 60 }], 100)).toBe(0);
  expect(coveredByHeading([], 100)).toBe(0);
});
