import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { chosenModel, withMultiplier } from "../shared/config-options.ts";
import type { ContextUsage, Conversation, PlanQuotas, Profile, QuotaWindow, StatuslineRender } from "../shared/model.ts";
import { parseAnsi, plainTextOf, type AnsiRun } from "./ansi.ts";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { describedText } from "./host-error.ts";
import { t } from "./i18n/index.ts";
import { readableOn } from "./readable-color.ts";
import { ProfileDot } from "./ProfileDot.tsx";
import { drawsShapesOnly, statuslineLooks, type StatuslineLook } from "./terminal-look.ts";
import { terminalFontList, useTerminalSettings } from "./terminal-settings.ts";
import { useShownTheme } from "./theme.ts";
import {
  compactTokenCount,
  contextHint,
  contextLevel,
  formatCost,
  formatCredits,
  QUOTA_NAMES,
  quotaLabels,
  quotaPercentLabel,
  quotaShare,
  timeUntil,
  usedPercentLabel,
  usedShare,
  type QuotaName,
} from "./usage.ts";

const TERMINAL_FONT_SIZE = 12;
const TERMINAL_PADDING_X = 8;
const words = t.shell.statusline;

const REQUEST_DELAY_MS = 300;
const REFRESH_MS = 30_000;
const PREFERENCE_KEY = "mirador-statusline";

/** Shown again at once when the user comes back to a conversation, while a fresh render is made. */
const lastRenders = new Map<string, StatuslineRender>();

export function ContextMeter({ usage }: { usage: ContextUsage }) {
  const share = usedShare(usage);
  return (
    <span className={`usage-meter context-meter level-${contextLevel(share)}`} data-hint={contextHint(usage)} aria-label={words.context(usedPercentLabel(usage))}>
      <span className="usage-bar" aria-hidden="true">
        <span style={{ width: `${share * 100}%` }} />
      </span>
      {usedPercentLabel(usage)} · {compactTokenCount(usage.used)} / {compactTokenCount(usage.size)}
    </span>
  );
}

function QuotaMeter({ name, window }: { name: QuotaName; window: QuotaWindow }) {
  const share = quotaShare(window);
  const percent = quotaPercentLabel(window);
  const resetsIn = timeUntil(window.resetsAt, Date.now());
  return (
    <span
      className={`usage-meter quota-meter level-${contextLevel(share)}`}
      data-hint={hints.quota(words.quotaLimitNames[name], percent, resetsIn)}
      aria-label={words.quota(words.quotaLimitNames[name], percent, resetsIn)}
    >
      <span className="usage-bar" aria-hidden="true">
        <span style={{ width: `${share * 100}%` }} />
      </span>
      {quotaLabels[name]} {percent} · {resetsIn}
    </span>
  );
}

const knownWindows = (quotas: PlanQuotas | null) =>
  QUOTA_NAMES.flatMap((name) => {
    const window = quotas?.[name];
    return window ? [{ name, window }] : [];
  });

function usePrefersCommand() {
  const [prefersCommand, setPrefersCommand] = useState(() => {
    try {
      return localStorage.getItem(PREFERENCE_KEY) !== "built-in";
    } catch {
      return true;
    }
  });
  const choose = (next: boolean) => {
    setPrefersCommand(next);
    try {
      localStorage.setItem(PREFERENCE_KEY, next ? "command" : "built-in");
    } catch {}
  };
  return [prefersCommand, choose] as const;
}

function terminalCellWidth(fontFamily: string) {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return 7.2;
  context.font = `${TERMINAL_FONT_SIZE}px ${fontFamily}`;
  return context.measureText("M".repeat(100)).width / 100;
}

/** How many terminal columns fit the element, one short so that rounding in the terminal never wraps the last glyph. */
function useColumns(element: RefObject<HTMLElement | null>, fontFamily: string) {
  const [columns, setColumns] = useState<number | null>(null);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const measure = () => setColumns(Math.max(1, Math.floor((target.clientWidth - 2 * TERMINAL_PADDING_X) / terminalCellWidth(fontFamily)) - 1));
    measure();
    void document.fonts.load(`${TERMINAL_FONT_SIZE}px ${fontFamily}`, "M").then(measure, () => {});
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [fontFamily]);
  return columns;
}

/** Asks the host again whenever the conversation changes, and now and then for clocks and quotas the command may show. */
function useStatuslineRender(conversation: Conversation, columns: number | null, runCommand: boolean) {
  const [render, setRender] = useState(() => lastRenders.get(conversation.id) ?? null);
  useEffect(() => setRender(lastRenders.get(conversation.id) ?? null), [conversation.id]);
  useEffect(() => {
    if (!columns) return;
    let latestRequest: string | null = null;
    const request = () => {
      latestRequest = crypto.randomUUID();
      connection.send({ type: "statusline.render", requestId: latestRequest, conversationId: conversation.id, columns, runCommand });
    };
    const stopListening = connection.onMessage((message) => {
      if (message.type !== "statusline.rendered" || message.requestId !== latestRequest) return;
      lastRenders.set(conversation.id, message.statusline);
      setRender(message.statusline);
    });
    const delayed = setTimeout(request, REQUEST_DELAY_MS);
    const refresh = setInterval(request, REFRESH_MS);
    return () => {
      clearTimeout(delayed);
      clearInterval(refresh);
      stopListening();
    };
  }, [conversation, columns, runCommand]);
  return render;
}

function cssOf({ text, style }: AnsiRun, look: StatuslineLook): CSSProperties {
  const { foreground, background, bold, dim, italic, underline, inverse, strikethrough } = style;
  const drawnOnTheStrip = foreground && !background && !drawsShapesOnly(text);
  const [color, backgroundColor] = inverse
    ? [background ?? "var(--terminal-background)", foreground ?? "var(--terminal-foreground)"]
    : [drawnOnTheStrip ? readableOn(foreground, look.background, look.minimumContrast) : foreground, background];
  return {
    color: dim ? `color-mix(in srgb, ${color ?? "var(--terminal-foreground)"} 60%, transparent)` : color,
    backgroundColor,
    fontWeight: bold ? 700 : undefined,
    fontStyle: italic ? "italic" : undefined,
    textDecoration: [underline && "underline", strikethrough && "line-through"].filter(Boolean).join(" ") || undefined,
  };
}

/** The command's output drawn as a terminal would, in the app's theme. */
function TerminalText({ text, fontFamily }: { text: string; fontFamily: string }) {
  const lines = useMemo(() => parseAnsi(text), [text]);
  const look = statuslineLooks[useShownTheme()];
  const terminalColors = { "--terminal-background": look.background, "--terminal-foreground": look.foreground } as CSSProperties;
  return (
    <div
      className="statusline-terminal"
      role="img"
      aria-label={plainTextOf(lines).trim()}
      style={{ fontFamily, fontSize: TERMINAL_FONT_SIZE, paddingInline: TERMINAL_PADDING_X, ...terminalColors }}
    >
      {lines.map((runs, lineIndex) => (
        <div key={lineIndex} className="statusline-line">
          {runs.map((run, runIndex) => (
            <span key={runIndex} style={cssOf(run, look)}>
              {run.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function BuiltInStatusline({
  conversation,
  profiles,
  gitBranch,
  quotas,
}: {
  conversation: Conversation;
  profiles: Profile[];
  gitBranch: string | null;
  quotas: PlanQuotas | null;
}) {
  const model = chosenModel(conversation.configOptions);
  const profile = profiles.find(({ id }) => id === conversation.profileId);
  const usage = conversation.contextUsage;
  return (
    <div className="statusline-chips">
      {gitBranch && (
        <span className="chip" data-hint={hints.gitBranch}>
          ⎇ {gitBranch}
        </span>
      )}
      {model && (
        <span className="chip" data-hint={hints.model}>
          {withMultiplier(model.name, model.multiplier)}
        </span>
      )}
      {usage && usage.size > 0 && <ContextMeter usage={usage} />}
      {knownWindows(quotas).map(({ name, window }) => (
        <QuotaMeter key={name} name={name} window={window} />
      ))}
      {usage?.cost && (
        <span className="chip" data-hint={hints.cost}>
          {formatCost(usage.cost)}
        </span>
      )}
      {usage?.credits !== undefined && (
        <span className="chip" data-hint={hints.credits}>
          {formatCredits(usage.credits)}
        </span>
      )}
      {profile && (
        <span className="chip" data-hint={hints.profileChip}>
          <ProfileDot profile={profile} />
          {profile.name}
        </span>
      )}
    </div>
  );
}

export function Statusline({ conversation, profiles }: { conversation: Conversation; profiles: Profile[] }) {
  const [prefersCommand, setPrefersCommand] = usePrefersCommand();
  const { fontFamily } = useTerminalSettings();
  const terminalFont = terminalFontList(fontFamily);
  const content = useRef<HTMLDivElement>(null);
  const columns = useColumns(content, terminalFont);
  const render = useStatuslineRender(conversation, columns, prefersCommand);
  const commandOutput = prefersCommand ? (render?.output ?? null) : null;

  return (
    <section className="statusline" aria-label={words.label}>
      <div className="statusline-content" ref={content}>
        {commandOutput !== null ? (
          <TerminalText text={commandOutput} fontFamily={terminalFont} />
        ) : (
          <BuiltInStatusline conversation={conversation} profiles={profiles} gitBranch={render?.gitBranch ?? null} quotas={render?.quotas ?? null} />
        )}
      </div>
      {prefersCommand && render?.error && (
        <span className="statusline-error" role="img" aria-label={words.commandFailed} data-hint={describedText(render.error, render.errorAbout)}>
          ⚠
        </span>
      )}
      {render?.command && (
        <button
          type="button"
          className="link statusline-source"
          data-hint={prefersCommand ? hints.statuslineCommand(render.command) : hints.statuslineBuiltIn(render.command)}
          onClick={() => setPrefersCommand(!prefersCommand)}
        >
          {prefersCommand ? words.builtIn : words.yours}
        </button>
      )}
    </section>
  );
}
