import { describe, expect, test } from "bun:test";
import { isReminder, parseReminderTime, reminderCommandIn, reminderFromCommand, reminderPresets } from "../shared/reminders.ts";


/** Wednesday 4 Nov 2026 at the given local time. */
const wednesday = (hours: number, minutes = 0) => new Date(2026, 10, 4, hours, minutes);
const local = (date: Date | undefined) =>
  date && `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()]} ${date.getDate()}/${date.getMonth() + 1} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const parsed = (text: string, now = wednesday(14), morning?: number) => local(parseReminderTime(text, now, morning)?.at);

describe("reminder times", () => {
  test("a bare time is the next one ahead: today if still to come, else tomorrow", () => {
    expect(parsed("16")).toBe("Wed 4/11 16:00");
    expect(parsed("9")).toBe("Thu 5/11 09:00");
    expect(parsed("9:30pm")).toBe("Wed 4/11 21:30");
    expect(parsed("at 7 am")).toBe("Thu 5/11 07:00");
    expect(parsed("noon")).toBe("Thu 5/11 12:00");
  });

  test("tomorrow and weekdays default to the morning, which Settings can move", () => {
    expect(parsed("tomorrow")).toBe("Thu 5/11 09:00");
    expect(parsed("tomorrow 14:30")).toBe("Thu 5/11 14:30");
    expect(parsed("tomorrow", wednesday(14), 8 * 60 + 30)).toBe("Thu 5/11 08:30");
    expect(parsed("fri")).toBe("Fri 6/11 09:00");
    expect(parsed("Friday 14:30")).toBe("Fri 6/11 14:30");
  });

  test("a weekday that is today means next week's", () => {
    expect(parsed("wed")).toBe("Wed 11/11 09:00");
    expect(parsed("next week")).toBe("Mon 9/11 09:00");
  });

  test("after midnight, tomorrow is still the morning ahead", () => {
    expect(parsed("tomorrow", wednesday(1, 30))).toBe("Wed 4/11 09:00");
    expect(parsed("tomorrow", wednesday(8))).toBe("Thu 5/11 09:00");
  });

  test("this evening is today's, or tomorrow's once it has passed", () => {
    expect(parsed("tonight")).toBe("Wed 4/11 18:00");
    expect(parsed("evening", wednesday(19))).toBe("Thu 5/11 18:00");
    expect(parsed("today", wednesday(19))).toBeUndefined();
  });

  test("durations count from now", () => {
    expect(parsed("3h")).toBe("Wed 4/11 17:00");
    expect(parsed("in 30 min")).toBe("Wed 4/11 14:30");
    expect(parsed("2 days")).toBe("Fri 6/11 14:00");
  });

  test("words that name no time give nothing", () => {
    expect(parsed("fix the bug")).toBeUndefined();
    expect(parsed("25")).toBeUndefined();
    expect(parsed("9:75")).toBeUndefined();
    expect(parsed("")).toBeUndefined();
  });

  test("what follows the time is the note", () => {
    expect(parseReminderTime("tomorrow 9 pick up the flaky e2e", wednesday(14))?.rest).toBe("pick up the flaky e2e");
    expect(parseReminderTime("3h  check   CI", wednesday(14))?.rest).toBe("check CI");
  });

  test("days keep their clock time across a clock change (25 Oct 2026 in Europe)", () => {
    const beforeChange = new Date(2026, 9, 24, 14);
    expect(local(parseReminderTime("tomorrow", beforeChange)?.at)).toBe("Sun 25/10 09:00");
    expect(local(parseReminderTime("mon", beforeChange)?.at)).toBe("Mon 26/10 09:00");
  });
});

describe("reminder presets", () => {
  test("offers this evening only while it is at least an hour away", () => {
    expect(reminderPresets(wednesday(14)).map(({ id, at }) => `${id} ${local(at)}`)).toEqual([
      "tomorrow-morning Thu 5/11 09:00",
      "in-3-hours Wed 4/11 17:00",
      "this-evening Wed 4/11 18:00",
      "next-week Mon 9/11 09:00",
    ]);
    expect(reminderPresets(wednesday(17, 30)).map(({ id }) => id)).not.toContain("this-evening");
  });

  test("next week on a Monday is the Monday after", () => {
    expect(local(reminderPresets(new Date(2026, 10, 9, 10)).find(({ id }) => id === "next-week")?.at)).toBe("Mon 16/11 09:00");
  });
});

describe("reminder commands", () => {
  test("/later puts away and /remind keeps, with what follows as time and note", () => {
    expect(reminderCommandIn("/later tomorrow 9 the e2e")).toEqual({ mode: "away", writtenArguments: "tomorrow 9 the e2e" });
    expect(reminderCommandIn(" /remind ")).toEqual({ mode: "keep", writtenArguments: "" });
    expect(reminderCommandIn("/laterx")).toBeNull();
    expect(reminderCommandIn("please /later")).toBeNull();
  });

  test("a command's reminder carries its time and note", () => {
    const reminder = reminderFromCommand({ mode: "away", writtenArguments: "16 the e2e" }, wednesday(14));
    expect(reminder).toEqual({ at: wednesday(16).getTime(), mode: "away", note: "the e2e" });
    expect(reminderFromCommand({ mode: "keep", writtenArguments: "16" }, wednesday(14))).toEqual({ at: wednesday(16).getTime(), mode: "keep" });
    expect(reminderFromCommand({ mode: "keep", writtenArguments: "soon" }, wednesday(14))).toBeNull();
  });

  test("checks what a client sends", () => {
    expect(isReminder({ at: 1, mode: "keep" })).toBe(true);
    expect(isReminder({ at: 1, mode: "away", note: "x" })).toBe(true);
    expect(isReminder({ at: "1", mode: "keep" })).toBe(false);
    expect(isReminder({ at: 1, mode: "later" })).toBe(false);
    expect(isReminder({ at: 1, mode: "keep", note: "x".repeat(201) })).toBe(false);
  });
});
