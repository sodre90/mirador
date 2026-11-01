type Kind = "ground" | "escape" | "csi" | "osc" | "dcs" | "ignored-string";

const codeOf = (character: string) => character.charCodeAt(0);

const ESC = 0x1b;
const BEL = 0x07;
const CAN = 0x18;
const SUB = 0x1a;

/** What ESC directly followed by these starts. */
const AFTER_ESC = new Map<number, Kind>([
  [codeOf("["), "csi"],
  [codeOf("]"), "osc"],
  [codeOf("P"), "dcs"],
  [codeOf("X"), "ignored-string"],
  [codeOf("^"), "ignored-string"],
  [codeOf("_"), "ignored-string"],
]);

/** The C1 controls that start a sequence: CSI, OSC, DCS, SOS, PM and APC. Every other one ends any sequence. */
const C1_STARTS = new Map<number, Kind>([
  [0x9b, "csi"],
  [0x9d, "osc"],
  [0x90, "dcs"],
  [0x98, "ignored-string"],
  [0x9e, "ignored-string"],
  [0x9f, "ignored-string"],
]);

/** For the kinds whose other characters change nothing: the characters that can end a sequence or start one. */
const STOPS: Partial<Record<Kind, RegExp>> = {
  ground: /[\x1b\x90\x98\x9b\x9d\x9e\x9f]/g,
  osc: /[\x07\x18\x1a\x1b\x80-\x9f]/g,
  dcs: /[\x18\x1a\x1b\x80-\x9f]/g,
  "ignored-string": /[\x18\x1a\x1b\x80-\x9f]/g,
};

function nextStop(kind: Kind, text: string, from: number) {
  const stops = STOPS[kind];
  if (!stops) return from;
  stops.lastIndex = from;
  return stops.exec(text)?.index ?? text.length;
}

const isC1Control = (code: number) => code >= 0x80 && code <= 0x9f;
const isIntermediate = (code: number) => code >= 0x20 && code <= 0x2f;
const isEscapeFinal = (code: number) => code >= 0x30 && code <= 0x7e;
const isFinal = (code: number) => code >= 0x40 && code <= 0x7e;
const isNonAscii = (code: number) => code >= 0xa0;

/** The finals of the control sequences that switch modes, or put them back with a soft reset. */
const MODE_FINALS = new Set(["h", "l", "p"].map(codeOf));

/** C0 controls inside a sequence are carried out, and DEL is ignored, without ending it. */
const withoutControls = (text: string) => text.replace(/[\x00-\x1f\x7f]/g, "");

const controlSequence = /^(?<prefix>[<=>?]?)(?<parameters>[\d;:]*)(?<intermediates>[ -/]*)(?<final>[@-~])$/;

const MAX_UNFINISHED_SEQUENCE = 4096;

/**
 * Starts that xterm.js reads to the end of the sequence and then ignores: a CSI or DCS with a second prefix, an OSC
 * whose number is no number, an APC. An escape sequence grows only by intermediates and controls; one that long is
 * given up.
 */
const IGNORED_START: Partial<Record<Kind, string>> = {
  csi: "\x1b[??",
  osc: "\x1b]?",
  dcs: "\x1bP??",
  "ignored-string": "\x1b_",
};

const startToKeep = (kind: Kind, sequence: string) => (sequence.length <= MAX_UNFINISHED_SEQUENCE ? sequence : (IGNORED_START[kind] ?? ""));

const KEYPAD = "keypad";

/**
 * What xterm.js's soft reset puts back: cursor and keypad keys, bracketed paste, cursor blink and visibility, origin
 * mode, wraparound, reverse wraparound, focus reports and synchronized output. The screen and the mouse stay as they are.
 */
const SOFT_RESET_MODES = ["1", KEYPAD, "2004", "12", "25", "6", "7", "45", "1004", "2026"];

/**
 * The output a terminal's scrollback no longer holds, read as far as a replay of the rest needs it: the modes it
 * switched, each as it last switched it, and the start of the escape sequence it was cut in. A full-screen program
 * switches application cursor keys on once as it starts, and without them the arrow keys send what it doesn't read as
 * arrows; a sequence the cut leaves without its start would print its rest as text. Sequences are read as xterm.js's
 * parser reads them (https://vt100.net/emu/dec_ansi_parser): ESC, CAN, SUB and the C1 controls end any, and BEL ends
 * an OSC but not a DCS, SOS, PM or APC.
 */
export class TrimmedOutput {
  private readonly modes = new Map<string, string>();
  /** The start of the sequence the output read so far ends in; reading goes on from it, as from the ground state. */
  private unfinished = "";

  read(output: string) {
    const text = this.unfinished + output;
    let kind: Kind = "ground";
    let start = 0;
    let bodyStart = 0;
    let escapeHasIntermediates = false;
    for (let at = nextStop(kind, text, 0); at < text.length; at = nextStop(kind, text, at + 1)) {
      const code = text.charCodeAt(at);
      const started = code === ESC ? "escape" : C1_STARTS.get(code);
      if (started) {
        [kind, start, bodyStart, escapeHasIntermediates] = [started, at, at + 1, false];
      } else if (code === CAN || code === SUB || isC1Control(code)) {
        kind = "ground";
      } else if (kind === "escape") {
        const after = escapeHasIntermediates ? undefined : AFTER_ESC.get(code);
        if (after) [kind, bodyStart] = [after, at + 1];
        else if (isIntermediate(code)) escapeHasIntermediates = true;
        else if (isEscapeFinal(code)) {
          if (!escapeHasIntermediates) this.dispatchEscape(text[at]!);
          kind = "ground";
        } else if (isNonAscii(code)) kind = "ground";
      } else if (kind === "csi") {
        if (isFinal(code)) {
          if (MODE_FINALS.has(code)) this.dispatchControlSequence(withoutControls(text.slice(bodyStart, at + 1)));
          kind = "ground";
        } else if (isNonAscii(code)) kind = "ground";
      } else if (kind === "osc" && code === BEL) {
        kind = "ground";
      }
    }
    this.unfinished = kind === "ground" ? "" : startToKeep(kind, text.slice(start));
  }

  /** What a replay of the output the scrollback still holds sends ahead of it. */
  get lead() {
    return [...this.modes.values()].join("") + this.unfinished;
  }

  private dispatchEscape(final: string) {
    if (final === "=" || final === ">") this.switched(KEYPAD, `\x1b${final}`);
    else if (final === "c") this.modes.clear();
  }

  private dispatchControlSequence(body: string) {
    const { prefix, parameters, intermediates, final } = controlSequence.exec(body)?.groups ?? {};
    if (prefix === "?" && intermediates === "" && (final === "h" || final === "l")) {
      parameters!.split(";").filter(Boolean).forEach((mode) => this.switched(mode, `\x1b[?${mode}${final}`));
    } else if (prefix === "" && intermediates === "!" && final === "p") {
      SOFT_RESET_MODES.forEach((mode) => this.modes.delete(mode));
    }
  }

  private switched(mode: string, sequence: string) {
    this.modes.delete(mode);
    this.modes.set(mode, sequence);
  }
}
