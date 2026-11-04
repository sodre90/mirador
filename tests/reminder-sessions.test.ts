import { expect, test } from "bun:test";
import { sessionIsSettled, type SessionUse } from "../host/conversations.ts";

const idle: SessionUse = {
  running: false,
  holdingQueue: false,
  queuedMessages: 0,
  pendingPermissions: 0,
  waitingAsk: false,
  usageLimitWait: false,
  jobWaitsThatResume: 0,
  asyncTasks: 0,
  watched: false,
};

test("a put-away conversation's session is freed only once nothing could still need it", () => {
  expect(sessionIsSettled(idle)).toBe(true);
  const stillNeeded: Partial<SessionUse>[] = [
    { running: true },
    { holdingQueue: true },
    { queuedMessages: 1 },
    { pendingPermissions: 1 },
    { waitingAsk: true },
    { usageLimitWait: true },
    { jobWaitsThatResume: 1 },
    { asyncTasks: 1 },
    { watched: true },
  ];
  stillNeeded.forEach((use) => expect(sessionIsSettled({ ...idle, ...use })).toBe(false));
});
