import { knownEditorIds, knownEditorNames, type EditorSetting, type EditorState } from "../shared/editors.ts";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { PushRelaySetting } from "../shared/push.ts";
import { saveSetting } from "./saved-setting.ts";
import type { PluginUpdate } from "../shared/apps.ts";
import { type CanvasUse, type KeepAwake, type ClaudeProgram, type Profile, type PromptTemplate } from "../shared/model.ts";
import type { VoiceSettings as VoiceSettingsValue } from "../shared/voice.ts";
import type { VoiceEngineStatus } from "../shared/voice-engine.ts";
import type { NewerVersion } from "../shared/newer-version.ts";
import { FontSizePreview, MachineColorPreview, ShellLookPreview, ShellOutputPreview, ThemePreview, WaitingPreview, WorkspaceColorPreview } from "./appearance-previews.tsx";
import { enterWhileBusyLabels, setEnterWhileBusy, useEnterWhileBusy, type EnterWhileBusy } from "./busy-sending.ts";
import { formatBarLabels, messageBoxLabels, setFormatBar, setMessageBox, useFormatBar, useMessageBox, type FormatBarChoice, type MessageBox } from "./message-box.ts";
import { connection } from "./connection.ts";
import { inDesktopApp } from "./desktop-bridge.ts";
import { DeviceSettings } from "./Devices.tsx";
import { UpdatesWaiting } from "./Plugins.tsx";
import { externalImages, setExternalImages, useExternalImagesBlocked } from "./external-images.ts";
import { setEditsInCanvas, useEditsInCanvas } from "./edits-in-canvas.ts";
import { fontScaleLabels, useFontScale } from "./font-scale.ts";
import type { PageLibraries } from "../shared/canvas-export.ts";
import { setPageLibraries, usePageLibraries } from "./page-libraries.ts";
import { rememberSettingsSize } from "./paneLayouts.ts";
import { hints } from "./hints.ts";
import { formatNumber, t } from "./i18n/index.ts";
import { chooseLanguage, language } from "./language.ts";
import { languageNames, type Language } from "../shared/i18n/languages.ts";
import { LONGEST_MACHINE_NAME } from "../shared/machines.ts";
import { NewerVersionNote, UpdateCheckButton } from "./NewerVersion.tsx";
import { machineColorStyleLabels, setMachineColorStyle, useMachineColorStyle } from "./machine-colors.ts";
import { profilePictureDataUrl } from "./profile-picture.ts";
import { PromptTemplateSettings } from "./PromptTemplates.tsx";
import { arrangements, paneLabels, sameSlots, type HideablePane, type LayoutDefault, type PaneId, type Slots } from "./layout.ts";
import {
  changeShellAppearance,
  DEFAULT_CUSTOM_SHELL_COLOURS,
  DEFAULT_SHELL_APPEARANCE,
  isFontFamily,
  shellColourLabels,
  shellFontSizeLabels,
  shellLookLabels,
  useShellAppearance,
  type ShellColours,
  type ShellFontSize,
} from "./shell-look.ts";
import { setShellOutputStyle, useShellOutputStyle } from "./shell-output.ts";
import { isMac } from "./shortcuts.ts";
import type { DevicesListed, SettingsPage } from "./state.ts";
import { notifies, setNotificationsWanted, useNotificationSetting, type NotificationSetting } from "./system-notifications.ts";
import {
  cursorStyleLabels,
  resetTerminalSettings,
  setCopyOnSelect,
  setTerminalSettings,
  TERMINAL_FONT_SIZES,
  TERMINAL_FONT_WEIGHTS_BOLD,
  TERMINAL_LETTER_SPACINGS,
  TERMINAL_LINE_HEIGHTS,
  TERMINAL_SCROLLBACKS,
  terminalFontList,
  terminalPresetLabels,
  useTerminalSettings,
  type TerminalCursorStyle,
  type TerminalPreset,
} from "./terminal-settings.ts";
import { themeLabels, useTheme } from "./theme.ts";
import { usePulsesOn } from "./pulses.ts";
import { VoiceSettings } from "./VoiceSettings.tsx";
import { useTimestampsShown } from "./timestamps.ts";
import { setTypingAids, useTypingAids, type TypingAids } from "./typing-aids.ts";
import { useWaitingStyle, waitingStyleLabels } from "./waiting.ts";
import { setWorkspaceColorStyle, useWorkspaceColorStyle, workspaceColorStyleLabels } from "./workspace-colors.ts";

const text = t.settings;
const thumbnailLabels: Record<PaneId, string> = t.labels.thumbnail;
const startHiddenLabels: Record<HideablePane, string> = t.labels.startHidden;

const typingAidLabels: Record<keyof TypingAids, string> = {
  autocorrect: text.typing.autocorrect,
  predictions: text.typing.predictions,
};

const describe = ([left, top, bottom]: Slots) => text.layout.describe(paneLabels[left], paneLabels[top], paneLabels[bottom]);

function Thumbnail({ slots, hidden }: { slots: Slots; hidden: LayoutDefault["hidden"] }) {
  const isHidden = (pane: PaneId) => pane !== "conversation" && hidden[pane];
  return (
    <span className="layout-thumbnail" aria-hidden="true">
      {slots.map((pane, index) => (
        <span key={pane} className={`layout-thumbnail-pane slot-${index} pane-${pane} ${isHidden(pane) ? "starts-hidden" : ""}`}>
          {thumbnailLabels[pane]}
        </span>
      ))}
    </span>
  );
}

const pageLabels: Record<SettingsPage, string> = t.labels.settingsPage;
const settingsPages = Object.keys(pageLabels) as SettingsPage[];
const pageSteps: Partial<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowUp: -1 };

export function SettingsDialog({
  page: openedAt,
  devices,
  promptTemplates,
  canvasUse,
  keepAwake,
  claudeProgram,
  scriptProgram,
  editor,
  machineName,
  computerName,
  pushRelay,
  avatar,
  voiceSettings,
  voiceEngine,
  profiles,
  version,
  newerVersion,
  pluginUpdates,
  layoutDefault,
  onChange,
  onOpenPlugins,
  onClose,
}: {
  page: SettingsPage | undefined;
  devices: DevicesListed | null;
  promptTemplates: PromptTemplate[];
  canvasUse: CanvasUse;
  keepAwake: KeepAwake;
  claudeProgram: ClaudeProgram;
  scriptProgram: string;
  editor: EditorState;
  machineName: string | null;
  computerName: string;
  pushRelay: PushRelaySetting;
  avatar: string | null;
  voiceSettings: VoiceSettingsValue;
  voiceEngine: VoiceEngineStatus;
  profiles: Profile[];
  version: string;
  newerVersion: NewerVersion | null;
  pluginUpdates: PluginUpdate[];
  layoutDefault: LayoutDefault;
  onChange: (layoutDefault: LayoutDefault) => void;
  onOpenPlugins: () => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState<SettingsPage>(openedAt ?? "appearance");
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const pages: Record<SettingsPage, () => ReactNode> = {
    appearance: () => (
      <>
        <ProfilePictureSettings picture={avatar} />
        <AppearanceSettings />
      </>
    ),
    conversations: () => (
      <>
        <SendingSettings />
        <PromptTemplateSettings templates={promptTemplates} />
        <ExternalImageSettings />
        <FileLinkSettings scriptProgram={scriptProgram} />
        <EditorSettings editor={editor} />
        {isMac && <TypingSettings />}
      </>
    ),
    agents: () => (
      <>
        <AgentSettings claudeProgram={claudeProgram} />
        <KeepAwakeSettings keepAwake={keepAwake} />
      </>
    ),
    voice: () => <VoiceSettings settings={voiceSettings} engine={voiceEngine} profiles={profiles} />,
    terminal: () => <TerminalSettings />,
    canvas: () => (
      <>
        <CanvasSettings canvasUse={canvasUse} />
        <EditApprovalSettings />
        <SavedPageSettings />
      </>
    ),
    plugins: () => (
      <>
        <h3>{t.plugins.title}</h3>
        <p className="hint">{t.plugins.movedHint}</p>
        <button type="button" onClick={onOpenPlugins}>
          {t.plugins.openPlugins}
          <UpdatesWaiting count={pluginUpdates.length} />
        </button>
      </>
    ),
    layout: () => <LayoutSettings layoutDefault={layoutDefault} onChange={onChange} />,
    devices: () => (
      <>
        <MachineNameSettings machineName={machineName} computerName={computerName} />
        <DeviceSettings listed={devices} />
      </>
    ),
    notifications: () => (
      <>
        <NotificationSettings />
        <PushRelaySettings pushRelay={pushRelay} />
      </>
    ),
    about: () => <AboutSettings version={version} newerVersion={newerVersion} claudeProgram={claudeProgram} />,
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal settings" role="dialog" aria-label={text.title} ref={rememberSettingsSize}>
        <header>
          <h2>{text.title}</h2>
          <button className="icon" title={text.close} aria-label={text.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="settings-body">
          <PageList page={page} onChoose={setPage} pluginUpdates={pluginUpdates.length} />
          <div className="settings-page" role="tabpanel" id="settings-page" aria-labelledby={`settings-tab-${page}`}>
            {pages[page]()}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Up and Down move between the pages, as in a list of tabs. */
function PageList({ page, onChoose, pluginUpdates }: { page: SettingsPage; onChoose: (page: SettingsPage) => void; pluginUpdates: number }) {
  const chooseWithArrows = (event: ReactKeyboardEvent<HTMLElement>) => {
    const step = pageSteps[event.key];
    if (!step) return;
    event.preventDefault();
    const next = settingsPages[(settingsPages.indexOf(page) + step + settingsPages.length) % settingsPages.length]!;
    onChoose(next);
    event.currentTarget.querySelector<HTMLElement>(`#settings-tab-${next}`)?.focus();
  };
  return (
    <nav className="settings-pages" role="tablist" aria-orientation="vertical" aria-label={text.pagesLabel} onKeyDown={chooseWithArrows}>
      {settingsPages.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`settings-tab-${id}`}
          aria-selected={id === page}
          aria-controls="settings-page"
          tabIndex={id === page ? 0 : -1}
          onClick={() => onChoose(id)}
        >
          {pageLabels[id]}
          {id === "plugins" && <UpdatesWaiting count={pluginUpdates} />}
        </button>
      ))}
    </nav>
  );
}

function LayoutSettings({ layoutDefault, onChange }: { layoutDefault: LayoutDefault; onChange: (layoutDefault: LayoutDefault) => void }) {
  const startHidden = (pane: HideablePane, hidden: boolean) => onChange({ ...layoutDefault, hidden: { ...layoutDefault.hidden, [pane]: hidden } });
  return (
    <>
      <h3>{text.layout.title}</h3>
      <p className="hint">
        {text.layout.hintStart} <em>{text.layout.resetCommand}</em> {text.layout.hintEnd}
      </p>
      <div className="arrangements" role="radiogroup" aria-label={text.layout.arrangement}>
        {arrangements.map((slots) => {
          const chosen = sameSlots(slots, layoutDefault.slots);
          return (
            <button
              key={slots.join()}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={describe(slots)}
              className={`arrangement ${chosen ? "chosen" : ""}`}
              onClick={() => onChange({ ...layoutDefault, slots })}
            >
              <Thumbnail slots={slots} hidden={layoutDefault.hidden} />
            </button>
          );
        })}
      </div>
      <div className="start-hidden">
        {(["canvas", "terminals"] as const).map((pane) => (
          <label key={pane}>
            <input type="checkbox" checked={layoutDefault.hidden[pane]} onChange={(event) => startHidden(pane, event.target.checked)} />
            {startHiddenLabels[pane]}
          </label>
        ))}
      </div>
    </>
  );
}

/** A choice between looks, each option a small picture of how the app looks with it. */
function PictureChoice<Option extends string>({
  name,
  hint,
  labels,
  chosen,
  columns,
  onChoose,
  preview,
}: {
  name: string;
  hint: string;
  labels: Record<Option, string>;
  chosen: Option;
  columns?: number;
  onChoose: (option: Option) => void;
  preview: (option: Option) => ReactNode;
}) {
  return (
    <div className="picture-choice" data-hint={hint}>
      <div className="picture-choice-name">{name}</div>
      <div
        className="picture-options"
        role="radiogroup"
        aria-label={name}
        style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
      >
        {(Object.keys(labels) as Option[]).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === chosen}
            className={`picture-option ${option === chosen ? "chosen" : ""}`}
            onClick={() => onChoose(option)}
          >
            <span className="picture-preview" aria-hidden="true">
              {preview(option)}
            </span>
            {labels[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProfilePictureSettings({ picture }: { picture: string | null }) {
  const [refusal, setRefusal] = useState("");
  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      connection.send({ type: "settings.set-avatar", image: await profilePictureDataUrl(file) });
      setRefusal("");
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section data-hint={hints.profilePicture}>
      <h3>{text.profilePicture.title}</h3>
      <p className="hint">{text.profilePicture.hint}</p>
      <div className="profile-picture">
        {picture && <img className="profile-picture-preview" src={picture} alt="" />}
        <input
          type="file"
          accept="image/*"
          aria-label={text.profilePicture.title}
          onChange={(event) => {
            void chooseFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {picture && <button type="button" onClick={() => connection.send({ type: "settings.set-avatar", image: null })}>{text.profilePicture.remove}</button>}
        {refusal && (
          <p className="hint profile-picture-refused" role="alert">
            {refusal}
          </p>
        )}
      </div>
    </section>
  );
}

function AppearanceSettings() {
  const [theme, setTheme] = useTheme();
  const [timestampsShown, setTimestampsShown] = useTimestampsShown();
  const [pulsesOn, setPulsesOn] = usePulsesOn();
  const [fontScale, setFontScale] = useFontScale();
  const [waitingStyle, setWaitingStyle] = useWaitingStyle();
  const workspaceColorStyle = useWorkspaceColorStyle();
  const machineColorStyle = useMachineColorStyle();
  const shellOutputStyle = useShellOutputStyle();
  const shellAppearance = useShellAppearance();
  return (
    <>
      <h3>{text.appearance.title}</h3>
      <p className="hint">{text.rememberedInBrowser}</p>
      <LanguageSetting />
      <PictureChoice
        name={text.appearance.textSize}
        hint={hints.textSize}
        labels={fontScaleLabels}
        chosen={fontScale}
        columns={5}
        onChoose={setFontScale}
        preview={(option) => <FontSizePreview scale={option} />}
      />
      <PictureChoice name={text.appearance.theme} hint={hints.theme} labels={themeLabels} chosen={theme} onChoose={setTheme} preview={(option) => <ThemePreview theme={option} />} />
      <PictureChoice
        name={text.appearance.waitingForYou}
        hint={hints.waitingStyle}
        labels={waitingStyleLabels}
        chosen={waitingStyle}
        onChoose={setWaitingStyle}
        preview={(option) => <WaitingPreview style={option} />}
      />
      <PictureChoice
        name={text.appearance.workspaceColours}
        hint={hints.workspaceColorStyle}
        labels={workspaceColorStyleLabels}
        chosen={workspaceColorStyle}
        onChoose={setWorkspaceColorStyle}
        preview={(option) => <WorkspaceColorPreview style={option} />}
      />
      <PictureChoice
        name={text.appearance.machineColours}
        hint={hints.machineColorStyle}
        labels={machineColorStyleLabels}
        chosen={machineColorStyle}
        onChoose={setMachineColorStyle}
        preview={(option) => <MachineColorPreview style={option} />}
      />
      <PictureChoice
        name={text.appearance.shellCommands}
        hint={hints.shellOutputStyle}
        labels={t.labels.shellOutputStyle}
        chosen={shellOutputStyle}
        onChoose={setShellOutputStyle}
        preview={(option) => <ShellOutputPreview style={option} />}
      />
      <PictureChoice
        name={text.appearance.shellColours}
        hint={hints.shellLook}
        labels={shellLookLabels}
        chosen={shellAppearance.look}
        columns={5}
        onChoose={(look) => changeShellAppearance({ look })}
        preview={(look) => <ShellLookPreview look={look} />}
      />
      <ShellLookSettings />
      <div className="appearance-settings">
        <label data-hint={hints.timestamps}>
          <input type="checkbox" checked={timestampsShown} onChange={(event) => setTimestampsShown(event.target.checked)} />
          {text.appearance.showTimestamps}
        </label>
        <label data-hint={hints.pulses}>
          <input type="checkbox" checked={pulsesOn} onChange={(event) => setPulsesOn(event.target.checked)} />
          {text.appearance.pulseStatusDots}
        </label>
      </div>
    </>
  );
}

function LanguageSetting() {
  return (
    <div className="sending-settings">
      <label data-hint={text.appearance.languageHint}>
        {text.appearance.language}
        <select value={language} onChange={(event) => chooseLanguage(event.target.value as Language)}>
          {Object.entries(languageNames).map(([value, name]) => (
            <option key={value} value={value} lang={value}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ShellLookSettings() {
  const { look, custom, font, size } = useShellAppearance();
  const [fontTyped, setFontTyped] = useState(font);
  const fontRefused = fontTyped.trim() !== "" && !isFontFamily(fontTyped);
  const typeFont = (typed: string) => {
    setFontTyped(typed);
    changeShellAppearance({ font: typed });
  };
  const fontAsDefault = font === DEFAULT_SHELL_APPEARANCE.font && size === DEFAULT_SHELL_APPEARANCE.size;
  return (
    <div className="appearance-settings shell-look-settings">
      {look === "custom" && (
        <div className="shell-colours">
          {(Object.keys(shellColourLabels) as (keyof ShellColours)[]).map((part) => (
            <label key={part}>
              <input type="color" value={custom[part]} onChange={(event) => changeShellAppearance({ custom: { ...custom, [part]: event.target.value } })} />
              {shellColourLabels[part]}
            </label>
          ))}
          <button type="button" className="link" onClick={() => changeShellAppearance({ custom: DEFAULT_CUSTOM_SHELL_COLOURS })}>
            {text.appearance.resetColours}
          </button>
        </div>
      )}
      <label data-hint={hints.shellFont}>
        {text.appearance.shellFont}
        <input type="text" value={fontTyped} placeholder={text.appearance.shellFontPlaceholder} spellCheck={false} aria-invalid={fontRefused} onChange={(event) => typeFont(event.target.value)} />
      </label>
      <label data-hint={hints.shellFontSize}>
        {text.appearance.shellTextSize}
        <select value={size} onChange={(event) => changeShellAppearance({ size: event.target.value as ShellFontSize })}>
          {Object.entries(shellFontSizeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="link"
        disabled={fontAsDefault}
        onClick={() => {
          setFontTyped(DEFAULT_SHELL_APPEARANCE.font);
          changeShellAppearance({ font: DEFAULT_SHELL_APPEARANCE.font, size: DEFAULT_SHELL_APPEARANCE.size });
        }}
      >
        {text.resetFont}
      </button>
      {fontRefused && <p className="hint shell-font-refused">{text.fontRefused}</p>}
    </div>
  );
}

function SendingSettings() {
  const enterWhileBusy = useEnterWhileBusy();
  const messageBox = useMessageBox();
  const formatBar = useFormatBar();
  return (
    <>
      <h3>{text.sending.messageBox}</h3>
      <div className="sending-settings">
        <label data-hint={hints.messageBox}>
          {text.sending.box}
          <select value={messageBox} onChange={(event) => setMessageBox(event.target.value as MessageBox)}>
            {Object.entries(messageBoxLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {messageBox === "formatted" && (
          <label data-hint={hints.formatBarSetting}>
            {text.sending.formattingButtons}
            <select value={formatBar} onChange={(event) => setFormatBar(event.target.value as FormatBarChoice)}>
              {Object.entries(formatBarLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <h3>{text.sending.whileAgentWorks}</h3>
      <p className="hint">{text.sending.whileAgentWorksHint}</p>
      <div className="sending-settings">
        <label data-hint={hints.enterWhileBusy}>
          {text.sending.enter}
          <select value={enterWhileBusy} onChange={(event) => setEnterWhileBusy(event.target.value as EnterWhileBusy)}>
            {Object.entries(enterWhileBusyLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

const trimmed = (value: number) => value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

function TerminalSettings() {
  const settings = useTerminalSettings();
  const [fontTyped, setFontTyped] = useState(settings.fontFamily);
  useEffect(() => setFontTyped(settings.fontFamily), [settings.fontFamily]);
  const fontRefused = fontTyped.trim() !== "" && !isFontFamily(fontTyped);
  const typeFont = (typed: string) => {
    setFontTyped(typed);
    if (typed.trim() === "" || isFontFamily(typed)) setTerminalSettings({ fontFamily: typed });
  };
  return (
    <>
      <h3>{text.terminal.title}</h3>
      <p className="hint">{text.rememberedInBrowser}</p>
      <div className="terminal-settings">
        <label data-hint={hints.terminalPreset}>
          {text.terminal.colourPreset}
          <select value={settings.preset} onChange={(event) => setTerminalSettings({ preset: event.target.value as TerminalPreset })}>
            {Object.entries(terminalPresetLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label data-hint={hints.terminalFontFamily}>
          {text.terminal.font}
          <input
            type="text"
            className="terminal-font"
            value={fontTyped}
            placeholder={text.terminal.fontPlaceholder}
            spellCheck={false}
            aria-invalid={fontRefused}
            onChange={(event) => typeFont(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="link"
          disabled={settings.fontFamily === ""}
          onClick={() => {
            setFontTyped("");
            setTerminalSettings({ fontFamily: "" });
          }}
        >
          {text.resetFont}
        </button>
        <div className="terminal-font-preview" aria-hidden="true" style={{ fontFamily: terminalFontList(settings.fontFamily) }}>
          {text.terminal.fontPreview}
        </div>
        {fontRefused && <p className="hint terminal-font-refused">{text.fontRefused}</p>}
        <label data-hint={hints.terminalFontSize}>
          {text.terminal.fontSize}
          <select value={settings.fontSize} onChange={(event) => setTerminalSettings({ fontSize: Number(event.target.value) })}>
            {TERMINAL_FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} px
              </option>
            ))}
          </select>
        </label>
        <label data-hint={hints.terminalLineHeight}>
          {text.terminal.lineHeight}
          <input
            type="range"
            min={TERMINAL_LINE_HEIGHTS.min}
            max={TERMINAL_LINE_HEIGHTS.max}
            step={TERMINAL_LINE_HEIGHTS.step}
            value={settings.lineHeight}
            onChange={(event) => setTerminalSettings({ lineHeight: Number(event.target.value) })}
          />
          <span className="terminal-setting-value" aria-hidden="true">{trimmed(settings.lineHeight)}×</span>
        </label>
        <label data-hint={hints.terminalLetterSpacing}>
          {text.terminal.letterSpacing}
          <input
            type="range"
            min={TERMINAL_LETTER_SPACINGS.min}
            max={TERMINAL_LETTER_SPACINGS.max}
            step={TERMINAL_LETTER_SPACINGS.step}
            value={settings.letterSpacing}
            onChange={(event) => setTerminalSettings({ letterSpacing: Number(event.target.value) })}
          />
          <span className="terminal-setting-value" aria-hidden="true">{trimmed(settings.letterSpacing)} px</span>
        </label>
        <label data-hint={hints.terminalCursorStyle}>
          {text.terminal.cursorStyle}
          <select value={settings.cursorStyle} onChange={(event) => setTerminalSettings({ cursorStyle: event.target.value as TerminalCursorStyle })}>
            {Object.entries(cursorStyleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label data-hint={hints.terminalCursorBlink}>
          <input type="checkbox" checked={settings.cursorBlink} onChange={(event) => setTerminalSettings({ cursorBlink: event.target.checked })} />
          {text.terminal.cursorBlink}
        </label>
        <label data-hint={hints.terminalFontWeightBold}>
          {text.terminal.boldWeight}
          <select value={settings.fontWeightBold} onChange={(event) => setTerminalSettings({ fontWeightBold: Number(event.target.value) })}>
            {TERMINAL_FONT_WEIGHTS_BOLD.map((weight) => (
              <option key={weight} value={weight}>
                {weight}
              </option>
            ))}
          </select>
        </label>
        <label data-hint={hints.terminalScrollback}>
          {text.terminal.scrollback}
          <select value={settings.scrollback} onChange={(event) => setTerminalSettings({ scrollback: Number(event.target.value) })}>
            {TERMINAL_SCROLLBACKS.map((lines) => (
              <option key={lines} value={lines}>
                {text.terminal.scrollbackLines(formatNumber(lines))}
              </option>
            ))}
          </select>
        </label>
        <label data-hint={hints.copyOnSelect}>
          <input type="checkbox" checked={settings.copyOnSelect} onChange={(event) => setCopyOnSelect(event.target.checked)} />
          {text.terminal.copyOnSelect}
        </label>
        <button type="button" className="link" onClick={resetTerminalSettings}>
          {text.terminal.resetToDefaults}
        </button>
      </div>
    </>
  );
}

function AboutSettings({ version, newerVersion, claudeProgram }: { version: string; newerVersion: NewerVersion | null; claudeProgram: ClaudeProgram }) {
  return (
    <>
      <h3>{text.about.title}</h3>
      <p className="hint">Mirador {version}</p>
      <NewerVersionNote newerVersion={newerVersion} />
      <UpdateCheckButton version={version} newerVersion={newerVersion} />
      <p className="hint">Claude Code: {foundClaudeProgram(claudeProgram)}</p>
    </>
  );
}

function foundClaudeProgram({ configured, found, version, installCommand }: ClaudeProgram) {
  if (found) return version ? text.about.runsVersion(found, version) : text.about.runs(found);
  if (configured) return text.about.nothingRuns;
  return text.about.notInstalled(installCommand);
}

function AgentSettings({ claudeProgram }: { claudeProgram: ClaudeProgram }) {
  const [path, setPath] = useState(claudeProgram.configured);
  useEffect(() => setPath(claudeProgram.configured), [claudeProgram.configured]);
  const save = () => {
    if (path.trim() !== claudeProgram.configured) connection.send({ type: "settings.set-claude-program", path: path.trim() });
  };
  return (
    <>
      <h3>Claude Code</h3>
      <p className="hint">{text.agents.hint}</p>
      <div className="sending-settings">
        <label data-hint={hints.claudeProgram(claudeProgram.installFolders)}>
          {text.program}
          <input
            type="text"
            className="claude-program"
            value={path}
            placeholder={text.agents.programPlaceholder}
            spellCheck={false}
            onChange={(event) => setPath(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => event.key === "Enter" && save()}
          />
        </label>
      </div>
      <p className="hint claude-program-found" role="status">
        {foundClaudeProgram(claudeProgram)}
      </p>
    </>
  );
}

function KeepAwakeSettings({ keepAwake }: { keepAwake: KeepAwake }) {
  return (
    <>
      <h3>{text.sleep.title}</h3>
      <p className="hint">{text.sleep.hint}</p>
      <div className="sending-settings">
        <label data-hint={hints.keepAwake}>
          {text.sleep.keepAwake}
          <select value={keepAwake} onChange={(event) => connection.send({ type: "settings.set-keep-awake", keepAwake: event.target.value as KeepAwake })}>
            {Object.entries(t.labels.keepAwake).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

function CanvasSettings({ canvasUse }: { canvasUse: CanvasUse }) {
  return (
    <>
      <h3>{text.canvas.title}</h3>
      <p className="hint">{text.canvas.hint}</p>
      <div className="sending-settings">
        <label data-hint={hints.canvasUse}>
          {text.canvas.use}
          <select value={canvasUse} onChange={(event) => connection.send({ type: "settings.set-canvas-use", canvasUse: event.target.value as CanvasUse })}>
            {Object.entries(t.labels.canvasUse).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

function SavedPageSettings() {
  const libraries = usePageLibraries();
  return (
    <>
      <h3>{text.savedPages.title}</h3>
      <p className="hint">{text.savedPages.hint}</p>
      <div className="sending-settings">
        <label data-hint={hints.pageLibrariesSetting}>
          {text.savedPages.libraries}
          <select value={libraries} onChange={(event) => setPageLibraries(event.target.value as PageLibraries)}>
            {Object.entries(t.labels.pageLibraries).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

function EditApprovalSettings() {
  const editsInCanvas = useEditsInCanvas();
  return (
    <>
      <h3>{text.editApprovals.title}</h3>
      <p className="hint">{text.editApprovals.hint}</p>
      <div className="sending-settings">
        <label data-hint={hints.editsInCanvasSetting}>
          <input type="checkbox" checked={editsInCanvas} onChange={(event) => setEditsInCanvas(event.target.checked)} />
          {text.editApprovals.inCanvas}
        </label>
      </div>
    </>
  );
}

const blockedNotice: Partial<Record<NotificationSetting["permission"], string>> = {
  denied: text.notifications.denied,
  unsupported: text.notifications.unsupported,
};

function NotificationSettings() {
  const setting = useNotificationSetting();
  if (inDesktopApp()) {
    return (
      <>
        <h3>{text.notifications.title}</h3>
        <p className="hint">{text.notifications.desktopApp}</p>
      </>
    );
  }
  const notice = blockedNotice[setting.permission];
  return (
    <>
      <h3>{text.notifications.title}</h3>
      <p className="hint">{text.notifications.browser}</p>
      <div className="notification-settings">
        <label>
          <input
            type="checkbox"
            checked={notifies(setting)}
            disabled={setting.permission === "unsupported"}
            onChange={(event) => void setNotificationsWanted(event.target.checked)}
          />
          {text.notifications.notifyInBrowser}
        </label>
      </div>
      {notice && <p className="hint">{notice}</p>}
    </>
  );
}

function ExternalImageSettings() {
  const choice = externalImages.use();
  const stillBlocked = useExternalImagesBlocked();
  return (
    <>
      <h3>{text.externalImages.title}</h3>
      <p className="hint">{text.externalImages.hint}</p>
      <div className="external-images">
        <label>
          <input type="checkbox" checked={choice === "blocked"} onChange={(event) => setExternalImages(event.target.checked ? "blocked" : "shown")} />
          {text.externalImages.asLinks}
        </label>
      </div>
      {choice === "shown" && stillBlocked && (
        <p className="hint">
          {text.externalImages.loadAfterReload}{" "}
          <button type="button" className="link" onClick={() => location.reload()}>
            {text.externalImages.reload}
          </button>
        </p>
      )}
    </>
  );
}

type ScriptOpener = "text-editor" | "program";

const scriptOpenerLabels: Record<ScriptOpener, string> = { "text-editor": text.fileLinks.textEditor, program: text.fileLinks.programYouName };

function FileLinkSettings({ scriptProgram }: { scriptProgram: string }) {
  const [opener, setOpener] = useState<ScriptOpener>(scriptProgram ? "program" : "text-editor");
  const [program, setProgram] = useState(scriptProgram);
  useEffect(() => {
    setOpener(scriptProgram ? "program" : "text-editor");
    setProgram(scriptProgram);
  }, [scriptProgram]);
  const save = (named: string) => {
    if (named.trim() !== scriptProgram) connection.send({ type: "settings.set-script-program", program: named.trim() });
  };
  const choose = (chosen: ScriptOpener) => {
    setOpener(chosen);
    if (chosen === "text-editor") save("");
  };
  return (
    <>
      <h3>{text.fileLinks.title}</h3>
      <p className="hint">{text.fileLinks.hint}</p>
      <div className="sending-settings">
        <label data-hint={hints.scriptProgram}>
          {text.fileLinks.scriptsOpenIn}
          <select value={opener} onChange={(event) => choose(event.target.value as ScriptOpener)}>
            {Object.entries(scriptOpenerLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {opener === "program" && (
          <label>
            {text.program}
            <input
              type="text"
              className="script-program"
              value={program}
              placeholder={text.fileLinks.programPlaceholder}
              spellCheck={false}
              onChange={(event) => setProgram(event.target.value)}
              onBlur={() => save(program)}
              onKeyDown={(event) => event.key === "Enter" && save(program)}
            />
          </label>
        )}
      </div>
    </>
  );
}

type EditorChoice = EditorSetting["editor"];

function EditorSettings({ editor }: { editor: EditorState }) {
  const [choice, setChoice] = useState<EditorChoice>(editor.setting.editor);
  const savedCommand = editor.setting.editor === "custom" ? editor.setting.command : "";
  const [command, setCommand] = useState(savedCommand);
  useEffect(() => {
    setChoice(editor.setting.editor);
    setCommand(savedCommand);
  }, [editor.setting.editor, savedCommand]);
  const firstFound = editor.found[0];
  const labelOf = (option: EditorChoice) => {
    if (option === "first-found") return firstFound ? text.editor.firstFound(knownEditorNames[firstFound]) : text.editor.firstFoundNone;
    if (option === "custom") return text.editor.command;
    return editor.found.includes(option) ? knownEditorNames[option] : text.editor.notFound(knownEditorNames[option]);
  };
  const choose = (chosen: EditorChoice) => {
    setChoice(chosen);
    if (chosen !== "custom") connection.send({ type: "settings.set-editor", setting: { editor: chosen } });
  };
  const saveCommand = () => {
    if (command.trim() !== savedCommand) connection.send({ type: "settings.set-editor", setting: { editor: "custom", command } });
  };
  return (
    <>
      <h3>{text.editor.title}</h3>
      <p className="hint">{text.editor.hint}</p>
      <div className="sending-settings">
        <label data-hint={hints.editor}>
          {text.editor.opensIn}
          <select className="editor-choice" value={choice} onChange={(event) => choose(event.target.value as EditorChoice)}>
            {(["first-found", ...knownEditorIds, "custom"] as const).map((option) => (
              <option key={option} value={option}>
                {labelOf(option)}
              </option>
            ))}
          </select>
        </label>
        {choice === "custom" && (
          <label data-hint={hints.editorCommand}>
            {text.editor.commandLine}
            <input
              type="text"
              className="editor-command"
              value={command}
              placeholder={text.editor.commandPlaceholder}
              spellCheck={false}
              onChange={(event) => setCommand(event.target.value)}
              onBlur={saveCommand}
              onKeyDown={(event) => event.key === "Enter" && saveCommand()}
            />
          </label>
        )}
      </div>
    </>
  );
}

function MachineNameSettings({ machineName, computerName }: { machineName: string | null; computerName: string }) {
  const [name, setName] = useState(machineName ?? "");
  useEffect(() => setName(machineName ?? ""), [machineName]);
  const save = () => {
    if (name.trim() !== (machineName ?? "")) connection.send({ type: "settings.set-machine-name", machineName: name });
  };
  return (
    <>
      <h3>{text.machine.title}</h3>
      <div className="sending-settings">
        <label data-hint={hints.machineName}>
          {text.machine.name}
          <input
            type="text"
            className="machine-name"
            value={name}
            placeholder={computerName}
            maxLength={LONGEST_MACHINE_NAME}
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => event.key === "Enter" && save()}
          />
        </label>
      </div>
    </>
  );
}

function PushRelaySettings({ pushRelay }: { pushRelay: PushRelaySetting }) {
  const [address, setAddress] = useState(pushRelay.address ?? "");
  const [token, setToken] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setAddress(pushRelay.address ?? ""), [pushRelay.address]);
  const save = async () => {
    const saved = await saveSetting((requestId) => ({ type: "settings.set-push-relay", requestId, address, token: token.trim() || null }));
    setProblem(saved);
    if (!saved) setToken("");
  };
  return (
    <>
      <h3>{text.pushRelay.title}</h3>
      <p className="hint">{text.pushRelay.hint}</p>
      <div className="sending-settings push-relay">
        <label data-hint={hints.pushRelayAddress}>
          {text.pushRelay.address}
          <input type="url" className="push-relay-address" value={address} placeholder="https://push.example.com" spellCheck={false} onChange={(event) => setAddress(event.target.value)} />
        </label>
        <label data-hint={hints.pushRelayToken}>
          {text.pushRelay.token}
          <input
            type="password"
            className="push-relay-token"
            value={token}
            placeholder={pushRelay.tokenSet ? text.pushRelay.tokenSet : ""}
            autoComplete="off"
            onChange={(event) => setToken(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void save()}
          />
        </label>
        <button className="push-relay-save" onClick={() => void save()}>
          {text.pushRelay.save}
        </button>
      </div>
      {problem && <p className="push-relay-problem">{problem}</p>}
    </>
  );
}

function TypingSettings() {
  const typingAids = useTypingAids();
  return (
    <>
      <h3>{text.typing.title}</h3>
      <p className="hint">{text.typing.hint}</p>
      <div className="typing-aids">
        {(["autocorrect", "predictions"] as const).map((aid) => (
          <label key={aid}>
            <input type="checkbox" checked={typingAids[aid]} onChange={(event) => setTypingAids({ ...typingAids, [aid]: event.target.checked })} />
            {typingAidLabels[aid]}
          </label>
        ))}
      </div>
    </>
  );
}
