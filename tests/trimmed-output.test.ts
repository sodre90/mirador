import { expect, test } from "bun:test";
import { TrimmedOutput } from "../host/trimmed-output.ts";

const leadAfter = (...chunks: string[]) => {
  const trimmed = new TrimmedOutput();
  chunks.forEach((chunk) => trimmed.read(chunk));
  return trimmed.lead;
};

test("each mode comes back as the output last switched it, in the order of those last switches", () => {
  expect(leadAfter("\x1b[?1h\x1b[?25l text \x1b[?1049h more\x1b[?1l")).toBe("\x1b[?25l\x1b[?1049h\x1b[?1l");
});

test("a switch of several modes at once comes back as one switch each", () => {
  expect(leadAfter("\x1b[?1000;1006h")).toBe("\x1b[?1000h\x1b[?1006h");
});

test("the keypad's application and numeric modes are one mode", () => {
  expect(leadAfter("\x1b[?1h\x1b=")).toBe("\x1b[?1h\x1b=");
  expect(leadAfter("\x1b=\x1b[?1h\x1b>")).toBe("\x1b[?1h\x1b>");
});

test("a switch a chunk cut in two counts, wherever the cut fell", () => {
  const output = "before\x1b[?1049hafter\x1b=";
  [...output].forEach((_, cut) => expect(leadAfter(output.slice(0, cut), output.slice(cut))).toBe("\x1b[?1049h\x1b="));
});

test("other escapes switch no mode", () => {
  expect(leadAfter("\x1b[1A\x1b[?1$p\x1b[?2J\x1b]0;title\x07\x1b[31m")).toBe("");
});

test("a full reset forgets every mode switched before it", () => {
  expect(leadAfter("\x1b[?1049h\x1b[?1h\x1b=\x1bc")).toBe("");
  expect(leadAfter("\x1b[?1049h\x1bc\x1b[?2004h")).toBe("\x1b[?2004h");
});

test("a soft reset forgets the modes it puts back, but not the screen or the mouse", () => {
  expect(leadAfter("\x1b[?1049h\x1b[?1000h\x1b[?1h\x1b[?2004h\x1b[?25l\x1b=\x1b[!p")).toBe("\x1b[?1049h\x1b[?1000h");
});

test("a mode switch in the C1 form, or with a line break inside, counts as xterm.js carries it out", () => {
  expect(leadAfter("\x9b?1h")).toBe("\x1b[?1h");
  expect(leadAfter("\x1b[?10\r\n49h")).toBe("\x1b[?1049h");
  expect(leadAfter("\x1b[?1\x18h")).toBe("");
});

/** Output as xterm.js reads it, in pieces: text, and sequences, some of them ended only by the ESC that starts the next. */
const pieces: { text: string; endsItself: boolean }[] = [
  { text: "a", endsItself: true },
  { text: "\x1b[1;31m", endsItself: true },
  { text: "red", endsItself: true },
  { text: "\x1b]0;title\x07", endsItself: true },
  { text: "\x1b]8;;https://example.com/a?b=c", endsItself: false },
  { text: "\x1b\\", endsItself: true },
  { text: "link", endsItself: true },
  { text: "\x1bP$q m", endsItself: false },
  { text: "\x1b\\", endsItself: true },
  { text: "\x1b[3\r\n1m", endsItself: true },
  { text: "b", endsItself: true },
  { text: "\x1b(B", endsItself: true },
  { text: "\x1b_apc\x07 still apc", endsItself: false },
  { text: "\x1b\\", endsItself: true },
  { text: "c", endsItself: true },
];
const output = pieces.map(({ text }) => text).join("");

/** What of the sequence a cut fell in comes before it: none in text, or once the sequence has ended. */
function sequenceStartBefore(cut: number) {
  let start = 0;
  for (const { text, endsItself } of pieces) {
    const end = start + text.length;
    const inside = text.startsWith("\x1b") && start < cut && (cut < end || (cut === end && !endsItself));
    if (inside) return text.slice(0, cut - start);
    start = end;
  }
  return "";
}

test("a cut in a sequence puts the sequence's start ahead of the rest, so the replay reads it whole, wherever the cut fell", () => {
  [...output, ""].forEach((_, cut) => {
    expect(leadAfter(output.slice(0, cut))).toBe(sequenceStartBefore(cut));
    expect(leadAfter(output.slice(0, cut), output.slice(cut))).toBe("");
  });
});

test("a cut in a mode switch puts its start ahead, and the switch counts once the rest is read", () => {
  expect(leadAfter("\x1b[?104")).toBe("\x1b[?104");
  expect(leadAfter("\x1b[?104", "9h")).toBe("\x1b[?1049h");
});

test("a cut in a sequence too long to keep puts a start ahead that makes xterm.js ignore the rest", () => {
  const payload = "QUJD".repeat(5_000);
  const longLead = (introducer: string) => leadAfter(`${introducer}${payload.slice(0, 10_000)}`);
  expect(longLead("\x1b]52;c;")).toBe("\x1b]?");
  expect(longLead("\x1bPq")).toBe("\x1bP??");
  expect(longLead("\x1b_")).toBe("\x1b_");
  expect(leadAfter(`\x1b[${"1;".repeat(5_000)}`)).toBe("\x1b[??");
  expect(leadAfter(`\x1b]52;c;${payload}`, "\x07\x1b[?1h")).toBe("\x1b[?1h");
});
