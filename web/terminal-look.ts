import type { ITheme } from "@xterm/xterm";
import { paletteColor } from "./ansi.ts";

/** Prompts and statusline scripts draw with Nerd Font glyphs; the first of these the Mac has renders them. */
export const TERMINAL_FONT = '"MesloLGS NF", "Symbols Nerd Font Mono", "JetBrainsMono Nerd Font", "Hack Nerd Font", Menlo, monospace';
export const TERMINAL_BACKGROUND = "#1b1c22";
export const TERMINAL_FOREGROUND = "#d4d6de";

/**
 * The statusline strip follows the app theme. Scripts colour themselves for dark terminals, so on the light strip a
 * colour drawn straight on it is darkened until it reads; one on a background of its own stays as the script drew it.
 */
export const statuslineLooks = {
  dark: { background: TERMINAL_BACKGROUND, foreground: TERMINAL_FOREGROUND, minimumContrast: 1 },
  light: { background: "#f3f4f6", foreground: "#24262d", minimumContrast: 4.5 },
} as const;

export type StatuslineLook = (typeof statuslineLooks)[keyof typeof statuslineLooks];

const boxDrawingAndBlocks = /[\u2500-\u259f]/u;
const powerlineGlyphs = /[\ue0a0-\ue0d7]/u;

/** Powerline caps and box drawing take the colour of the block they join, so, as in xterm.js, no minimum contrast applies to them. */
export const drawsShapesOnly = (text: string) =>
  [...text].every((character) => /\s/u.test(character) || boxDrawingAndBlocks.test(character) || powerlineGlyphs.test(character));

const ansiNames = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
const capitalized = (name: string) => name[0]!.toUpperCase() + name.slice(1);

export type TerminalPreset = "default" | "dracula" | "solarized-dark" | "nord" | "monokai";

export const terminalPresetLabels: Record<TerminalPreset, string> = {
  default: "Mirador",
  dracula: "Dracula",
  "solarized-dark": "Solarized Dark",
  nord: "Nord",
  monokai: "Monokai",
};

type Ansi16 = readonly [
  string, string, string, string, string, string, string, string,
  string, string, string, string, string, string, string, string,
];

const themeFrom = (background: string, foreground: string, cursor: string, selectionBackground: string, ansi: Ansi16): ITheme => ({
  background,
  foreground,
  cursor,
  selectionBackground,
  black: ansi[0],
  red: ansi[1],
  green: ansi[2],
  yellow: ansi[3],
  blue: ansi[4],
  magenta: ansi[5],
  cyan: ansi[6],
  white: ansi[7],
  brightBlack: ansi[8],
  brightRed: ansi[9],
  brightGreen: ansi[10],
  brightYellow: ansi[11],
  brightBlue: ansi[12],
  brightMagenta: ansi[13],
  brightCyan: ansi[14],
  brightWhite: ansi[15],
});

/** The same dark look and colours the statusline uses, in both app themes. */
export const terminalTheme: ITheme = {
  background: TERMINAL_BACKGROUND,
  foreground: TERMINAL_FOREGROUND,
  cursor: TERMINAL_FOREGROUND,
  selectionBackground: "rgb(124 196 255 / 0.3)",
  ...Object.fromEntries(ansiNames.flatMap((name, index) => [[name, paletteColor(index)], [`bright${capitalized(name)}`, paletteColor(index + 8)]])),
};

export const draculaTheme: ITheme = themeFrom(
  "#282a36",
  "#f8f8f2",
  "#f8f8f2",
  "rgb(68 71 90 / 0.5)",
  [
    "#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2",
    "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff",
  ],
);

export const solarizedDarkTheme: ITheme = themeFrom(
  "#002b36",
  "#839496",
  "#93a1a1",
  "rgb(7 54 66 / 0.6)",
  [
    "#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
    "#586e75", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3",
  ],
);

export const nordTheme: ITheme = themeFrom(
  "#2e3440",
  "#d8dee9",
  "#d8dee9",
  "rgb(67 76 94 / 0.6)",
  [
    "#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0",
    "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4",
  ],
);

export const monokaiTheme: ITheme = themeFrom(
  "#272822",
  "#f8f8f2",
  "#f8f8f0",
  "rgb(73 72 62 / 0.6)",
  [
    "#272822", "#f92672", "#a6e22e", "#e6db74", "#66d9ef", "#ae81ff", "#a1efe4", "#f8f8f2",
    "#75715e", "#f92672", "#a6e22e", "#e6db74", "#66d9ef", "#ae81ff", "#a1efe4", "#f9f8f5",
  ],
);

export const TERMINAL_PRESET_THEMES: Record<TerminalPreset, ITheme> = {
  default: terminalTheme,
  dracula: draculaTheme,
  "solarized-dark": solarizedDarkTheme,
  nord: nordTheme,
  monokai: monokaiTheme,
};

export const terminalPresetTheme = (preset: TerminalPreset): ITheme => TERMINAL_PRESET_THEMES[preset] ?? terminalTheme;
