import { describe, expect, test } from "bun:test";
import { busyTexts, UNTITLED, type JobWait } from "../shared/model.ts";
import { englishNoticeText, type NoticeAbout } from "../shared/notices.ts";
import { en } from "../web/i18n/en/index.ts";
import { noticeText } from "../web/notice-text.ts";
import { shownTitle } from "../web/shown-title.ts";

const wait = (overrides: Partial<JobWait> = {}): JobWait => ({
  id: "w1",
  job: { kind: "process", pid: 42 },
  sshHost: null,
  message: "Run the tests",
  resume: true,
  since: 0,
  ...overrides,
});

const notices: NoticeAbout[] = [
  { kind: "files-put-back", message: "Fix the bug", revert: {} },
  { kind: "files-put-back", message: "Fix the bug", revert: { submodulesLeft: 2, committed: { files: 3, editedSince: 1, commits: 2 } } },
  { kind: "turn-ended", stopReason: "max_tokens" },
  { kind: "turn-ended", stopReason: "cancelled" },
  { kind: "turn-ended", stopReason: "some_new_reason" },
  { kind: "signed-in" },
  { kind: "sign-in-unfinished" },
  { kind: "usage-limit-wait-stopped" },
  { kind: "job-wait-ended", wait: wait(), end: "ended" },
  { kind: "job-wait-ended", wait: wait({ resume: false, job: { kind: "container", name: "db" }, sshHost: "me@box" }), end: "ended" },
  { kind: "job-wait-ended", wait: wait({ sshHost: "me@box" }), end: "gave-up" },
  { kind: "job-wait-ended", wait: wait(), end: "stopped" },
  { kind: "context-cleared" },
  { kind: "profile-changed", profileName: null },
  { kind: "profile-changed", profileName: "Work" },
  { kind: "profile-changed", profileName: "Radiance", agent: "opencode" },
  { kind: "mode", modeId: "plan" },
];

describe("notices", () => {
  test("in English, the page says what the host's search finds", () => {
    for (const about of notices) expect(noticeText(about)).toBe(englishNoticeText(about));
  });
});

describe("busy statuses", () => {
  test("in English, the page says what the host sends as the status detail", () => {
    expect(en.chat.busyWith).toEqual(busyTexts);
  });
});

describe("conversation titles", () => {
  test("the untitled default shows in the page's language, a name the user gave as it is", () => {
    expect(shownTitle({ title: UNTITLED, titleSetByUser: false })).toBe("New conversation");
    expect(shownTitle({ title: "Fix the bug", titleSetByUser: false })).toBe("Fix the bug");
    expect(shownTitle({ title: UNTITLED, titleSetByUser: true })).toBe(UNTITLED);
  });
});
