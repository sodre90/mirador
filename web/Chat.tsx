import type { SessionConfigOption, ToolCallContent } from "@agentclientprotocol/sdk";
import { createContext, Fragment, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { modelLabel } from "../shared/claude-models.ts";
import { flatSelectOptions } from "../shared/config-options.ts";
import { hasBegun } from "../shared/conversation-begun.ts";
import { describeJob } from "../shared/job-waits.ts";
import { formatTokens, tokensSpent, type SubagentUsage } from "../shared/subagent-usage.ts";
import {
  harnessLabels,
  harnessRewinds,
  terminalActivityLabels,
  askModeLabels,
  type AskMode,
  type AsyncTask,
  type AsyncTaskState,
  type Conversation,
  type DelegatedReply,
  type HarnessId,
  type JobWait,
  type Profile,
  type PromptTemplate,
  type QueuedMessage,
  type StoredEvent,
  type UsageLimitWait,
} from "../shared/model.ts";
import { profileSettingValue } from "../shared/apps.ts";
import { choicesOf, toolTitlesOfPlugins, usePluginSettings } from "./plugin-settings.ts";
import { readableToolTitle as readableToolTitleOf } from "../shared/tool-title.ts";
import { panelCommandLine, refusedPanelCommand } from "../shared/panel-commands.ts";
import { adjacentPlaceholder, placeholdersIn, type TextRange } from "../shared/prompt-templates.ts";
import { commandShownClosed, outputStartsOpen } from "../shared/shell-output.ts";
import { replyReadingOf } from "../shared/spoken-replies.ts";
import { awaitingDelivery, outputOf, type UserCommand } from "../shared/user-commands.ts";
import { speaksReplies, type VoiceSettings } from "../shared/voice.ts";
import type { VoiceEngineStatus } from "../shared/voice-engine.ts";
import { parseAnsi, plainTextOf } from "./ansi.ts";
import { harnessSteers, useEnterWhileBusy, type EnterWhileBusy } from "./busy-sending.ts";
import { connection } from "./connection.ts";
import { choiceGroups } from "./choices.ts";
import { MessageImages, PastedImages, useComposerImages } from "./ComposerImages.tsx";
import { useDroppedFiles } from "./dropped-files.ts";
import { DictateButton, DictationLines, useDictation } from "./Dictation.tsx";
import { setComposerHeight, useComposerHeight } from "./composer-height.ts";
import { ConversationTitle } from "./ConversationTitle.tsx";
import { lineDiff } from "./diff.ts";
import { CodeText } from "./CodeText.tsx";
import { rowWordChanges } from "./word-diff.ts";
import { answerPermission, EditCounts, PermissionOptions } from "./EditApproval.tsx";
import { useEditsInCanvas } from "./edits-in-canvas.ts";
import { isRawOutputOnHost } from "../shared/low-data.ts";
import { FindBar, MatchesFind, useFind } from "./FindBar.tsx";
import { useDragToReorder } from "./drag-to-reorder.ts";
import { useEarlierHistory, type EarlierHistory } from "./earlier-history.ts";
import { joinDrafts, useDraft } from "./drafts.ts";
import { useStoppedMessageEdit } from "./edit-stopped.ts";
import { isLoginCommand, requestLogin } from "./login-request.ts";
import { requestProgram } from "./program-request.ts";
import { AskToRevert, UndoButton } from "./Revert.tsx";
import { MarkdownText, SlackMessageText } from "./Markdown.tsx";
import { FormattedBox, type FormattedBoxExtras } from "./FormattedBox.tsx";
import { useMessageBox } from "./message-box.ts";
import { FormatBarToggle } from "./FormatBar.tsx";
import { ReadAloud, ReadsRepliesAloud } from "./ReadAloud.tsx";
import { awaitSpokenReply, forgetSpokenReply, readWhenSpokenTurnEnds, stopReading, stopReadingIn } from "./reply-player.ts";
import { hints, statusHints } from "./hints.ts";
import { SearchableSelect } from "./SearchableSelect.tsx";
import { useMentionMenu } from "./MentionMenu.tsx";
import { usePromptHistory } from "./PromptHistory.ts";
import { TemplateFinder, TemplatePicker } from "./PromptTemplates.tsx";
import { useSlashCommandMenu } from "./SlashCommandMenu.tsx";
import { noSuggestions } from "./SuggestionList.tsx";
import { movedCaretToLineEdge } from "./line-edge-keys.ts";
import { findsTemplate, keyLabels, shortcutKeys } from "./shortcuts.ts";
import { commandLineOf, isShellCommand, shellCommandOf } from "./shell.ts";
import { useShellOutputStyle } from "./shell-output.ts";
import { askAloudWhenWaiting } from "./spoken-ask.ts";
import { Statusline } from "./Statusline.tsx";
import type { OpenConversation } from "./state.ts";
import { useSubagentUsage } from "./subagent-usage.ts";
import {
  approvalsWaiting,
  authorOf,
  buildTimeline,
  contentText,
  runsInBackground,
  spokenSeverity,
  startsAuthorGroup,
  stepsAtWork,
  stepsRunning,
  subagentEndedAt,
  subagentInput,
  subagentAsking,
  subagentsIn,
  subagentState,
  toolCallsAwaitingPermission,
  type AgentNoticeBlock,
  type Author,
  type PermissionBlock,
  type SubagentBlock,
  type SubagentState,
  type TimelineBlock,
  type ToolBlock,
} from "../shared/timeline.ts";
import { ProfileDot } from "./ProfileDot.tsx";
import { formatClockTime, formatDuration, formatFullTime } from "./timestamps.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";
import { FullscreenToggle, PaneGrip } from "./Workspace.tsx";

/** Past this many choices a plain select is hard to scan: opencode lists every model of every provider. */
const SEARCHABLE_FROM_CHOICES = 20;

/** A command Claude Code opens a panel for only in its own terminal gets one there, on the conversation's profile. */
const requestPanelCommand = (conversationId: string, line: string) => requestProgram({ type: "terminal.open-panel-command", conversationId, line });

const configOptionHint = (option: SessionConfigOption) => [option.description, hints.configOption].filter(Boolean).join("\n\n");

function ConfigControl({ conversationId, option }: { conversationId: string; option: SessionConfigOption }) {
  const setValue = (value: string | boolean) => connection.send({ type: "conversation.set-config", conversationId, configId: option.id, value });
  if (option.type === "boolean") {
    return (
      <label className="config" data-hint={configOptionHint(option)}>
        <input type="checkbox" aria-label={option.name} checked={option.currentValue} onChange={(event) => setValue(event.target.checked)} />
        {option.name}
      </label>
    );
  }
  const choices = flatSelectOptions(option);
  if (choices.length > SEARCHABLE_FROM_CHOICES) {
    return (
      <SearchableSelect
        label={option.name}
        hint={configOptionHint(option)}
        value={option.currentValue}
        groups={choiceGroups(option)}
        onChange={setValue}
      />
    );
  }
  return (
    <label className="config" data-hint={configOptionHint(option)}>
      <span>{option.name}</span>
      <select aria-label={option.name} value={option.currentValue} onChange={(event) => setValue(event.target.value)}>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value} title={choice.description ?? undefined}>
            {choice.name}
          </option>
        ))}
      </select>
    </label>
  );
}

const isBusy = (conversation: Conversation) => conversation.status === "running" || conversation.status === "starting";

/** How long a graceful stop is given before the button offers to kill the wedged agent process. */
const STOP_FORCE_GRACE_MS = 3000;

/**
 * Profiles of the conversation's own agent, then the other agents', which can be picked only until the conversation has
 * begun: another agent cannot continue its session. One that has no profile to run on asks for one.
 */
function ProfilePicker({ conversation, profiles, begun }: { conversation: Conversation; profiles: Profile[]; begun: boolean }) {
  const choices = profiles.filter(({ harness }) => harness === conversation.harness);
  const otherAgents = profiles.filter(({ harness }) => harness !== conversation.harness);
  const hasItsProfile = choices.some(({ id }) => id === conversation.profileId);
  return (
    <label className="config" data-hint={hints.profile}>
      <span>Profile</span>
      <ProfileDot profile={profiles.find(({ id }) => id === conversation.profileId)} />
      <select
        aria-label="Profile"
        value={hasItsProfile ? conversation.profileId! : ""}
        onChange={(event) => connection.send({ type: "conversation.set-profile", conversationId: conversation.id, profileId: event.target.value })}
      >
        {!hasItsProfile && (
          <option value="" disabled>
            {conversation.profileId === null ? "Pick a profile" : "Deleted profile"}
          </option>
        )}
        {choices.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
        {otherAgents.length > 0 && (
          <optgroup label={begun ? "Other agents: start a new conversation" : "Other agents"}>
            {otherAgents.map(({ id, name, harness }) => (
              <option key={id} value={id} disabled={begun}>
                {name} · {harnessLabels[harness]}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}

function YoloSwitch({ conversation }: { conversation: Conversation }) {
  return (
    <label
      className={`config yolo ${conversation.bypassPermissions ? "on" : ""}`}
      data-hint={hints.yolo}
    >
      <input
        type="checkbox"
        aria-label="YOLO"
        checked={conversation.bypassPermissions}
        onChange={(event) =>
          connection.send({ type: "conversation.set-bypass-permissions", conversationId: conversation.id, bypassPermissions: event.target.checked })
        }
      />
      YOLO
    </label>
  );
}

const FOLLOWS_PROFILE = "\u0000profile";

/** Each plugin's profile settings, chosen for this conversation over what its profile sets; a conversation a plugin's tool started has none. */
function PluginSettingMenus({ conversation, profiles }: { conversation: Conversation; profiles: Profile[] }) {
  const withProfileSettings = usePluginSettings().flatMap(({ plugin, profileSettings }) => (profileSettings ?? []).map((setting) => ({ plugin, setting })));
  if (conversation.startedBy) return null;
  const profile = profiles.find(({ id }) => id === conversation.profileId);
  return withProfileSettings.map(({ plugin, setting }) => {
    const choices = choicesOf(setting, profiles, conversation.profileId);
    const profilesValue = profileSettingValue(profile?.pluginSettings, plugin, setting);
    const profilesLabel = choices.find(({ value }) => value === profilesValue)?.label ?? "None";
    const chosen = conversation.pluginSettings?.[plugin]?.[setting.id] ?? FOLLOWS_PROFILE;
    return (
      <label key={`${plugin}/${setting.id}`} className="config" data-hint={[setting.hint, hints.conversationPluginSetting].filter(Boolean).join("\n\n")}>
        <span>{setting.label}</span>
        <select
          aria-label={setting.label}
          value={chosen}
          onChange={(event) =>
            connection.send({
              type: "conversation.set-plugin-setting",
              conversationId: conversation.id,
              plugin,
              setting: setting.id,
              value: event.target.value === FOLLOWS_PROFILE ? null : event.target.value,
            })
          }
        >
          <option value={FOLLOWS_PROFILE}>Profile's ({profilesLabel})</option>
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
    );
  });
}

function ChatHeader({
  conversation,
  profiles,
  canvasVisible,
  onToggleCanvas,
  terminalVisible,
  onToggleTerminal,
  runningSubagents,
  onShowRunningSubagent,
  onFind,
  begun,
}: {
  conversation: Conversation;
  profiles: Profile[];
  canvasVisible: boolean;
  onToggleCanvas: () => void;
  terminalVisible: boolean;
  onToggleTerminal: () => void;
  runningSubagents: number;
  onShowRunningSubagent: () => void;
  onFind: () => void;
  begun: boolean;
}) {
  return (
    <header className="chat-header" data-pane-bar>
      <div className="title-row">
        <PaneGrip pane="conversation" />
        <h2>
          <ConversationTitle conversation={conversation} startEditingOn="click" className="conversation-name" />
        </h2>
        <span className={`badge status-${conversation.status}`} data-hint={statusHints[conversation.status]}>
          {conversation.status}
        </span>
        {runningSubagents > 0 && (
          <button type="button" className="subagents-running" data-hint={hints.subagentsRunning} onClick={onShowRunningSubagent}>
            ◐ {runningSubagents === 1 ? "1 subagent running" : `${runningSubagents} subagents running`}
          </button>
        )}
        {conversation.openInTerminal && (
          <span className={`badge terminal-${conversation.openInTerminal}`} data-hint={hints.inTerminal}>
            in a terminal · {terminalActivityLabels[conversation.openInTerminal]}
          </span>
        )}
        <span className="harness">{harnessLabels[conversation.harness]}</span>
        <button type="button" className="find-trigger" data-hint={hints.find} data-shortcut={shortcutKeys().find} onClick={onFind}>
          Find
        </button>
        <button className="toggle-canvas" data-hint={hints.canvasToggle} data-shortcut={shortcutKeys().toggleCanvas} onClick={onToggleCanvas}>
          {canvasVisible ? "Hide canvas" : "Show canvas"}
        </button>
        <button className="toggle-terminal" data-hint={hints.terminalToggle} data-shortcut={shortcutKeys().toggleTerminal} onClick={onToggleTerminal}>
          {terminalVisible ? "Hide terminal" : "Show terminal"}
        </button>
        <FullscreenToggle pane="conversation" />
      </div>
      {conversation.statusDetail && <div className="status-detail">{conversation.statusDetail}</div>}
      <div className="controls">
        <ProfilePicker conversation={conversation} profiles={profiles} begun={begun} />
        {conversation.configOptions.map((option) => (
          <ConfigControl key={option.id} conversationId={conversation.id} option={option} />
        ))}
        <YoloSwitch conversation={conversation} />
        <PluginSettingMenus conversation={conversation} profiles={profiles} />
        <label className="config" data-hint={hints.questions}>
          <span>Questions</span>
          <select
            aria-label="Questions"
            value={conversation.askMode}
            onChange={(event) =>
              connection.send({ type: "conversation.set-ask-mode", conversationId: conversation.id, askMode: event.target.value as AskMode })
            }
          >
            {(Object.keys(askModeLabels) as AskMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {askModeLabels[mode]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}

function DiffView({ path, oldText, newText }: { path: string; oldText?: string | null; newText: string }) {
  const lines = useMemo(() => lineDiff(oldText, newText), [oldText, newText]);
  const wordChanges = useMemo(() => rowWordChanges(lines), [lines]);
  return (
    <div className="diff">
      <div className="diff-path">{path}</div>
      <pre>
        {lines.map((line, index) => (
          <div key={index} className={`diff-${line.kind}`}>
            {line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}
            {wordChanges[index] ? <CodeText text={line.text} spans={undefined} changes={wordChanges[index]} /> : line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

function ToolContent({ content }: { content: ToolCallContent }) {
  switch (content.type) {
    case "content": {
      const text = contentText(content.content);
      const unwrapped = text.match(/^<subagent[^>]*>\n?([\s\S]*?)\n?<\/subagent>$/)?.[1] ?? text;
      return <pre className="tool-output">{unwrapped}</pre>;
    }
    case "diff":
      return <DiffView path={content.path} oldText={content.oldText} newText={content.newText} />;
    case "terminal":
      return <pre className="tool-output">(terminal {content.terminalId})</pre>;
  }
}

const rawJsonText = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

/** No value at all, or an empty one, as `{}` for a tool that takes no parameters. */
const holdsNothing = (value: unknown) => value === undefined || value === null || value === "" || (typeof value === "object" && Object.keys(value).length === 0);

function RawJson({ label, value }: { label: string; value: unknown }) {
  if (holdsNothing(value)) return null;
  return (
    <details className="raw">
      <summary>{label}</summary>
      <pre>{rawJsonText(value)}</pre>
    </details>
  );
}

/** A tool call's raw output repeats what the call shows, often at length, so the page asks the host for it when shown. */
function RawOutput({ block, conversationId }: { block: ToolBlock; conversationId: string }) {
  const [shown, setShown] = useState(false);
  const [fetched, setFetched] = useState<{ of: unknown; rawOutput: unknown } | null>(null);
  const onHost = isRawOutputOnHost(block.rawOutput);
  const current = fetched?.of === block.rawOutput ? fetched : null;
  useEffect(() => {
    if (!onHost || !shown || current) return;
    const requestId = crypto.randomUUID();
    const asked = block.rawOutput;
    const stopListening = connection.onMessage((message) => {
      if (message.type === "tool-raw-output.got" && message.requestId === requestId) setFetched({ of: asked, rawOutput: message.rawOutput });
    });
    connection.send({ type: "tool-raw-output.get", requestId, conversationId, toolCallId: block.toolCallId });
    return stopListening;
  }, [onHost, shown, current !== null, block.rawOutput]);
  if (!onHost) return <RawJson label="output" value={block.rawOutput} />;
  return (
    <details className="raw" onToggle={(event) => setShown(event.currentTarget.open)}>
      <summary>output</summary>
      <pre>{current ? rawJsonText(current.rawOutput) : "Loading…"}</pre>
    </details>
  );
}

const readableToolTitle = (title: string) => readableToolTitleOf(title, toolTitlesOfPlugins());

const statusIcons: Record<string, string> = { pending: "○", in_progress: "◐", completed: "●", failed: "✕" };

const StepsAtWork = createContext<ReadonlySet<string>>(new Set());

function useShownStatus(block: ToolBlock) {
  const atWork = useContext(StepsAtWork).has(block.toolCallId);
  return atWork ? "in_progress" : (block.status ?? "pending");
}

const PREVIEW_LINES = 8;

const ToolCallsAwaitingPermission = createContext<ReadonlySet<string>>(new Set());

/** Whether the canvas, in view, shows the diffs of edits waiting for permission, so their chat cards can stay small. */
const CanvasShowsEdits = createContext(false);

/** Whether the agent is at work in the conversation, so a failed turn cannot be tried again yet. */
const ConversationBusy = createContext(false);
/** The user's profile picture, or null: the person icon stands in. */
const UserPicture = createContext<string | null>(null);

const lastPathSegment = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

function CommandLine({ command, directory }: { command: string; directory?: string | null }) {
  return (
    <div className="shell-command">
      <span className="shell-prompt" data-hint={directory ?? undefined}>
        {directory ? `${lastPathSegment(directory)} $` : "$"}
      </span>
      <span className="shell-typed">{command}</span>
    </div>
  );
}

function TerminalOutput({ output, finished, awaitingPermission }: { output: string; finished: boolean; awaitingPermission: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const lines = output ? output.split("\n") : [];
  const foldedLinesMatch = useContext(MatchesFind)(lines.slice(PREVIEW_LINES).join("\n"));
  const hiddenCount = expanded || foldedLinesMatch ? 0 : Math.max(0, lines.length - PREVIEW_LINES);
  if (lines.length === 0) {
    const quiet = finished ? "(no output)" : awaitingPermission ? "waiting for your approval…" : "running…";
    return <div className="shell-quiet">{quiet}</div>;
  }
  return (
    <>
      <pre className="shell-output">{lines.slice(0, lines.length - hiddenCount).join("\n")}</pre>
      {hiddenCount > 0 && (
        <button type="button" className="shell-more" onClick={() => setExpanded(true)}>
          Show {hiddenCount} more {hiddenCount === 1 ? "line" : "lines"}
        </button>
      )}
      {expanded && lines.length > PREVIEW_LINES && (
        <button type="button" className="shell-more" onClick={() => setExpanded(false)}>
          Show less
        </button>
      )}
    </>
  );
}

function ShellCard({ block }: { block: ToolBlock }) {
  const { command, description, output, exitCode, directory } = shellCommandOf(block);
  const style = useShellOutputStyle();
  const status = useShownStatus(block);
  const failed = status === "failed" || (exitCode !== null && exitCode !== 0);
  const finished = status === "completed" || status === "failed";
  const awaitingPermission = useContext(ToolCallsAwaitingPermission).has(block.toolCallId);
  const commandLine = <CommandLine command={command} directory={directory} />;
  return (
    <details className={`shell tool-${status}`} open={outputStartsOpen(style, failed)}>
      <summary>
        <div className="shell-header">
          <span className="tool-status">{statusIcons[status]}</span>
          <span className="shell-description">{description ?? "Shell command"}</span>
          {failed && <span className="shell-exit">{exitCode !== null ? `exit ${exitCode}` : "failed"}</span>}
        </div>
        {commandShownClosed(style) && <div className="shell-body">{commandLine}</div>}
      </summary>
      <div className={`shell-body ${commandShownClosed(style) ? "below-command" : ""}`}>
        {!commandShownClosed(style) && commandLine}
        {(status !== "pending" || awaitingPermission) && <TerminalOutput output={output} finished={finished} awaitingPermission={awaitingPermission} />}
      </div>
    </details>
  );
}

function commandDelivery({ delivery, ended }: UserCommand) {
  if (delivery === "sent") return "Sent to the agent with your message";
  if (delivery === "dropped") return "Not sent to the agent";
  return ended ? "Goes to the agent with your next message" : "Goes to the agent with your next message once it finishes";
}

/** A command the user ran with `!` in the message box. */
function CommandCard({ command, conversationId }: { command: UserCommand; conversationId: string }) {
  const status = !command.ended ? "in_progress" : command.exitCode === 0 ? "completed" : "failed";
  const output = useMemo(() => plainTextOf(parseAnsi(outputOf(command))).trimEnd(), [command]);
  const stop = () => connection.send({ type: "conversation.stop-command", conversationId, commandId: command.commandId });
  return (
    <div className={`shell user-command tool-${status}`}>
      <div className="shell-header">
        <span className="tool-status">{statusIcons[status]}</span>
        <span className="shell-description" data-hint={hints.commandDelivery}>
          {commandDelivery(command)}
        </span>
        {status === "failed" && <span className="shell-exit">{command.exitCode === null ? "stopped" : `exit ${command.exitCode}`}</span>}
        {!command.ended && (
          <button type="button" className="link stop-command" onClick={stop}>
            Stop
          </button>
        )}
      </div>
      <div className="shell-body">
        <CommandLine command={command.command} />
        <TerminalOutput output={output} finished={command.ended} awaitingPermission={false} />
      </div>
    </div>
  );
}

function ToolCard({ block, conversationId }: { block: ToolBlock; conversationId: string }) {
  const status = useShownStatus(block);
  if (isShellCommand(block)) return <ShellCard block={block} />;
  return (
    <details className={`tool tool-${status}`}>
      <summary>
        <span className="tool-status">{statusIcons[status]}</span>
        <span className="tool-title">{readableToolTitle(block.title)}</span>
        {block.toolKind && <span className="tool-kind">{block.toolKind}</span>}
      </summary>
      {block.locations.length > 0 && (
        <div className="locations">
          {block.locations.map((location, index) => (
            <Fragment key={index}>
              {index > 0 && ", "}
              <button
                type="button"
                className="location"
                data-hint={hints.openFile}
                onClick={() => connection.send({ type: "files.open", conversationId, path: location.path })}
              >
                {`${location.path}${location.line ? `:${location.line}` : ""}`}
              </button>
            </Fragment>
          ))}
        </div>
      )}
      {block.content.map((content, index) => (
        <ToolContent key={index} content={content} />
      ))}
      <RawJson label="input" value={block.rawInput} />
      <RawOutput block={block} conversationId={conversationId} />
    </details>
  );
}

const SubagentStates = createContext<ReadonlyMap<string, SubagentState>>(new Map());

const subagentIcons: Record<SubagentState, string> = { running: "◐", done: "●", failed: "✕", stopped: "■" };

function useClock(ticking: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

const callsLabel = (count: number) => (count === 1 ? "1 call" : `${count} calls`);

function SubagentCard({ block, conversationId, harness }: { block: SubagentBlock; conversationId: string; harness: HarnessId }) {
  const state = useContext(SubagentStates).get(block.toolCallId) ?? "done";
  const now = useClock(state === "running");
  const { subagent_type, model, prompt } = subagentInput(block);
  const calls = block.subagent.blocks.filter((child) => child.kind === "tool");
  const latestCall = calls.at(-1);
  const awaitingPermission = useContext(ToolCallsAwaitingPermission);
  const atWork = useMemo(() => (state === "running" ? stepsAtWork(block.subagent.blocks, awaitingPermission) : new Set<string>()), [state, block.subagent.blocks, awaitingPermission]);
  const facts = [
    typeof subagent_type === "string" && subagent_type,
    typeof model === "string" && model,
    callsLabel(calls.length),
    formatDuration((state === "running" ? now : subagentEndedAt(block)) - block.at),
    runsInBackground(block) && "in the background",
  ].filter(Boolean);
  return (
    <details className={`tool subagent subagent-${state}`} data-tool-call-id={block.toolCallId}>
      <summary>
        <span className="tool-status" aria-label={state}>
          {subagentIcons[state]}
        </span>
        <span className="subagent-label">Subagent</span>
        <span className="subagent-task">{subagentTask(block)}</span>
        <span className="subagent-facts">{facts.join(" · ")}</span>
        {state === "running" && latestCall && <span className="subagent-now">now: {readableToolTitle(latestCall.title)}</span>}
      </summary>
      {typeof prompt === "string" && (
        <details className="raw subagent-prompt">
          <summary>prompt</summary>
          <pre>{prompt}</pre>
        </details>
      )}
      <StepsAtWork.Provider value={atWork}>
        <div className="subagent-work">
          {block.subagent.blocks.map((child) => (
            <TimelineEntry key={child.key} block={child} conversationId={conversationId} harness={harness} canRewind={false} />
          ))}
        </div>
      </StepsAtWork.Provider>
      {block.content.map((content, index) => (
        <ToolContent key={index} content={content} />
      ))}
      <RawJson label="input" value={block.rawInput} />
      <RawOutput block={block} conversationId={conversationId} />
    </details>
  );
}

/** Where a subagent's work has got to: its latest entry, or its card while it has done nothing yet. */
const latestWorkIn = (card: HTMLDetailsElement) => card.querySelector(":scope > .subagent-work > :last-child") ?? card;

const subagentTask = (block: SubagentBlock) => {
  const { description, prompt } = subagentInput(block);
  if (typeof description === "string" && description) return description;
  if (typeof prompt === "string" && prompt) return prompt.split("\n")[0]!.slice(0, 80);
  return readableToolTitle(block.title);
};

const tokensHint = ({ cacheReadTokens, cacheWriteTokens, inputTokens }: SubagentUsage) =>
  hints.subagentTokens(formatTokens(cacheReadTokens), formatTokens(cacheWriteTokens), formatTokens(inputTokens));

/** Pinned under the conversation while subagents work, however far the timeline has moved on since they started. */
function RunningSubagents({ conversationId, subagents, onShow }: { conversationId: string; subagents: SubagentBlock[]; onShow: (block: SubagentBlock) => void }) {
  const now = useClock(true);
  const spentBySubagent = useSubagentUsage(
    conversationId,
    subagents.map(({ toolCallId }) => toolCallId),
  );
  return (
    <div className="running-subagents" role="status" aria-label="Subagents at work">
      {subagents.map((block) => {
        const { subagent_type, model: requestedModel } = subagentInput(block);
        const spent = spentBySubagent[block.toolCallId];
        const model = spent?.model ?? (typeof requestedModel === "string" ? requestedModel : null);
        const facts = [typeof subagent_type === "string" && subagent_type, model && modelLabel(model), spent && tokensSpent(spent), formatDuration(now - block.at)];
        const latestCall = block.subagent.blocks.filter((child) => child.kind === "tool").at(-1);
        return (
          <button key={block.toolCallId} type="button" className="running-subagent" data-hint={hints.runningSubagent} onClick={() => onShow(block)}>
            <span className="subagent-pulse" />
            <span className="subagent-task">{subagentTask(block)}</span>
            <span className="subagent-facts" data-hint={spent ? tokensHint(spent) : undefined}>
              {facts.filter(Boolean).join(" · ")}
            </span>
            {latestCall && <span className="subagent-now">now: {readableToolTitle(latestCall.title)}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The approvals the conversation waits for whose cards are out of the timeline's view: scrolled away, or not loaded. */
function useApprovalsOutOfView(timelineRef: RefObject<HTMLDivElement | null>, waiting: PermissionBlock[], firstLoaded: number) {
  const [inView, setInView] = useState<ReadonlySet<string>>(new Set());
  const waitingIds = waiting.map(({ permissionId }) => permissionId).join(" ");
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || !waitingIds) return;
    const cards = timeline.querySelectorAll<HTMLElement>(".permission.pending[data-permission-id]");
    const visible = new Set<string>();
    if (cards.length === 0) setInView(visible);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          const { permissionId } = (target as HTMLElement).dataset;
          if (!permissionId) continue;
          if (isIntersecting) visible.add(permissionId);
          else visible.delete(permissionId);
        }
        setInView(new Set(visible));
      },
      { root: timeline },
    );
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [timelineRef, waitingIds, firstLoaded]);
  return waiting.filter(({ permissionId }) => !inView.has(permissionId));
}

function ApprovalsWaiting({ approvals, timeline, onShow }: { approvals: PermissionBlock[]; timeline: TimelineBlock[]; onShow: (approval: PermissionBlock) => void }) {
  const now = useClock(true);
  return (
    <div className="approvals-waiting" role="status" aria-label="Approvals waiting">
      {approvals.map((approval) => {
        const asker = subagentAsking(timeline, approval);
        const facts = [asker && `asked by ${subagentTask(asker)}`, `waiting ${formatDuration(now - approval.at)}`];
        return (
          <button key={approval.permissionId} type="button" className="approval-waiting" data-hint={hints.approvalWaiting} onClick={() => onShow(approval)}>
            <span className="approval-subject">Permission needed: {permissionSubject(approval.toolCall)}</span>
            <span className="approval-facts">{facts.filter(Boolean).join(" · ")}</span>
          </button>
        );
      })}
    </div>
  );
}

function permissionSubject(toolCall: PermissionBlock["toolCall"]) {
  if (toolCall.kind !== "execute") return toolCall.title ?? "tool call";
  const description = (toolCall.rawInput as { description?: unknown } | null | undefined)?.description;
  return typeof description === "string" ? description : "run a shell command";
}

function InfoLine({ text }: { text: string }) {
  return (
    <div className="info-line">
      <MarkdownText text={text} />
    </div>
  );
}

/** What an agent's notice update said: one line, and when it brought detail, a line that folds the detail away and keeps its line breaks. */
function AgentNoticeLine({ block }: { block: AgentNoticeBlock }) {
  const loudness = block.severity === "warning" || block.severity === "error" ? block.severity : "info";
  const lines = block.description ? block.description.split("\n") : [];
  const spoken = spokenSeverity(block);
  const severityForScreenReaders = spoken && <span className="visually-hidden">{spoken}: </span>;
  if (lines.length < 2)
    return (
      <div className={`agent-notice ${loudness}`}>
        {severityForScreenReaders}
        {block.title}
        {block.description ? `: ${block.description}` : ""}
      </div>
    );
  return (
    <details className={`agent-notice ${loudness}`}>
      <summary>
        {severityForScreenReaders}
        {block.title} · {lines.length} lines
      </summary>
      <div className="notice-lines">{block.description}</div>
    </details>
  );
}

function PermissionCard({ block, conversationId }: { block: PermissionBlock; conversationId: string }) {
  const editsInCanvas = useContext(CanvasShowsEdits) && block.edits?.length ? block.edits : null;
  const chosen = block.options.find(({ optionId }) => optionId === block.chosenOptionId);
  return (
    <div className={`permission ${block.resolved ? "resolved" : "pending"}`} data-permission-id={block.permissionId}>
      <div className="permission-title">
        {block.resolved ? "Permission" : "Permission needed"}: {permissionSubject(block.toolCall)}
      </div>
      {block.toolCall.kind === "execute" ? (
        <div className="shell-body">
          <CommandLine command={commandLineOf(block.toolCall.rawInput, block.toolCall.title ?? "")} />
        </div>
      ) : editsInCanvas ? (
        <div className="permission-edit-summary">
          <EditCounts edits={editsInCanvas} />
          {!block.resolved && <span className="shown-in-canvas"> · Shown in the canvas</span>}
        </div>
      ) : (
        <>
          {block.toolCall.content?.map((content, index) => <ToolContent key={index} content={content} />)}
          <RawJson label="input" value={block.toolCall.rawInput} />
        </>
      )}
      {block.resolved ? (
        <div className="permission-outcome">{chosen ? chosen.name : "Cancelled"}</div>
      ) : (
        <PermissionOptions options={block.options} onChoose={(optionId) => answerPermission(conversationId, block.permissionId, optionId)} />
      )}
    </div>
  );
}

const agentNames: Record<HarnessId, string> = { claude: "Claude", opencode: "opencode", pi: "pi" };
const agentMarks: Record<HarnessId, string> = { claude: "✳", opencode: "◆", pi: "π" };

function PersonIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="5.2" r="3" fill="currentColor" />
      <path d="M2.4 14.6c.7-3.1 2.9-4.6 5.6-4.6s4.9 1.5 5.6 4.6z" fill="currentColor" />
    </svg>
  );
}

function ScriptIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 12.2h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PluginIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6 2.5h1.2a1.3 1.3 0 0 1 2.6 0H11a.5.5 0 0 1 .5.5v2.2a1.3 1.3 0 0 1 0 2.6V10a.5.5 0 0 1-.5.5H9.8a1.3 1.3 0 0 0-2.6 0H6a.5.5 0 0 1-.5-.5V7.8a1.3 1.3 0 0 0 0-2.6V3a.5.5 0 0 1 .5-.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        transform="translate(-0.5 1.5)"
      />
    </svg>
  );
}

function Avatar({ author, harness }: { author: Author; harness: HarnessId }) {
  const picture = useContext(UserPicture);
  if (typeof author === "object") {
    return (
      <span className="avatar plugin" aria-hidden="true">
        <PluginIcon />
      </span>
    );
  }
  if (author === "script") {
    return (
      <span className="avatar script" aria-hidden="true">
        <ScriptIcon />
      </span>
    );
  }
  return author === "user" ? (
    <span className="avatar user" aria-hidden="true">
      {picture ? <img src={picture} alt="" /> : <PersonIcon />}
    </span>
  ) : (
    <span className={`avatar agent-${harness}`} aria-hidden="true">
      {agentMarks[harness]}
    </span>
  );
}

function Timestamp({ at }: { at: number }) {
  return (
    <time className="timestamp" dateTime={new Date(at).toISOString()} title={formatFullTime(at)}>
      {formatClockTime(at)}
    </time>
  );
}

function authorName(author: Author, harness: HarnessId) {
  if (typeof author === "object") return <span data-hint={hints.pluginMessage}>From {author.plugin}</span>;
  if (author === "script") return <span data-hint={hints.scriptMessage}>From a script</span>;
  return author === "user" ? "You" : agentNames[harness];
}

/** Long conversations have hundreds of entries; one that did not change is not rendered again. */
const TimestampedEntry = memo(function TimestampedEntry({
  block,
  startsGroup,
  harness,
  conversationId,
}: {
  block: TimelineBlock;
  startsGroup: boolean;
  harness: HarnessId;
  conversationId: string;
}) {
  const author = authorOf(block);
  return (
    <div className={`timeline-entry ${startsGroup ? "group-start" : ""} ${author ? "" : "notice-entry"}`}>
      <div className="gutter">{startsGroup && author ? <Avatar author={author} harness={harness} /> : <Timestamp at={block.at} />}</div>
      <div className="entry-body">
        {startsGroup && author && (
          <div className="author">
            {authorName(author, harness)}
            <Timestamp at={block.at} />
          </div>
        )}
        <TimelineEntry block={block} conversationId={conversationId} harness={harness} canRewind={harnessRewinds[harness]} />
      </div>
    </div>
  );
});

function TimelineEntry({ block, conversationId, harness, canRewind }: { block: TimelineBlock; conversationId: string; harness: HarnessId; canRewind: boolean }) {
  const askToRevert = useContext(AskToRevert);
  switch (block.kind) {
    case "user":
      return (
        <>
          <div className="message user">
            <SlackMessageText text={block.text} conversationId={conversationId} />
            <MessageImages conversationId={conversationId} imageIds={block.imageIds} carried={block.images} />
          </div>
          {block.turnSeq !== undefined && (block.filesKept || canRewind) && (
            <UndoButton turn={{ seq: block.turnSeq, text: block.text }} rewind={canRewind} ask={askToRevert} />
          )}
        </>
      );
    case "agent": {
      const refused = harness === "claude" ? refusedPanelCommand(block.text) : null;
      return (
        <>
          <div className="message agent">
            <MarkdownText text={block.text} conversationId={conversationId} />
            <MessageImages conversationId={conversationId} carried={block.images} />
            {refused && (
              <div className="terminal-command">
                <button type="button" data-hint={hints.terminalCommand} onClick={() => requestPanelCommand(conversationId, `/${refused}`)}>
                  Open a terminal tab
                </button>
              </div>
            )}
          </div>
          <ReadAloud conversationId={conversationId} replyKey={block.key} reply={block.text} />
        </>
      );
    }
    case "thought":
      return (
        <details className="thought">
          <summary>Thinking</summary>
          <MarkdownText text={block.text} conversationId={conversationId} />
        </details>
      );
    case "tool":
      return block.subagent ? (
        <SubagentCard block={block as SubagentBlock} conversationId={conversationId} harness={harness} />
      ) : (
        <ToolCard block={block} conversationId={conversationId} />
      );
    case "command":
      return <CommandCard command={block.command} conversationId={conversationId} />;
    case "plan":
      return (
        <div className="plan">
          <div className="plan-title">Plan</div>
          <ul>
            {block.entries.map((entry, index) => (
              <li key={index} className={`plan-${entry.status}`}>
                {statusIcons[entry.status]} {entry.content}
              </li>
            ))}
          </ul>
        </div>
      );
    case "permission":
      return <PermissionCard block={block} conversationId={conversationId} />;
    case "notice":
      return <div className="notice-line">{block.text}</div>;
    case "info":
      return <InfoLine text={block.text} />;
    case "agent-notice":
      return <AgentNoticeLine block={block} />;
    case "error":
      if (block.authRequired && !block.signedInSince) {
        return (
          <div className="error-line sign-in-line">
            <span>{block.message}</span>
            <button type="button" data-hint={hints.logIn} onClick={() => requestLogin(conversationId)}>
              Log in
            </button>
          </div>
        );
      }
      if (block.tryAgainSeq !== undefined) return <FailedTurnLine message={block.message} conversationId={conversationId} errorSeq={block.tryAgainSeq} />;
      return <div className={block.usageLimit ? "usage-limit-line" : "error-line"}>{block.message}</div>;
  }
}

function FailedTurnLine({ message, conversationId, errorSeq }: { message: string; conversationId: string; errorSeq: number }) {
  const busy = useContext(ConversationBusy);
  return (
    <div className="error-line try-again-line">
      <span>{message}</span>
      {!busy && (
        <button type="button" data-hint={hints.tryAgain} onClick={() => connection.send({ type: "conversation.try-again", conversationId, errorSeq })}>
          Try again
        </button>
      )}
    </div>
  );
}

interface ScrollAnchor {
  element: Element;
  fraction: number;
}

function firstEndingBelow(children: Element[], line: number) {
  let low = 0;
  let high = children.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (children[middle]!.getBoundingClientRect().bottom > line) high = middle;
    else low = middle + 1;
  }
  return children[low];
}

/** The innermost element crossing the top edge of the view, and how far down it the edge is. */
function anchorAtTop(timeline: HTMLElement): ScrollAnchor | null {
  const top = timeline.getBoundingClientRect().top;
  let element: Element | undefined = timeline;
  let crossing: Element | null = null;
  while ((element = firstEndingBelow([...element.children], top))) crossing = element;
  if (!crossing) return null;
  const rect = crossing.getBoundingClientRect();
  return { element: crossing, fraction: rect.height ? (top - rect.top) / rect.height : 0 };
}

/** The first entry not yet scrolled past, and how far down it the top edge of the view is (negative while it starts lower). */
function entryAtTop(timeline: HTMLElement): ScrollAnchor | null {
  const top = timeline.getBoundingClientRect().top;
  const entry = firstEndingBelow([...timeline.querySelectorAll(":scope > .timeline-entry")], top);
  if (!entry) return null;
  const rect = entry.getBoundingClientRect();
  return { element: entry, fraction: rect.height ? (top - rect.top) / rect.height : 0 };
}

function scrollBackTo(timeline: HTMLElement, { element, fraction }: ScrollAnchor) {
  if (!element.isConnected) return;
  const rect = element.getBoundingClientRect();
  timeline.scrollTop += rect.top + fraction * rect.height - timeline.getBoundingClientRect().top;
}

/**
 * Keeps the reader's place when the timeline's content or the pane's size changes: at the bottom if they were there,
 * otherwise on the line at the top of the view, however the text rewraps. Content can change long after the event that
 * brought it, as when a streamed reply's text shows a moment after its last chunk or an image loads, so the bottom is
 * kept on every change to the page, before the browser paints it or reports the scroll. Scroll events caused by the
 * resize itself (the browser clamping or reflowing) are ignored, so they don't overwrite the place remembered before it.
 */
function useScrollAnchor() {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const anchor = useRef<ScrollAnchor | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const held = useRef<ScrollAnchor | "bottom" | null>(null);

  const resizedSinceLastLook = (timeline: HTMLElement) => timeline.clientWidth !== size.current.width || timeline.clientHeight !== size.current.height;

  useLayoutEffect(() => {
    const timeline = ref.current!;
    let heightSeen = 0;
    /** Only growth moves the view, so a clock ticking in an entry doesn't pull back a reader a few pixels up. */
    const followGrowth = () => {
      if (pinned.current && timeline.scrollHeight > heightSeen) timeline.scrollTop = timeline.scrollHeight;
      heightSeen = timeline.scrollHeight;
    };
    followGrowth();
    const resizes = new ResizeObserver(() => {
      if (pinned.current) timeline.scrollTop = timeline.scrollHeight;
      else if (anchor.current) scrollBackTo(timeline, anchor.current);
      size.current = { width: timeline.clientWidth, height: timeline.clientHeight };
      heightSeen = timeline.scrollHeight;
    });
    resizes.observe(timeline);
    /** A section the reader opens or closes leaves the view where it is, and whether they are at the bottom is taken anew. */
    const onlyToggled = (records: MutationRecord[]) => records.every(({ type }) => type === "attributes");
    const changes = new MutationObserver((records) => {
      if (!onlyToggled(records)) return followGrowth();
      if (timeline.clientHeight) rememberPlaceIn(timeline);
      heightSeen = timeline.scrollHeight;
    });
    changes.observe(timeline, { childList: true, subtree: true, characterData: true, attributeFilter: ["open"] });
    timeline.addEventListener("load", followGrowth, true);
    return () => {
      resizes.disconnect();
      changes.disconnect();
      timeline.removeEventListener("load", followGrowth, true);
    };
  }, []);

  useLayoutEffect(() => {
    const place = held.current;
    if (!place) return;
    held.current = null;
    if (place === "bottom") ref.current!.scrollTop = ref.current!.scrollHeight;
    else scrollBackTo(ref.current!, place);
  });

  const rememberPlaceIn = (timeline: HTMLElement) => {
    pinned.current = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 40;
    anchor.current = pinned.current ? null : anchorAtTop(timeline);
  };
  const onScroll = () => {
    const timeline = ref.current;
    if (!timeline || resizedSinceLastLook(timeline)) return;
    rememberPlaceIn(timeline);
  };
  /** Where the view was moved on purpose, as to a match, is the reader's place, also while the pane changes size. */
  const rememberPlace = () => {
    if (ref.current) rememberPlaceIn(ref.current);
  };
  /** Keeps the reader's place through the next render, which adds or removes entries above the view. */
  const holdPlace = () => {
    if (ref.current) held.current = pinned.current ? "bottom" : entryAtTop(ref.current);
  };
  const isPinned = () => pinned.current;
  return { ref, onScroll, holdPlace, isPinned, rememberPlace };
}

const ENTRIES_PER_LOAD = 200;

/**
 * A long conversation keeps only its newest entries in the page: WebKit repaints every entry whenever any pane changes
 * size, which made dragging a divider lag in conversations with thousands of entries. Earlier entries load as the
 * reader scrolls up to them, from the host once the page has drawn all it holds; while the reader stays at the bottom,
 * the oldest drawn ones are let go again. The first drawn entry is kept by its key, as earlier history comes in above it.
 */
function useLoadedEntries(
  timeline: TimelineBlock[],
  historyLoaded: boolean,
  scroll: { holdPlace: () => void; isPinned: () => boolean },
  earlier: EarlierHistory,
) {
  const [firstKey, setFirstKey] = useState<string | null>(null);
  const drawMoreOnceLoaded = useRef(false);
  const newest = Math.max(0, timeline.length - ENTRIES_PER_LOAD);
  const keyedIndex = firstKey === null ? -1 : timeline.findIndex(({ key }) => key === firstKey);
  const firstLoaded = keyedIndex === -1 ? newest : keyedIndex;
  const drawFrom = (index: number) => setFirstKey(timeline[index]?.key ?? null);
  useEffect(() => {
    if (historyLoaded && firstKey === null) drawFrom(newest);
  }, [historyLoaded]);
  useEffect(() => {
    if (keyedIndex !== -1 && scroll.isPinned() && timeline.length - keyedIndex > 2 * ENTRIES_PER_LOAD) drawFrom(newest);
    if (drawMoreOnceLoaded.current && firstLoaded > 0) {
      drawMoreOnceLoaded.current = false;
      loadFrom(firstLoaded - ENTRIES_PER_LOAD);
    }
  }, [timeline.length]);
  const loadFrom = (index: number) => {
    const target = Math.max(0, index);
    if (target >= firstLoaded) return;
    scroll.holdPlace();
    drawFrom(target);
  };
  const loadEarlier = () => {
    if (firstLoaded > 0) return loadFrom(firstLoaded - ENTRIES_PER_LOAD);
    if (earlier.load()) drawMoreOnceLoaded.current = true;
  };
  return { firstLoaded, loadFrom, loadEarlier };
}

function earlierEntriesLabel(firstLoaded: number, earlier: EarlierHistory) {
  if (firstLoaded > 0) return `Show earlier entries (${firstLoaded.toLocaleString()}${earlier.available ? "+" : ""} more)`;
  return earlier.loading ? "Loading earlier entries…" : "Show earlier entries";
}

const queuedMessagesGoOut: Record<HarnessId, string> = {
  claude: "each joins the turn when the agent's tools finish, or waits for the turn to end, as tagged",
  opencode: "sent when the agent finishes its turn",
  pi: "each joins the turn when the agent's tools finish, or waits for the turn to end, as tagged",
};

function DeliveryTag({ conversationId, message }: { conversationId: string; message: QueuedMessage }) {
  const switchDelivery = () =>
    connection.send({ type: "conversation.queue.set-after-turn", conversationId, messageId: message.id, afterTurn: !message.afterTurn });
  return (
    <button type="button" className={`queued-delivery ${message.afterTurn ? "after-turn" : "joins-turn"}`} data-hint={hints.queuedDelivery} onClick={switchDelivery}>
      {message.afterTurn ? "after the turn" : "joins the turn"}
    </button>
  );
}

function QueuedMessages({
  conversationId,
  harness,
  messages,
  onEdit,
  onRemove,
}: {
  conversationId: string;
  harness: HarnessId;
  messages: QueuedMessage[];
  onEdit: (message: QueuedMessage) => void;
  onRemove: (message: QueuedMessage) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const drag = useDragToReorder((messageId, beforeMessageId) => connection.send({ type: "conversation.queue.move", conversationId, messageId, beforeMessageId }));
  const reorderable = messages.length > 1;
  return (
    <section className="queue" aria-label="Queued messages">
      <header data-hint={hints.queue}>Queued · {queuedMessagesGoOut[harness]}</header>
      <ol ref={list}>
        {messages.map((message, index) => (
          <li key={message.id} data-reorder-id={message.id} className={["queued", ...drag.classesOf(message.id, index === messages.length - 1)].join(" ")}>
            {reorderable && (
              <span className="queued-grip" data-hint={hints.queuedGrip} onPointerDown={(event) => drag.startDrag(message.id, list.current, event)}>
                ⋮⋮
              </span>
            )}
            {message.fromScript && (
              <span className="queued-source" data-hint={hints.scriptMessage}>
                script
              </span>
            )}
            {message.fromPlugin && (
              <span className="queued-source" data-hint={hints.pluginMessage}>
                {message.fromPlugin}
              </span>
            )}
            {harnessSteers[harness] && <DeliveryTag conversationId={conversationId} message={message} />}
            <span className="queued-text">{message.text}</span>
            <MessageImages conversationId={conversationId} imageIds={message.imageIds} />
            <button type="button" className="link" onClick={() => onEdit(message)}>
              Edit
            </button>
            <button type="button" className="link" onClick={() => onRemove(message)}>
              Remove
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const resetTime = (at: number) => (new Date(at).toDateString() === new Date().toDateString() ? formatClockTime(at) : `${weekday.format(at)} ${formatClockTime(at)}`);

function usageLimitStatus({ resetsAt, continuesAt }: UsageLimitWait) {
  if (continuesAt !== null) return `Claude's usage limit is reached · the agent continues by itself at ${resetTime(continuesAt)}`;
  if (resetsAt !== null) return `Claude's usage limit is reached · it resets at ${resetTime(resetsAt)}`;
  return "Claude's usage limit is reached";
}

const whoHears = (wait: JobWait) => (wait.resume ? "Then the agent gets: " : "Then you are told: ");

/** A long message shows its first lines; a click shows all of it, and another its first lines again. */
function JobWaitMessage({ text }: { text: string }) {
  const element = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const cutOff = useCutOff(element);
  const toggle = () => setOpen((wasOpen) => !wasOpen);
  const opensOnClick = open || cutOff;
  return (
    <div
      ref={element}
      className={`job-wait-message ${open ? "open" : ""}`}
      {...(opensOnClick && {
        role: "button",
        tabIndex: 0,
        "aria-expanded": open,
        onClick: toggle,
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggle();
        },
      })}
    >
      {text}
    </div>
  );
}

/** Whether the element's text runs past the lines it is clamped to. */
function useCutOff(element: RefObject<HTMLElement | null>) {
  const [cutOff, setCutOff] = useState(false);
  useLayoutEffect(() => {
    const target = element.current!;
    const measure = () => setCutOff(target.scrollHeight > target.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [element]);
  return cutOff;
}

function JobWaits({ conversationId, waits }: { conversationId: string; waits: JobWait[] }) {
  return (
    <section className="job-waits" aria-label="Jobs waited for">
      <ul>
        {waits.map((wait) => (
          <li key={wait.id}>
            <div className="job-wait-text">
              <span className="job-wait-status" data-hint={hints.jobWait}>
                Waiting for{" "}
                <button
                  type="button"
                  className="link job-wait-follow"
                  data-hint={hints.followJob}
                  onClick={() => requestProgram({ type: "terminal.follow-job", conversationId, waitId: wait.id })}
                >
                  {describeJob(wait)}
                </button>{" "}
                to end, since {formatClockTime(wait.since)}
              </span>
              <JobWaitMessage text={`${whoHears(wait)}${wait.message}`} />
            </div>
            <button
              type="button"
              className="link"
              data-hint={hints.stopWaitingForJob}
              onClick={() => connection.send({ type: "conversation.job-wait.stop", conversationId, waitId: wait.id })}
            >
              Stop waiting
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const asyncTaskStateLabels: Record<AsyncTaskState, string> = {
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

const isFinishedTask = (task: AsyncTask) => task.state === "completed" || task.state === "failed" || task.state === "stopped" || !task.canStop;

function BackgroundTasks({ conversationId, tasks }: { conversationId: string; tasks: AsyncTask[] }) {
  const finishedTasks = tasks.filter(isFinishedTask);
  return (
    <section className="async-tasks" aria-label="Background tasks">
      {finishedTasks.length >= 2 && (
        <header className="async-tasks-header">
          <button
            type="button"
            className="link"
            data-hint={hints.clearFinishedAsyncTasks}
            onClick={() => connection.send({ type: "conversation.async-task.clear-finished", conversationId })}
          >
            Clear finished
          </button>
        </header>
      )}
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <AsyncTaskRow conversationId={conversationId} task={task} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AsyncTaskRow({ conversationId, task }: { conversationId: string; task: AsyncTask }) {
  const [open, setOpen] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const ticking = task.state === "running" || task.state === "paused";
  const now = useClock(ticking);
  useEffect(() => {
    if (!open) return;
    let stale = false;
    const load = () =>
      connection
        .sendAndAwait(
          (requestId) => ({ type: "async-task.output.get", requestId, conversationId, asyncTaskId: task.id }),
          (message, requestId) => (message.type === "async-task.output.got" && message.requestId === requestId ? message.text : undefined),
        )
        .then((text) => !stale && setOutput(text))
        .catch(() => {});
    load();
    if (!ticking) return () => { stale = true; };
    const timer = setInterval(load, 2000);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [open, ticking, conversationId, task.id]);
  return (
    <>
      <div className="async-task-text">
        <span className="async-task-status" data-hint={hints.asyncTask}>
          <span>{asyncTaskStateLabels[task.state]}:</span>
          <button
            type="button"
            className="link async-task-description"
            data-hint={hints.asyncTaskOutput}
            aria-expanded={open}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
          >
            {task.description}
          </button>
          <span>for {formatDuration(now - task.since)}</span>
        </span>
        {task.summary && task.summary !== task.description && <span className="async-task-summary">{task.summary}</span>}
        {open && <pre className="async-task-output">{output ?? "No output yet."}</pre>}
      </div>
      {task.canStop && (
        <button
          type="button"
          className="link"
          data-hint={hints.stopAsyncTask}
          onClick={() => connection.send({ type: "conversation.async-task.stop", conversationId, asyncTaskId: task.id })}
        >
          Stop
        </button>
      )}
      {isFinishedTask(task) && (
        <button
          type="button"
          className="link"
          data-hint={hints.dismissAsyncTask}
          onClick={() => connection.send({ type: "conversation.async-task.dismiss", conversationId, asyncTaskId: task.id })}
        >
          Dismiss
        </button>
      )}
    </>
  );
}

const delegatedEndLabels: Record<DelegatedReply["ended"], string> = { finished: "Finished", stopped: "Stopped", failed: "Failed" };

/** The conversations this one's plugin tools started, such as delegated tasks, until the user dismisses them. */
function DelegatedTasks({ tasks, profiles }: { tasks: Conversation[]; profiles: Profile[] }) {
  return (
    <section className="delegated-tasks" aria-label="Delegated tasks">
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <DelegatedTaskRow task={task} profile={profiles.find(({ id }) => id === task.profileId)?.name ?? harnessLabels[task.harness]} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const withoutBlankLines = (text: string) => text.replace(/\n\s*\n/g, "\n");

function DelegatedTaskRow({ task, profile }: { task: Conversation; profile: string }) {
  const reply = task.startedBy?.reply ?? null;
  const now = useClock(reply === null);
  const detail = reply ? reply.opening && withoutBlankLines(reply.opening) : task.activity?.title;
  return (
    <>
      <div className="delegated-task-text">
        <span data-hint={hints.delegatedTask}>
          {reply ? delegatedEndLabels[reply.ended] : "Working"}:{" "}
          <button type="button" className="link" data-hint={hints.openDelegatedTask} onClick={() => (location.hash = `#/c/${task.id}`)}>
            {task.title}
          </button>{" "}
          on {profile}
          {!reply && ` for ${formatDuration(now - task.createdAt)}`}
        </span>
        {(detail || !reply) && <span className="delegated-task-detail">{detail}</span>}
      </div>
      {!reply && isBusy(task) && (
        <button type="button" className="link" data-hint={hints.stopDelegatedTask} onClick={() => connection.send({ type: "conversation.cancel", conversationId: task.id })}>
          Stop
        </button>
      )}
      {reply && (
        <button
          type="button"
          className="link"
          data-hint={hints.dismissDelegatedTask}
          onClick={() => connection.send({ type: "conversation.delegation.dismiss", conversationId: task.id })}
        >
          Dismiss
        </button>
      )}
    </>
  );
}

function UsageLimitNotice({ conversationId, wait }: { conversationId: string; wait: UsageLimitWait }) {
  return (
    <section className="usage-limit" aria-label="Usage limit">
      <span data-hint={hints.usageLimit}>{usageLimitStatus(wait)}</span>
      <button type="button" data-hint={hints.continueAfterUsageLimit} onClick={() => connection.send({ type: "conversation.usage-limit.continue", conversationId })}>
        Continue now
      </button>
      <button
        type="button"
        className="link"
        data-hint={hints.stopWaitingForUsageLimit}
        onClick={() => connection.send({ type: "conversation.usage-limit.stop-waiting", conversationId })}
      >
        Stop waiting
      </button>
    </section>
  );
}

const MIN_COMPOSER_HEIGHT = 40;
const MAX_COMPOSER_SHARE_OF_PANE = 0.7;
const COMPOSER_KEYBOARD_STEP = 24;

/** The message box's top edge: dragging it sets how tall the box is at least; it still grows with longer text. */
function ComposerGrip({ textarea }: { textarea: RefObject<HTMLTextAreaElement | null> }) {
  const drag = useRef<{ pointerY: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("resizing", dragging);
    document.body.classList.toggle("resizing-rows", dragging);
  }, [dragging]);

  const resizeTo = (height: number) => {
    const pane = textarea.current?.closest(".composer-area")?.parentElement?.clientHeight ?? window.innerHeight;
    setComposerHeight(Math.min(Math.max(height, MIN_COMPOSER_HEIGHT), pane * MAX_COMPOSER_SHARE_OF_PANE));
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!textarea.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerY: event.clientY, height: textarea.current.offsetHeight };
    setDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) resizeTo(drag.current.height + drag.current.pointerY - event.clientY);
  };

  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    setDragging(false);
  };

  const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = ({ ArrowUp: 1, ArrowDown: -1 } as Record<string, number>)[event.key];
    if (!direction || !textarea.current) return;
    event.preventDefault();
    resizeTo(textarea.current.offsetHeight + direction * COMPOSER_KEYBOARD_STEP);
  };

  return (
    <div
      className={`composer-grip ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Message box height"
      tabIndex={0}
      data-hint={hints.composerGrip}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onDoubleClick={() => setComposerHeight(null)}
      onKeyDown={nudge}
    />
  );
}

/** `!git status` in the message box runs `git status` instead of messaging the agent. */
const commandIn = (text: string) => (text.trimStart().startsWith("!") ? text.trimStart().slice(1).trim() : null);

function CommandOutputsAttached({ commands, conversationId }: { commands: UserCommand[]; conversationId: string }) {
  if (commands.length === 0) return null;
  const drop = () => connection.send({ type: "conversation.drop-command-outputs", conversationId, commandIds: commands.map(({ commandId }) => commandId) });
  return (
    <div className="command-outputs-attached" data-hint={hints.commandOutputsAttached}>
      <span>{commands.length === 1 ? "1 command output goes" : `${commands.length} command outputs go`} with your next message</span>
      <button type="button" className="icon" aria-label="Don't send the command outputs" onClick={drop}>
        ✕
      </button>
    </div>
  );
}

const busyPlaceholders: Record<EnterWhileBusy, string> = {
  steer: "adds your message to its turn",
  "after-turn": "sends your message after its turn",
};

function busyPlaceholder(canSteer: boolean, enterWhileBusy: EnterWhileBusy) {
  if (!canSteer) return "The agent is working… Enter queues your message for after its turn, Esc stops the agent";
  const other = enterWhileBusy === "steer" ? "after-turn" : "steer";
  return `The agent is working… Enter ${busyPlaceholders[enterWhileBusy]}, ${keyLabels().option}Enter ${busyPlaceholders[other]}, Esc stops it`;
}

/** While the agent works: one button per way of sending, the one Enter does first. */
function BusySendButtons({ canSteer, enterWhileBusy, onSend }: { canSteer: boolean; enterWhileBusy: EnterWhileBusy; onSend: (afterTurn: boolean) => void }) {
  const keys = shortcutKeys();
  if (!canSteer) {
    return (
      <button className="queue-message" data-shortcut={keys.send} onClick={() => onSend(true)}>
        Queue
      </button>
    );
  }
  const steer = (
    <button
      key="steer"
      className="queue-message"
      data-hint={hints.steerMessage}
      data-shortcut={enterWhileBusy === "steer" ? keys.send : keys.sendTheOtherWay}
      onClick={() => onSend(false)}
    >
      Steer
    </button>
  );
  const afterTurn = (
    <button
      key="after-turn"
      className="queue-message"
      data-hint={hints.afterTurnMessage}
      data-shortcut={enterWhileBusy === "after-turn" ? keys.send : keys.sendTheOtherWay}
      onClick={() => onSend(true)}
    >
      After turn
    </button>
  );
  return enterWhileBusy === "steer" ? [steer, afterTurn] : [afterTurn, steer];
}

function Composer({
  conversation,
  delegatedTasks,
  profiles,
  events,
  holdsEarliest,
  pendingCommands,
  promptTemplates,
  voiceSettings,
  voiceEngine,
  onManageTemplates,
}: {
  conversation: Conversation;
  delegatedTasks: Conversation[];
  profiles: Profile[];
  events: StoredEvent[];
  holdsEarliest: boolean;
  pendingCommands: UserCommand[];
  promptTemplates: PromptTemplate[];
  voiceSettings: VoiceSettings;
  voiceEngine: VoiceEngineStatus;
  onManageTemplates: () => void;
}) {
  const [text, setText] = useDraft(conversation.id);
  const [pickingTemplate, setPickingTemplate] = useState(false);
  const [findingTemplate, setFindingTemplate] = useState(false);
  const [fillingTemplate, setFillingTemplate] = useState(false);
  useEffect(() => {
    if (!text) setFillingTemplate(false);
  }, [text]);
  const templatesButton = useRef<HTMLButtonElement>(null);
  const busy = isBusy(conversation);
  const [stopStage, setStopStage] = useState<"idle" | "stopping" | "force">("idle");
  const stopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setStopStage("idle");
    return () => clearTimeout(stopTimer.current);
  }, [conversation.id]);
  useEffect(() => {
    if (busy) return;
    clearTimeout(stopTimer.current);
    setStopStage("idle");
  }, [busy]);
  const queued = conversation.queuedMessages;
  const command = commandIn(text);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composerHeight = useComposerHeight();
  const images = useComposerImages(conversation.id, text, setText, textarea);
  const droppedFiles = useDroppedFiles(conversation.id, setText, textarea);
  const attaching = images.uploading || droppedFiles.copying;
  const typingAidAttributes = useTypingAidAttributes();
  const enterWhileBusy = useEnterWhileBusy();
  const canSteer = harnessSteers[conversation.harness];
  const stoppedEdit = useStoppedMessageEdit({ conversation, events, holdsEarliest, busy });
  useEffect(() => textarea.current?.focus(), []);

  const sendPrompt = (message: string, imageIds: string[], afterTurn: boolean) => {
    if (!connection.send({ type: "conversation.prompt", conversationId: conversation.id, text: message, imageIds, afterTurn })) return;
    stopReading();
    if (dictation.takeDictated() && speaksReplies(voiceSettings)) awaitSpokenReply(conversation.id, events, { ticks: voiceSettings.keepTalking });
    else forgetSpokenReply(conversation.id);
    setText("");
    images.clearAfterSending();
  };
  const send = (afterTurn = false, message = text) => {
    const command = commandIn(message);
    if (!message.trim() || command === "" || attaching || stoppedEdit.goingBack) return;
    if (isLoginCommand(message)) {
      requestLogin(conversation.id);
      setText("");
      return;
    }
    const panelLine = conversation.harness === "claude" ? panelCommandLine(message) : null;
    if (panelLine) {
      requestPanelCommand(conversation.id, panelLine);
      setText("");
      return;
    }
    if (command !== null) {
      if (connection.send({ type: "conversation.run-command", conversationId: conversation.id, command })) setText("");
      return;
    }
    const imageIds = images.referenced.map(({ imageId }) => imageId);
    if (stoppedEdit.editing) void stoppedEdit.replace().then((replaced) => replaced && sendPrompt(message, imageIds, afterTurn));
    else sendPrompt(message, imageIds, afterTurn);
  };
  const dictation = useDictation({ conversationId: conversation.id, settings: voiceSettings, textarea, setText, sendNow: () => send(enterWhileBusy === "after-turn") });
  useEffect(() => {
    if (!text) dictation.clearOriginals();
  }, [text]);
  const closeTemplates = () => {
    setPickingTemplate(false);
    textarea.current?.focus();
  };
  const sendTemplate = (message: string) => {
    if (connection.send({ type: "conversation.prompt", conversationId: conversation.id, text: message, imageIds: [], afterTurn: enterWhileBusy === "after-turn" })) closeTemplates();
  };
  const insertTemplate = (message: string) => {
    setText((current) => joinDrafts(current, message));
    closeTemplates();
  };
  const select = (range: TextRange) =>
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(range.start, range.end);
    });
  const closeTemplateFinder = () => {
    setFindingTemplate(false);
    select({ start: textarea.current?.selectionStart ?? text.length, end: textarea.current?.selectionEnd ?? text.length });
  };
  /** Code-completion style: the template goes in at the caret with its first value to fill in selected, and Tab goes on to the next. */
  const insertTemplateAtCaret = (template: string) => {
    const start = textarea.current?.selectionStart ?? text.length;
    const end = textarea.current?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + template + text.slice(end);
    setText(next);
    setFindingTemplate(false);
    setFillingTemplate(true);
    const caretAfter = { start: start + template.length, end: start + template.length };
    select(placeholdersIn(next).find((placeholder) => placeholder.start >= start) ?? caretAfter);
  };
  const goToPlaceholder = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab" || event.altKey || event.metaKey || event.ctrlKey || !fillingTemplate) return false;
    const { selectionStart, selectionEnd } = event.currentTarget;
    const placeholder = adjacentPlaceholder(text, { start: selectionStart, end: selectionEnd }, event.shiftKey ? -1 : 1);
    if (!placeholder) return false;
    event.preventDefault();
    event.currentTarget.setSelectionRange(placeholder.start, placeholder.end);
    return true;
  };
  const stop = () => {
    if (stopStage !== "idle") return;
    connection.send({ type: "conversation.cancel", conversationId: conversation.id });
    setStopStage("stopping");
    stopTimer.current = setTimeout(() => setStopStage("force"), STOP_FORCE_GRACE_MS);
  };
  const forceStop = () => {
    clearTimeout(stopTimer.current);
    connection.send({ type: "conversation.cancel", conversationId: conversation.id, force: true });
    setStopStage("force");
  };
  const remove = (message: QueuedMessage) =>
    connection.send({ type: "conversation.queue.remove", conversationId: conversation.id, messageId: message.id });
  const pullBack = (message: QueuedMessage) => {
    remove(message);
    const restoredText = images.restore(message.text, message.imageIds);
    setText((current) => joinDrafts(current, restoredText));
    textarea.current?.focus();
  };
  const afterTurnFor = (event: KeyboardEvent<HTMLTextAreaElement>) => (enterWhileBusy === "after-turn") !== event.altKey;
  /** In the formatted box, Enter in a list or code block adds a line, and ⌘Enter (Ctrl+Enter) sends from anywhere. */
  const enterSends = (event: KeyboardEvent<HTMLTextAreaElement>) =>
    event.metaKey || event.ctrlKey || !(textarea.current as Partial<FormattedBoxExtras> | null)?.enterAddsLine?.();
  const slashCommands = useSlashCommandMenu({
    conversationId: conversation.id,
    harness: conversation.harness,
    events,
    text,
    setText,
    run: (message, event) => send(afterTurnFor(event), message),
  });
  const [caret, setCaret] = useState(0);
  const mentions = useMentionMenu({ conversationId: conversation.id, text, caret, setText, setCaret, textarea });
  const history = usePromptHistory({
    conversationId: conversation.id,
    events,
    holdsEarliest,
    inTheBox: { text, attachments: images.attachments },
    put: (content, recalled) => {
      images.replace(content.attachments);
      setText(content.text);
      setCaret(content.text.length);
      stoppedEdit.recalled(recalled);
    },
  });
  const suggestions = history.showing ? noSuggestions : slashCommands.menu ? slashCommands : mentions;
  const messageBox = useMessageBox();
  const placeholder = busy
    ? stopStage === "force"
      ? "The agent is not responding. Force stop ends its process; other conversations on the profile continue"
      : busyPlaceholder(canSteer, enterWhileBusy)
    : `Message ${harnessLabels[conversation.harness]} (Enter to send, Shift+Enter for a new line, / for its commands, @ for a path, ! to run a shell command)`;
  const typed = (value: string, caret: number) => {
    setText(value);
    setCaret(caret);
    if (!value) stoppedEdit.stopEditing();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (findsTemplate(event.nativeEvent)) {
      event.preventDefault();
      setPickingTemplate(false);
      setFindingTemplate(true);
      return;
    }
    if (suggestions.onKeyDown(event) || goToPlaceholder(event) || movedCaretToLineEdge(event.nativeEvent)) return;
    const lastQueued = queued.at(-1);
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && enterSends(event)) {
      event.preventDefault();
      // The formatted box tells its text as it changes, but this handler may be the last render's, from before.
      send(afterTurnFor(event), event.currentTarget.value);
    } else if (event.key === "ArrowUp" && !text && lastQueued) {
      event.preventDefault();
      pullBack(lastQueued);
    } else if (event.key === "Escape" && busy) {
      event.preventDefault();
      stop();
    } else if (event.key === "Escape" && stoppedEdit.editing) {
      event.preventDefault();
      stoppedEdit.stopEditing();
    } else history.onKeyDown(event);
  };

  return (
    <div className="composer-area">
      <ComposerGrip textarea={textarea} />
      {conversation.usageLimit && <UsageLimitNotice conversationId={conversation.id} wait={conversation.usageLimit} />}
      {conversation.asyncTasks.length > 0 && <BackgroundTasks conversationId={conversation.id} tasks={conversation.asyncTasks} />}
      {delegatedTasks.length > 0 && <DelegatedTasks tasks={delegatedTasks} profiles={profiles} />}
      {conversation.jobWaits.length > 0 && <JobWaits conversationId={conversation.id} waits={conversation.jobWaits} />}
      {queued.length > 0 && <QueuedMessages conversationId={conversation.id} harness={conversation.harness} messages={queued} onEdit={pullBack} onRemove={remove} />}
      <CommandOutputsAttached commands={pendingCommands} conversationId={conversation.id} />
      <PastedImages conversationId={conversation.id} attachments={images.referenced} uploadingNumbers={images.uploadingNumbers} onRemove={images.detach} />
      {images.problem && (
        <div className="composer-problem" role="alert">
          {images.problem}
        </div>
      )}
      {droppedFiles.problem && (
        <div className="composer-problem" role="alert">
          {droppedFiles.problem}
        </div>
      )}
      {dictation.problem && (
        <div className="composer-problem" role="alert">
          {dictation.problem}
        </div>
      )}
      {stoppedEdit.editing && (
        <div className="editing-stopped" role="status">
          Editing your stopped message. Enter replaces it and its answer, and puts back any files it changed; Esc keeps them.
        </div>
      )}
      {stoppedEdit.editing?.problem && (
        <div className="composer-problem" role="alert">
          {stoppedEdit.editing.problem}
        </div>
      )}
      <div
        className={command === null ? "composer" : "composer shell-mode"}
        onDragOver={images.onDragOver}
        onDrop={(event) => {
          images.onDrop(event);
          droppedFiles.onDrop(event);
        }}
      >
        {suggestions.menu}
        {messageBox === "formatted" ? (
          <FormattedBox
            text={text}
            facade={textarea}
            placeholder={placeholder}
            attributes={{ ...typingAidAttributes, ...suggestions.textareaAttributes }}
            style={composerHeight === null ? undefined : { minHeight: composerHeight }}
            onText={typed}
            onCaret={setCaret}
            onKeyDown={onKeyDown}
            onPaste={images.onPaste}
          />
        ) : (
          <textarea
            {...typingAidAttributes}
            {...suggestions.textareaAttributes}
            ref={textarea}
            value={text}
            rows={Math.min(10, Math.max(2, text.split("\n").length))}
            style={composerHeight === null ? undefined : { minHeight: composerHeight }}
            placeholder={placeholder}
            onChange={(event) => typed(event.target.value, event.target.selectionStart)}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={images.onPaste}
          />
        )}
        {findingTemplate && <TemplateFinder templates={promptTemplates} opener={textarea} onInsert={insertTemplateAtCaret} onClose={closeTemplateFinder} />}
        {pickingTemplate && (
          <TemplatePicker
            templates={promptTemplates}
            opener={templatesButton}
            onSend={sendTemplate}
            onInsert={insertTemplate}
            onManage={() => {
              setPickingTemplate(false);
              onManageTemplates();
            }}
            onClose={closeTemplates}
          />
        )}
        <div className="composer-actions">
          {messageBox === "formatted" && <FormatBarToggle />}
          <DictateButton dictation={dictation} />
          {command === null && (
            <button
              ref={templatesButton}
              type="button"
              className="templates"
              aria-haspopup="dialog"
              aria-expanded={pickingTemplate}
              data-hint={hints.promptTemplates}
              data-shortcut={shortcutKeys().templates}
              onClick={() => setPickingTemplate((open) => !open)}
            >
              Templates
            </button>
          )}
          {command !== null ? (
            <button className="run-command" data-hint={hints.runCommand} data-shortcut={shortcutKeys().send} onClick={() => send()} disabled={!command}>
              Run
            </button>
          ) : (
            busy && text.trim() && <BusySendButtons canSteer={canSteer} enterWhileBusy={enterWhileBusy} onSend={send} />
          )}
          {busy ? (
            <button className={`stop stop-${stopStage}`} data-shortcut={shortcutKeys().stop} data-hint={hints.stop} onClick={stopStage === "idle" ? stop : forceStop}>
              {stopStage === "idle" ? "Stop" : stopStage === "stopping" ? "Stopping…" : "Force stop"}
            </button>
          ) : (
            command === null && (
              <button className="send" data-shortcut={shortcutKeys().send} onClick={() => send()} disabled={!text.trim() || attaching || stoppedEdit.goingBack}>
                Send
              </button>
            )
          )}
        </div>
      </div>
      <DictationLines dictation={dictation} settings={voiceSettings} engine={voiceEngine} />
    </div>
  );
}

export function ChatPanel({
  conversation,
  delegatedTasks,
  profiles,
  promptTemplates,
  voiceSettings,
  voiceEngine,
  userPicture,
  onManageTemplates,
  open,
  canvasVisible,
  onToggleCanvas,
  terminalVisible,
  onToggleTerminal,
}: {
  conversation: Conversation;
  /** The conversations this one's plugin tools started that the user hasn't dismissed. */
  delegatedTasks: Conversation[];
  profiles: Profile[];
  promptTemplates: PromptTemplate[];
  voiceSettings: VoiceSettings;
  voiceEngine: VoiceEngineStatus;
  /** The user's profile picture next to their messages; null leaves the person icon. */
  userPicture: string | null;
  onManageTemplates: () => void;
  open: OpenConversation;
  canvasVisible: boolean;
  onToggleCanvas: () => void;
  terminalVisible: boolean;
  onToggleTerminal: () => void;
}) {
  const timeline = useMemo(() => buildTimeline(open.events), [open.events]);
  const readingAs = replyReadingOf(voiceSettings);
  useEffect(() => readWhenSpokenTurnEnds(conversation.id, open.events, timeline, readingAs), [timeline]);
  useEffect(() => askAloudWhenWaiting(conversation.id, open.canvas), [open.canvas]);
  useEffect(() => () => stopReadingIn(conversation.id), [conversation.id]);
  const begun = useMemo(() => !open.loaded || hasBegun(open.events), [open.loaded, open.events]);
  const pendingCommands = useMemo(() => awaitingDelivery(timeline.flatMap((block) => (block.kind === "command" ? [block.command] : []))), [timeline]);
  const awaitingPermission = useMemo(() => toolCallsAwaitingPermission(timeline), [timeline]);
  const { ref, onScroll, holdPlace, isPinned, rememberPlace } = useScrollAnchor();
  const earlier = useEarlierHistory(open);
  const { firstLoaded, loadFrom, loadEarlier } = useLoadedEntries(timeline, open.loaded, { holdPlace, isPinned }, earlier);
  const [subagentToShow, setSubagentToShow] = useState<string | null>(null);
  useEffect(() => {
    if (!subagentToShow) return;
    const card = ref.current?.querySelector<HTMLDetailsElement>(`[data-tool-call-id="${CSS.escape(subagentToShow)}"]`);
    if (card) {
      card.open = true;
      latestWorkIn(card).scrollIntoView({ block: "end", behavior: "smooth" });
    }
    setSubagentToShow(null);
  }, [subagentToShow]);
  const onTimelineScroll = () => {
    onScroll();
    const scroller = ref.current;
    if (scroller && scroller.scrollTop < scroller.clientHeight) loadEarlier();
  };
  const busy = isBusy(conversation);
  const subagents = useMemo(() => subagentsIn(timeline), [timeline]);
  const subagentStates = useMemo(() => new Map(subagents.map((block) => [block.toolCallId, subagentState(block, busy)])), [subagents, busy]);
  const runningSteps = useMemo(() => (busy ? stepsRunning(timeline) : new Set<string>()), [timeline, busy]);
  const runningSubagents = subagents.filter((block) => subagentStates.get(block.toolCallId) === "running");
  const showSubagent = (subagent: SubagentBlock) => {
    loadFrom(timeline.findIndex((block) => subagentsIn([block]).includes(subagent)));
    setSubagentToShow(subagent.toolCallId);
  };
  const showRunningSubagent = () => {
    if (runningSubagents[0]) showSubagent(runningSubagents[0]);
  };
  const waitingApprovals = useMemo(() => approvalsWaiting(timeline), [timeline]);
  const approvalsOutOfView = useApprovalsOutOfView(ref, waitingApprovals, firstLoaded);
  const [approvalToShow, setApprovalToShow] = useState<string | null>(null);
  useEffect(() => {
    if (!approvalToShow) return;
    ref.current?.querySelector(`[data-permission-id="${CSS.escape(approvalToShow)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    setApprovalToShow(null);
  }, [approvalToShow]);
  const showApproval = (approval: PermissionBlock) => {
    loadFrom(timeline.indexOf(approval));
    setApprovalToShow(approval.permissionId);
  };
  const find = useFind({ conversationId: conversation.id, historyLoaded: open.loaded, timeline, timelineRef: ref, firstLoaded, loadFrom, earlier, firstHeldSeq: open.events[0]?.seq, rememberPlace });
  const editsInCanvas = useEditsInCanvas();
  const canvasShowsEdits = canvasVisible && editsInCanvas;
  return (
    <ToolCallsAwaitingPermission.Provider value={awaitingPermission}>
      <SubagentStates.Provider value={subagentStates}>
        <StepsAtWork.Provider value={runningSteps}>
          <CanvasShowsEdits.Provider value={canvasShowsEdits}>
            <ConversationBusy.Provider value={busy}>
              <UserPicture.Provider value={userPicture}>
                <ReadsRepliesAloud.Provider value={readingAs}>
                  <ChatHeader
                    conversation={conversation}
                    profiles={profiles}
                    canvasVisible={canvasVisible}
                    onToggleCanvas={onToggleCanvas}
                    terminalVisible={terminalVisible}
                    onToggleTerminal={onToggleTerminal}
                    runningSubagents={runningSubagents.length}
                    onShowRunningSubagent={showRunningSubagent}
                    onFind={find.open}
                    begun={begun}
                  />
                  {find.query !== null && <FindBar find={find} />}
                  <MatchesFind.Provider value={find.matches}>
                    <div className="timeline" ref={ref} onScroll={onTimelineScroll}>
                      {!open.loaded && <div className="notice-line">Loading…</div>}
                      {open.loaded && timeline.length === 0 && <div className="notice-line">{harnessLabels[conversation.harness]} runs in this workspace's directory. Ask it anything; it can draw in the canvas.</div>}
                      {(firstLoaded > 0 || earlier.available) && (
                        <button type="button" className="notice-line load-earlier" onClick={loadEarlier}>
                          {earlierEntriesLabel(firstLoaded, earlier)}
                        </button>
                      )}
                      {timeline.slice(firstLoaded).map((block, offset) => (
                        <TimestampedEntry
                          key={block.key}
                          block={block}
                          startsGroup={offset === 0 || startsAuthorGroup(timeline, firstLoaded + offset)}
                          harness={conversation.harness}
                          conversationId={conversation.id}
                        />
                      ))}
                      {conversation.status === "running" && <div className="working">Working…</div>}
                    </div>
                  </MatchesFind.Provider>
                  {approvalsOutOfView.length > 0 && <ApprovalsWaiting approvals={approvalsOutOfView} timeline={timeline} onShow={showApproval} />}
                  {runningSubagents.length > 0 && <RunningSubagents conversationId={conversation.id} subagents={runningSubagents} onShow={showSubagent} />}
                  {conversation.openInTerminal && (
                    <div className="terminal-warning" role="status">
                      This session is also open in Claude Code in a terminal ({terminalActivityLabels[conversation.openInTerminal]} there). What happens
                      there doesn't show up here, and a message sent from here splits the session's history: continue in the terminal, or quit
                      it there first.
                    </div>
                  )}
                  <Composer
                    conversation={conversation}
                    delegatedTasks={delegatedTasks}
                    profiles={profiles}
                    events={open.events}
                    holdsEarliest={!open.hasEarlier}
                    pendingCommands={pendingCommands}
                    promptTemplates={promptTemplates}
                    voiceSettings={voiceSettings}
                    voiceEngine={voiceEngine}
                    onManageTemplates={onManageTemplates}
                  />
                  <Statusline conversation={conversation} profiles={profiles} />
                </ReadsRepliesAloud.Provider>
              </UserPicture.Provider>
            </ConversationBusy.Provider>
          </CanvasShowsEdits.Provider>
        </StepsAtWork.Provider>
      </SubagentStates.Provider>
    </ToolCallsAwaitingPermission.Provider>
  );
}
