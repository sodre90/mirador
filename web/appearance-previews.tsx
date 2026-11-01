import { commandShownClosed, outputStartsOpen, type ShellOutputStyle } from "../shared/shell-output.ts";
import type { ShellLook } from "./shell-look.ts";
import { BASE_TEXT_PX, FONT_SCALES, type FontScale } from "./font-scale.ts";
import type { MachineColorStyle } from "./machine-colors.ts";
import { pastelVariables } from "./pastels.ts";
import type { Theme } from "./theme.ts";
import type { WaitingStyle } from "./waiting.ts";
import type { WorkspaceColorStyle } from "./workspace-colors.ts";
import { t } from "./i18n/index.ts";

const Line = ({ width, strong = false }: { width: number; strong?: boolean }) => (
  <span className={`preview-line ${strong ? "strong" : ""}`} style={{ width: `${width}%` }} />
);

function MiniWindow({ scheme }: { scheme: "light" | "dark" }) {
  return (
    <span className={`preview-window theme-scope ${scheme}`}>
      <span className="preview-rail">
        <Line width={70} strong />
        <Line width={55} />
        <Line width={62} />
      </span>
      <span className="preview-chat">
        <span className="preview-bubble" />
        <Line width={90} />
        <Line width={70} />
      </span>
    </span>
  );
}

/** The app in the theme's own colours; matching the system shows light and dark split across the corner. */
export function ThemePreview({ theme }: { theme: Theme }) {
  if (theme !== "system") return <MiniWindow scheme={theme} />;
  return (
    <span className="preview-split">
      <MiniWindow scheme="light" />
      <MiniWindow scheme="dark" />
    </span>
  );
}

function WaitingRow({ style, waits }: { style: WaitingStyle; waits: boolean }) {
  return (
    <span className="preview-row">
      <span className={`preview-dot ${waits ? "waiting" : ""} ${waits && style === "dots" ? "glowing" : ""}`} />
      <Line width={waits && style === "dots" ? 62 : 48} strong={waits && style === "dots"} />
      {waits && style !== "dots" && <span className="preview-pill">{t.shell.sidebar.waiting.decision}</span>}
    </span>
  );
}

/** A workspace with one conversation waiting for a decision, marked the way the style marks it. */
export function WaitingPreview({ style }: { style: WaitingStyle }) {
  return (
    <span className="preview-sidebar">
      {style === "list" && (
        <span className="preview-waiting-list">
          <WaitingRow style={style} waits />
        </span>
      )}
      <span className="preview-card">
        <span className="preview-row heading">
          <Line width={50} strong />
          {style !== "dots" && <span className="preview-count">1</span>}
        </span>
        <WaitingRow style={style} waits />
        <WaitingRow style={style} waits={false} />
      </span>
    </span>
  );
}

/** "Aa" as chat text at the size this step gives it. */
export function FontSizePreview({ scale }: { scale: FontScale }) {
  return (
    <span className="preview-window">
      <span className="preview-text-sample" style={{ fontSize: `${FONT_SCALES[scale] * BASE_TEXT_PX}px` }}>
        Aa
      </span>
    </span>
  );
}

/** A lavender workspace's card, coloured the way the style colours it. */
export function WorkspaceColorPreview({ style }: { style: WorkspaceColorStyle }) {
  return (
    <span className="preview-sidebar">
      <span className={`preview-card coloured-${style}`} style={pastelVariables("lavender")}>
        <span className="preview-row heading">
          <span className="preview-mark">Mi</span>
          <Line width={50} strong />
        </span>
        <span className="preview-row">
          <Line width={70} />
        </span>
        <span className="preview-row">
          <Line width={55} />
        </span>
      </span>
    </span>
  );
}

/** A sky machine shown next to the rail, marked the way the style marks it. */
export function MachineColorPreview({ style }: { style: MachineColorStyle }) {
  return (
    <span className="preview-window" style={pastelVariables("sky")}>
      <span className="preview-machine-rail">
        <span className="preview-rail-button" />
        <span className="preview-rail-button coloured" />
      </span>
      <span className={`preview-chat ${style === "strip" ? "striped" : ""}`}>
        <span className="preview-bubble" />
        <Line width={90} />
        <Line width={70} />
      </span>
    </span>
  );
}

function ShellRow({ style, failed }: { style: ShellOutputStyle; failed: boolean }) {
  return (
    <span className="preview-shell">
      <span className="preview-row">
        <span className={`preview-dot ${failed ? "failed" : "done"}`} />
        <Line width={55} strong />
      </span>
      {commandShownClosed(style) && (
        <span className="preview-shell-body">
          <Line width={60} />
        </span>
      )}
      {outputStartsOpen(style, failed) && (
        <span className="preview-shell-body output">
          {!commandShownClosed(style) && <Line width={60} />}
          <Line width={80} />
          <Line width={45} />
        </span>
      )}
    </span>
  );
}

/** A command that worked and one that failed, each shown as the style shows it before it is opened. */
export function ShellOutputPreview({ style }: { style: ShellOutputStyle }) {
  return (
    <span className="preview-sidebar">
      <ShellRow style={style} failed={false} />
      <ShellRow style={style} failed />
    </span>
  );
}

/** A shell card as the chat shows it: its header, then the command and its output in the look's colours. */
export function ShellLookPreview({ look }: { look: ShellLook }) {
  return (
    <span className="preview-window preview-shell-look" data-shell-look={look}>
      <span className="preview-shell-card">
        <span className="preview-row">
          <span className="preview-dot done" />
          <Line width={50} strong />
        </span>
        <span className="preview-shell-look-body">
          <span>
            <span className="prompt">$</span> <span className="typed">bun test</span>
          </span>
          <span>12 pass</span>
          <span className="link">{t.chat.tool.showMoreLines(8)}</span>
        </span>
      </span>
    </span>
  );
}
