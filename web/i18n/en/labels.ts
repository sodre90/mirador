import type { CanvasUse, KeepAwake, Pastel } from "../../../shared/model.ts";
import type { PageLibraries } from "../../../shared/canvas-export.ts";
import type { ShellOutputStyle } from "../../../shared/shell-output.ts";
import type { EnterWhileBusy } from "../../busy-sending.ts";
import type { HideablePane, PaneId } from "../../layout.ts";
import type { MachineColorStyle } from "../../machine-colors.ts";
import type { FormatBarChoice, MessageBox } from "../../message-box.ts";
import type { ShellColours, ShellLook } from "../../shell-look.ts";
import type { SettingsPage } from "../../state.ts";
import type { TerminalCursorStyle } from "../../terminal-settings.ts";
import type { Theme } from "../../theme.ts";
import type { WaitingStyle } from "../../waiting.ts";
import type { WorkspaceColorStyle } from "../../workspace-colors.ts";

export const labels = {
  theme: { light: "Light", dark: "Dark", system: "Match system" } satisfies Record<Theme, string>,
  waitingStyle: { pills: "Pill and count", dots: "Dot only", list: "Pills and a list on top" } satisfies Record<WaitingStyle, string>,
  workspaceColorStyle: { card: "Whole card", heading: "Heading only", stripe: "Stripe and soft tint" } satisfies Record<WorkspaceColorStyle, string>,
  machineColorStyle: { rail: "Rail button only", strip: "Rail button and a strip on its view" } satisfies Record<MachineColorStyle, string>,
  shellOutputStyle: {
    command: "Command, output when opened",
    "failures-open": "Command, output open when it failed",
    "one-line": "One line",
    open: "Command and output",
  } satisfies Record<ShellOutputStyle, string>,
  shellLook: {
    theme: "Follow the theme",
    "terminal-dark": "Terminal dark",
    "soft-dark": "Soft dark",
    paper: "Paper",
    custom: "Custom",
  } satisfies Record<ShellLook, string>,
  shellColour: { background: "Background", text: "Text", prompt: "Prompt" } satisfies Record<keyof ShellColours, string>,
  messageBox: { plain: "Plain text", formatted: "Formats as you type" } satisfies Record<MessageBox, string>,
  formatBar: { hidden: "Hidden until Aa", shown: "Shown" } satisfies Record<FormatBarChoice, string>,
  enterWhileBusy: { steer: "Adds the message to the running turn", "after-turn": "Sends the message after the turn ends" } satisfies Record<EnterWhileBusy, string>,
  cursorStyle: { block: "Block", underline: "Underline", bar: "Bar" } satisfies Record<TerminalCursorStyle, string>,
  canvasUse: { "as-needed": "As needed", often: "Often" } satisfies Record<CanvasUse, string>,
  keepAwake: { never: "Never", "while-working": "While agents work", always: "Always" } satisfies Record<KeepAwake, string>,
  pageLibraries: {
    cdn: "From a public CDN: small files that need a network connection to draw",
    inline: "Inside the file: works offline, but Mermaid adds about 3 MB",
  } satisfies Record<PageLibraries, string>,
  pastel: {
    rose: "Rose",
    peach: "Peach",
    butter: "Butter",
    mint: "Mint",
    teal: "Teal",
    sky: "Sky",
    lavender: "Lavender",
    lilac: "Lilac",
  } satisfies Record<Pastel, string>,
  noColour: "No colour",
  noProfile: "No profile",
  pane: { conversation: "Conversation", canvas: "Canvas", terminals: "Terminals" } satisfies Record<PaneId, string>,
  thumbnail: { conversation: "Chat", canvas: "Canvas", terminals: "Terminals" } satisfies Record<PaneId, string>,
  startHidden: { canvas: "Canvas starts hidden", terminals: "Terminals start hidden" } satisfies Record<HideablePane, string>,
  settingsPage: {
    appearance: "Appearance",
    conversations: "Conversations",
    agents: "Agents",
    voice: "Voice",
    terminal: "Terminal",
    canvas: "Canvas",
    plugins: "Plugins",
    layout: "Layout",
    devices: "Devices",
    notifications: "Notifications",
    about: "About",
  } satisfies Record<SettingsPage, string>,
};
