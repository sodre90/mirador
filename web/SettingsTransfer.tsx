import { useState, type FormEvent } from "react";
import type { PluginOffer } from "../shared/apps.ts";
import type { HostProblem } from "../shared/host-problems.ts";
import { settingsItemKinds, type ConfigFileStatus, type PluginToInstall, type SettingsImportReport, type SettingsItem, type SettingsPlan } from "../shared/settings-file.ts";
import { AlreadyThere } from "./canvas-export.ts";
import { connection } from "./connection.ts";
import { inDesktopApp } from "./desktop-bridge.ts";
import { downloadFile } from "./download-file.ts";
import { replyProblemText } from "./host-error.ts";
import { t } from "./i18n/index.ts";
import { offerPlugin, PluginConsent, type Settled } from "./Plugins.tsx";
import { problemText } from "./problem-text.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";

const words = t.settings.transfer;

const preferenceNames: Record<string, string> = {
  canvasUse: t.settings.canvas.use,
  keepDeletedCanvas: t.settings.canvas.keepDeleted,
  keepAwake: t.settings.sleep.keepAwake,
  reminderMorning: t.reminders.morning,
  olderAfter: t.settings.olderConversations.after,
  conversationOrder: t.shell.sidebar.conversationOrder,
  pluginUpdateMode: t.plugins.updateMode,
  voice: t.labels.settingsPage.voice,
};

const fieldNames: Record<string, string> = {
  model: t.profiles.model,
  mode: t.profiles.mode,
  effort: t.profiles.effort,
  bypassPermissions: t.profiles.yolo,
  askMode: t.profiles.questions,
  idleCompaction: t.profiles.idleCompaction,
  color: t.profiles.colour,
  prelaunch: t.profiles.prelaunch,
  environment: t.profiles.environment,
  pluginSettings: words.kinds["plugin-settings"],
  pluginsOff: t.profiles.tabs.plugins,
  text: t.chat.templates.text,
  profile: t.chat.header.profile,
  newConversationsIn: t.shell.worktrees.startIn,
  worktreeSetup: t.shell.worktrees.setup,
  group: words.group,
  updatesByItself: t.plugins.updatesByItself,
};

const fieldList = (fields: string[]) => fields.map((field) => fieldNames[field] ?? field).join(", ");

const nameOf = ({ kind, name }: SettingsItem) => (kind === "preference" ? (preferenceNames[name] ?? name) : kind === "sidebar-order" ? words.sidebarOrder : name);

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What the host answered, unless it could not. */
function answered<Answer>(answer: Answer | null, reply: { problem: string | null; problemAbout?: HostProblem }): Answer {
  if (answer === null) throw new Error(replyProblemText(reply) ?? "");
  return answer;
}

const exportedSettings = (includeSecrets: boolean) =>
  connection.sendAndAwait(
    (requestId) => ({ type: "settings.export", requestId, includeSecrets }),
    (message, requestId) => (message.type === "settings.exported" && message.requestId === requestId ? answered(message.text, message) : undefined),
  );

const savedExport = (includeSecrets: boolean, path: string, replace: boolean) =>
  connection.sendAndAwait(
    (requestId) => ({ type: "settings.save-export", requestId, includeSecrets, path, replace }),
    (message, requestId) => {
      if (message.type !== "settings.export-saved" || message.requestId !== requestId) return undefined;
      if (message.path !== null) return message.path;
      const text = replyProblemText(message) ?? "";
      throw message.alreadyThere ? new AlreadyThere(text) : new Error(text);
    },
  );

const plannedImport = (text: string) =>
  connection.sendAndAwait(
    (requestId) => ({ type: "settings.plan-import", requestId, text }),
    (message, requestId) => (message.type === "settings.import-planned" && message.requestId === requestId ? answered(message.plan, message) : undefined),
  );

const importedSettings = (text: string, items: string[]) =>
  connection.sendAndAwait(
    (requestId) => ({ type: "settings.import", requestId, text, items }),
    (message, requestId) => (message.type === "settings.imported" && message.requestId === requestId ? answered(message.report, message) : undefined),
  );

const exportFileName = () => `mirador-settings-${new Date().toLocaleDateString("sv")}.json`;
/** The desktop app's webview puts downloads in ~/Downloads without a word, so its own host writes to a chosen path instead. */
const savesExportOnHost = () => inDesktopApp() && window.parent === window;

export function SettingsTransfer({ configFile }: { configFile: ConfigFileStatus | null | undefined }) {
  if (configFile === undefined) return <p className="hint">{words.needsNewerHost}</p>;
  return (
    <>
      <SettingsExport />
      <SettingsImport />
      <ConfigFile status={configFile} />
    </>
  );
}

function SettingsExport() {
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [choosingPath, setChoosingPath] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const exportNow = async () => {
    setProblem(null);
    setStatus(null);
    if (savesExportOnHost()) return setChoosingPath(true);
    setExporting(true);
    try {
      const name = exportFileName();
      downloadFile(name, new Blob([await exportedSettings(includeSecrets)], { type: "application/json" }));
      setStatus(words.downloaded(name));
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setExporting(false);
    }
  };
  return (
    <section>
      <h3>{words.exportTitle}</h3>
      <p className="hint">{words.exportHint}</p>
      <div className="sending-settings">
        <label>
          <input
            type="checkbox"
            checked={includeSecrets}
            onChange={(event) => {
              setIncludeSecrets(event.target.checked);
              setStatus(null);
            }}
          />
          {words.includeSecrets}
        </label>
        <button type="button" disabled={exporting || choosingPath} onClick={() => void exportNow()}>
          {exporting ? words.exporting : words.export}
        </button>
      </div>
      <p className={includeSecrets ? "hint transfer-warning" : "hint"}>{includeSecrets ? words.secretsIncluded : words.secretsLeftOut}</p>
      {choosingPath && (
        <SaveExportForm
          includeSecrets={includeSecrets}
          onSaved={(path) => {
            setChoosingPath(false);
            setStatus(words.savedTo(path));
          }}
          onCancel={() => setChoosingPath(false)}
        />
      )}
      {status && (
        <p className="transfer-saved" role="status">
          {status}
        </p>
      )}
      <Problem text={problem} />
    </section>
  );
}

function SaveExportForm({ includeSecrets, onSaved, onCancel }: { includeSecrets: boolean; onSaved: (path: string) => void; onCancel: () => void }) {
  const [path, setPath] = useState(() => `~/Downloads/${exportFileName()}`);
  const [alreadyThere, setAlreadyThere] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const typingAidAttributes = useTypingAidAttributes();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setProblem(null);
    try {
      onSaved(await savedExport(includeSecrets, path, alreadyThere));
    } catch (error) {
      setAlreadyThere(error instanceof AlreadyThere);
      setProblem(messageOf(error));
      setSaving(false);
    }
  };

  return (
    <form className="transfer-save" onSubmit={(event) => void save(event)}>
      <label>
        {words.saveAs}
        <input
          autoFocus
          spellCheck={false}
          {...typingAidAttributes}
          value={path}
          disabled={saving}
          onChange={(event) => {
            setPath(event.target.value);
            setAlreadyThere(false);
            setProblem(null);
          }}
        />
      </label>
      {problem && (
        <p className="transfer-problem" role="alert">
          {problem}
          {alreadyThere && words.replaceIt}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={saving || !path.trim()}>
          {saving ? words.saving : alreadyThere ? words.replace : words.save}
        </button>
        <button type="button" disabled={saving} onClick={onCancel}>
          {words.cancel}
        </button>
      </div>
    </form>
  );
}

interface ChosenFile {
  text: string;
  plan: SettingsPlan;
}

function SettingsImport() {
  const [reading, setReading] = useState(false);
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const choose = async (chosen: File | undefined) => {
    if (!chosen) return;
    setReading(true);
    setFile(null);
    setProblem(null);
    try {
      const text = await chosen.text();
      setFile({ text, plan: await plannedImport(text) });
    } catch (error) {
      setProblem(messageOf(error));
    }
    setReading(false);
  };
  return (
    <section>
      <h3>{words.importTitle}</h3>
      <p className="hint">{words.importHint}</p>
      <div className="transfer-file">
        <input
          type="file"
          accept=".json,application/json"
          aria-label={words.file}
          disabled={reading}
          onClick={(event) => (event.currentTarget.value = "")}
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        {reading && <span className="hint">{words.reading}</span>}
      </div>
      <Problem text={problem} />
      {file && <PlannedImport key={file.text} file={file} onClose={() => setFile(null)} />}
    </section>
  );
}

function PlannedImport({ file: { text, plan }, onClose }: { file: ChosenFile; onClose: () => void }) {
  const [report, setReport] = useState<SettingsImportReport | null>(null);
  return (
    <>
      {report ? <ImportReport report={report} /> : <ImportChoices text={text} plan={plan} onImported={setReport} onClose={onClose} />}
      {plan.plugins.length > 0 && (
        <>
          <h4>{words.pluginsTitle}</h4>
          <ul className="transfer-plugins">
            {plan.plugins.map((plugin) => (
              <MissingPlugin key={plugin.name} plugin={plugin} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** What is new is ticked from the start; what would overwrite something here is for the user to tick. */
function ImportChoices({ text, plan, onImported, onClose }: { text: string; plan: SettingsPlan; onImported: (report: SettingsImportReport) => void; onClose: () => void }) {
  const choices = plan.items.filter(({ state }) => state !== "same");
  const sameCount = plan.items.length - choices.length;
  const [chosen, setChosen] = useState(() => choices.filter(({ state }) => state === "new").map(({ id }) => id));
  const [importing, setImporting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toggle = (id: string) => setChosen((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
  const bringIn = async () => {
    setImporting(true);
    setProblem(null);
    try {
      onImported(await importedSettings(text, chosen));
    } catch (error) {
      setProblem(messageOf(error));
      setImporting(false);
    }
  };
  const whyNothingToChoose = plan.items.length > 0 ? words.allHereAlready : plan.plugins.length === 0 ? words.nothingInFile : null;
  const note = choices.length === 0 ? whyNothingToChoose : sameCount > 0 ? words.sameHere(sameCount) : null;
  return (
    <div className="transfer-plan">
      {settingsItemKinds.map((kind) => (
        <ItemChoices key={kind} title={words.kinds[kind]} items={choices.filter((item) => item.kind === kind)} chosen={chosen} disabled={importing} onToggle={toggle} />
      ))}
      <Problems problems={plan.problems} />
      {note && <p className="hint">{note}</p>}
      <Problem text={problem} />
      <div className="form-actions">
        {choices.length > 0 && (
          <button type="button" className="primary" disabled={importing || chosen.length === 0} onClick={bringIn}>
            {importing ? words.importing : words.import}
          </button>
        )}
        <button type="button" disabled={importing} onClick={onClose}>
          {choices.length > 0 ? words.dontImport : t.settings.close}
        </button>
      </div>
    </div>
  );
}

function ItemChoices({ title, items, chosen, disabled, onToggle }: { title: string; items: SettingsItem[]; chosen: string[]; disabled: boolean; onToggle: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <fieldset disabled={disabled}>
      <legend>{title}</legend>
      {items.map((item) => (
        <label key={item.id}>
          <input type="checkbox" checked={chosen.includes(item.id)} onChange={() => onToggle(item.id)} />
          <span>
            <span className="transfer-item">{nameOf(item)}</span>
            {item.state === "different" && <span className="transfer-overwrites">{item.differs.length > 0 ? words.overwritesFields(fieldList(item.differs)) : words.overwrites}</span>}
            {item.needs.length > 0 && <span className="transfer-needs">{words.needsValue(item.needs.join(", "))}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function ImportReport({ report: { added, overwritten, problems } }: { report: SettingsImportReport }) {
  const broughtIn = [...added, ...overwritten];
  const counts = [...(added.length > 0 ? [words.added(added.length)] : []), ...(overwritten.length > 0 ? [words.overwritten(overwritten.length)] : [])];
  return (
    <div className="transfer-plan" role="status">
      <p>{counts.length > 0 ? counts.join(", ") : words.nothingImported}</p>
      {broughtIn
        .filter(({ needs }) => needs.length > 0)
        .map((item) => (
          <p key={item.id} className="transfer-needs">
            {nameOf(item)}: {words.needsValue(item.needs.join(", "))}
          </p>
        ))}
      <Problems problems={problems} />
    </div>
  );
}

function MissingPlugin({ plugin: { name, repository, branch, commit } }: { plugin: PluginToInstall }) {
  const [step, setStep] = useState<"idle" | "cloning" | "installed" | PluginOffer>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const offer = async () => {
    setStep("cloning");
    setProblem(null);
    const offered = await offerPlugin((requestId) => ({ type: "plugins.offer", requestId, url: repository, branch }));
    setStep(offered.offer ?? "idle");
    setProblem(offered.problem);
  };
  const settled = (outcome: Settled) => {
    setStep(outcome.agreed && !outcome.problem ? "installed" : "idle");
    setProblem(outcome.problem);
  };
  return (
    <li>
      <span className="transfer-item">{name}</span>
      <span className="transfer-repository">{repository}</span>
      {step === "installed" ? (
        <span className="plugin-status">{words.pluginInstalled}</span>
      ) : (
        typeof step !== "object" && (
          <button type="button" aria-label={`${t.plugins.install}: ${name}`} disabled={step === "cloning"} onClick={offer}>
            {step === "cloning" ? t.plugins.cloning : t.plugins.install}
          </button>
        )
      )}
      {typeof step === "object" && (
        <>
          {commit && !step.commit.startsWith(commit) && <p className="hint transfer-warning">{words.otherCommit(commit)}</p>}
          <PluginConsent question={t.plugins.installQuestion(step.title)} offers={[step]} agree={t.plugins.install} decline={t.plugins.dontInstall} onSettled={settled} />
        </>
      )}
      {problem && <pre className="plugin-output">{problem}</pre>}
    </li>
  );
}

function ConfigFile({ status }: { status: ConfigFileStatus | null }) {
  return (
    <section aria-label={words.configTitle}>
      <h3>{words.configTitle}</h3>
      <p className="hint">{words.configHint}</p>
      {status === null ? (
        <p>{words.configOff}</p>
      ) : (
        <>
          <p>
            <code>{status.path}</code>
          </p>
          <p>{status.found ? words.configRead(status.added.length, status.overwritten.length, status.same.length) : words.configNotFound}</p>
          <Problems problems={status.problems} />
        </>
      )}
    </section>
  );
}

function Problems({ problems }: { problems: HostProblem[] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="form-errors">
      {problems.map((problem) => problemText(problem, t.problems)).map((text) => (
        <li key={text}>{text}</li>
      ))}
    </ul>
  );
}

const Problem = ({ text }: { text: string | null }) =>
  text === null ? null : (
    <p className="transfer-problem" role="alert">
      {text}
    </p>
  );
