import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { chosenModel, withMultiplier } from "../shared/config-options.ts";
import type { StatuslineChip } from "../shared/canvas-plugins.ts";
import type { ContextUsage, Conversation, PlanQuotas, PluginContextHint, PluginStatuslineChips, Profile, QuotaWindow, StatuslineRender } from "../shared/model.ts";
import { COMPACT_COMMAND } from "../shared/slash-commands.ts";
import { placedAbove, useClosing } from "./BarMenu.tsx";
import { parseAnsi, plainTextOf, type AnsiRun } from "./ansi.ts";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { usePluginsOff } from "./plugin-settings.ts";
import { describedText } from "./host-error.ts";
import { canOpenItemWindows, openPluginWindow } from "./item-window.ts";
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

/** How full the context is, with the plugins' advice on it in its hint; a hint that offers to compact makes it open that advice with Compact now. */
export function ContextMeter({ conversationId, usage, advice }: { conversationId: string; usage: ContextUsage; advice: PluginContextHint[] }) {
  const share = usedShare(usage);
  const opener = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  useClosing(placement !== null, [opener, popover], () => setPlacement(null));
  const className = `usage-meter context-meter level-${contextLevel(share)}`;
  const hint = contextHint(usage, advice.map(({ text }) => text));
  const label = words.context(usedPercentLabel(usage));
  const figures = (
    <>
      <span className="usage-bar" aria-hidden="true">
        <span style={{ width: `${share * 100}%` }} />
      </span>
      {usedPercentLabel(usage)} · {compactTokenCount(usage.used)} / {compactTokenCount(usage.size)}
    </>
  );
  if (!advice.some(({ action }) => action === "compact")) {
    return (
      <span className={className} data-hint={hint} aria-label={label}>
        {figures}
      </span>
    );
  }
  const compactNow = () => {
    connection.send({ type: "conversation.prompt", conversationId, text: `/${COMPACT_COMMAND}`, imageIds: [], afterTurn: true });
    setPlacement(null);
  };
  return (
    <>
      <button
        ref={opener}
        type="button"
        className={className}
        data-hint={hint}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={placement !== null}
        onClick={() => setPlacement(placement || !opener.current ? null : placedAbove(opener.current))}
      >
        {figures}
      </button>
      {placement && (
        <div ref={popover} className="context-advice" role="dialog" aria-label={words.contextAdvice} style={placement}>
          {advice.map(({ plugin, title, text }) => (
            <p key={plugin}>
              <strong>{title}</strong> {text}
            </p>
          ))}
          <button type="button" data-hint={hints.compactNow} onClick={compactNow}>
            {words.compactNow}
          </button>
        </div>
      )}
    </>
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

/** Asks the host again whenever the conversation or the plugins its profile has on change, and now and then for clocks and quotas the command may show. */
function useStatuslineRender(conversation: Conversation, pluginsOff: string[], columns: number | null, runCommand: boolean) {
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
  }, [conversation, pluginsOff, columns, runCommand]);
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

/** A chip that opens the plugin's window first hands the window what to show, as an action of its own. */
function openFromChip(plugin: string, opens: NonNullable<StatuslineChip["opensWindow"]>) {
  if (opens !== true) connection.send({ type: "plugin-window.action", requestId: crypto.randomUUID(), plugin, action: opens.action });
  openPluginWindow(plugin);
}

function PluginChip({ plugin, chip, opensWindow }: { plugin: string; chip: StatuslineChip; opensWindow: boolean }) {
  const className = ["plugin-chip", chip.level && `level-${chip.level}`, chip.stale && "stale"].filter(Boolean).join(" ");
  const opens = opensWindow && canOpenItemWindows() ? chip.opensWindow : undefined;
  return opens ? (
    <button type="button" className={className} data-hint={chip.hint} onClick={() => openFromChip(plugin, opens)}>
      {chip.text}
    </button>
  ) : (
    <span className={className} data-hint={chip.hint}>
      {chip.text}
    </span>
  );
}

/** Each plugin's chips, drawn together. */
function PluginChips({ groups }: { groups: PluginStatuslineChips[] }) {
  return groups.map(({ plugin, title, chips, hasWindow }) => (
    <span key={plugin} className="plugin-chips" role="group" aria-label={title}>
      {chips.map((chip, index) => (
        <PluginChip key={index} plugin={plugin} chip={chip} opensWindow={hasWindow} />
      ))}
    </span>
  ));
}

const showsCost = (groups: PluginStatuslineChips[]) => groups.some(({ chips }) => chips.some(({ cost }) => cost));

function BuiltInStatusline({
  conversation,
  profiles,
  gitBranch,
  quotas,
  pluginChips,
  contextHints,
}: {
  conversation: Conversation;
  profiles: Profile[];
  gitBranch: string | null;
  quotas: PlanQuotas | null;
  pluginChips: PluginStatuslineChips[];
  contextHints: PluginContextHint[];
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
      {usage && usage.size > 0 && <ContextMeter conversationId={conversation.id} usage={usage} advice={contextHints} />}
      {knownWindows(quotas).map(({ name, window }) => (
        <QuotaMeter key={name} name={name} window={window} />
      ))}
      <PluginChips groups={pluginChips} />
      {usage?.cost && !showsCost(pluginChips) && (
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
  const pluginsOff = usePluginsOff(profiles, conversation.profileId);
  const render = useStatuslineRender(conversation, pluginsOff, columns, prefersCommand);
  const commandOutput = prefersCommand ? (render?.output ?? null) : null;
  const pluginChips = render?.pluginChips ?? [];
  const contextHints = render?.contextHints ?? [];
  const usage = conversation.contextUsage;
  const advisedUsage = contextHints.length > 0 && usage && usage.size > 0 ? usage : null;

  return (
    <section className="statusline" aria-label={words.label}>
      <div className="statusline-content" ref={content}>
        {commandOutput !== null ? (
          <TerminalText text={commandOutput} fontFamily={terminalFont} />
        ) : (
          <BuiltInStatusline
            conversation={conversation}
            profiles={profiles}
            gitBranch={render?.gitBranch ?? null}
            quotas={render?.quotas ?? null}
            pluginChips={pluginChips}
            contextHints={contextHints}
          />
        )}
      </div>
      {commandOutput !== null && (pluginChips.length > 0 || advisedUsage) && (
        <div className="statusline-plugins">
          {advisedUsage && <ContextMeter conversationId={conversation.id} usage={advisedUsage} advice={contextHints} />}
          <PluginChips groups={pluginChips} />
        </div>
      )}
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
