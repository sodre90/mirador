export interface AnsiStyle {
  foreground?: string;
  background?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
}

export interface AnsiRun {
  text: string;
  style: AnsiStyle;
}

const BASE_COLORS = [
  "#1d1f21", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#d0d0d8",
  "#5c6370", "#ff7a85", "#b5e890", "#ffd68a", "#7cc4ff", "#de96f0", "#6fd3df", "#ffffff",
];
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];
const escapeSequence = /\x1b\[([0-9;:?<=>]*)([ -/]*)([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const controlCharacters = /[\x00-\x08\x0b-\x1f\x7f]/g;

const rgb = (red: number, green: number, blue: number) => `rgb(${red}, ${green}, ${blue})`;

export function paletteColor(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0) return undefined;
  if (index < 16) return BASE_COLORS[index];
  if (index < 232) {
    const cube = index - 16;
    return rgb(CUBE_LEVELS[Math.floor(cube / 36)]!, CUBE_LEVELS[Math.floor(cube / 6) % 6]!, CUBE_LEVELS[cube % 6]!);
  }
  if (index < 256) {
    const level = 8 + (index - 232) * 10;
    return rgb(level, level, level);
  }
  return undefined;
}

/** `5;n` picks from the 256-colour palette, `2;r;g;b` is true colour; both arrive split by `;` or as `:` sub-parameters. */
function extendedColor(parameters: string[]): string | undefined {
  const [mode, ...values] = parameters;
  if (mode === "5") return paletteColor(Number(values[0]));
  if (mode === "2" && values.length >= 3) {
    const [red, green, blue] = values.slice(-3).map(Number);
    return [red, green, blue].every((value) => Number.isInteger(value) && value >= 0 && value <= 255) ? rgb(red!, green!, blue!) : undefined;
  }
  return undefined;
}

function takeExtendedColorParameters(queue: string[]): string[] {
  const mode = queue.shift();
  return [mode ?? "", ...queue.splice(0, mode === "2" ? 3 : mode === "5" ? 1 : 0)];
}

function applySgr(current: AnsiStyle, parameters: string): AnsiStyle {
  const style = { ...current };
  const queue = parameters === "" ? ["0"] : parameters.split(";");
  while (queue.length > 0) {
    const [kind = "", ...subParameters] = queue.shift()!.split(":");
    const code = kind === "" ? 0 : Number(kind);
    const colorParameters = () => (subParameters.length > 0 ? subParameters : takeExtendedColorParameters(queue));
    if (code === 0) Object.keys(style).forEach((key) => delete style[key as keyof AnsiStyle]);
    else if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 3) style.italic = true;
    else if (code === 4) style.underline = subParameters[0] !== "0";
    else if (code === 7) style.inverse = true;
    else if (code === 9) style.strikethrough = true;
    else if (code === 22) style.bold = style.dim = false;
    else if (code === 23) style.italic = false;
    else if (code === 24) style.underline = false;
    else if (code === 27) style.inverse = false;
    else if (code === 29) style.strikethrough = false;
    else if (code >= 30 && code <= 37) style.foreground = paletteColor(code - 30);
    else if (code === 38) style.foreground = extendedColor(colorParameters());
    else if (code === 39) delete style.foreground;
    else if (code >= 40 && code <= 47) style.background = paletteColor(code - 40);
    else if (code === 48) style.background = extendedColor(colorParameters());
    else if (code === 49) delete style.background;
    else if (code === 58) colorParameters();
    else if (code >= 90 && code <= 97) style.foreground = paletteColor(code - 90 + 8);
    else if (code >= 100 && code <= 107) style.background = paletteColor(code - 100 + 8);
  }
  return style;
}

/** Splits terminal output into lines of styled runs. Colours and text attributes are kept; cursor movement, titles and other control sequences are dropped. */
export function parseAnsi(text: string): AnsiRun[][] {
  const lines: AnsiRun[][] = [[]];
  let style: AnsiStyle = {};
  const append = (piece: string) =>
    piece
      .replace(controlCharacters, "")
      .split("\n")
      .forEach((part, index) => {
        if (index > 0) lines.push([]);
        if (part) lines.at(-1)!.push({ text: part, style });
      });
  let printedUpTo = 0;
  for (const match of text.matchAll(escapeSequence)) {
    append(text.slice(printedUpTo, match.index));
    printedUpTo = match.index + match[0].length;
    const [, parameters, intermediates, final] = match;
    if (final === "m" && !intermediates && parameters !== undefined && !/[?<=>]/.test(parameters)) style = applySgr(style, parameters);
  }
  append(text.slice(printedUpTo));
  return lines;
}

export const plainTextOf = (lines: AnsiRun[][]) => lines.map((runs) => runs.map(({ text }) => text).join("")).join("\n");
