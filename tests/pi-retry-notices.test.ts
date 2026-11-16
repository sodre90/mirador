import { expect, test } from "bun:test";

const retryNoticesModule = "pi-acp/dist/retry-notices.js";
type RetryEvent = { attempt?: unknown; maxAttempts?: unknown; delayMs?: unknown; errorMessage?: unknown };
type Notice = { sessionUpdate: string; severity: string; title: string; description?: string };
const { retryNotice, gaveUpNotice } = (await import(retryNoticesModule)) as { retryNotice: (event: RetryEvent) => Notice; gaveUpNotice: (event: RetryEvent) => Notice };

const RATE_LIMITED = 'gateway API error (429): {"message":"Rate limit exceeded for team. Limit type: tokens.","type":"throttling_error"}';

test("each pi retry is a warning notice that says which attempt, how long it waits and why the request failed", () => {
  expect(retryNotice({ attempt: 1, maxAttempts: 3, delayMs: 15_000, errorMessage: RATE_LIMITED })).toEqual({
    sessionUpdate: "notice",
    severity: "warning",
    title: "Retrying (attempt 1/3, waiting 15s)",
    description: RATE_LIMITED,
  });
});

test("a wait under a second still says a second, and a retry pi describes oddly still reads as a retry", () => {
  expect(retryNotice({ attempt: 2, maxAttempts: 3, delayMs: 200 }).title).toBe("Retrying (attempt 2/3, waiting 1s)");
  expect(retryNotice({ attempt: 2, maxAttempts: 3, delayMs: 0 }).title).toBe("Retrying (attempt 2/3, waiting 0s)");
  expect(retryNotice({})).toEqual({ sessionUpdate: "notice", severity: "warning", title: "Retrying" });
});

test("when pi stops retrying, the notice says how many retries it made", () => {
  expect(gaveUpNotice({ attempt: 3 }).title).toBe("Gave up after 3 retries");
  expect(gaveUpNotice({ attempt: 1 }).title).toBe("Gave up after 1 retry");
  expect(gaveUpNotice({}).title).toBe("Gave up retrying");
});
