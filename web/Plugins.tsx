import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  offerRuns,
  offerSource,
  settingValue,
  type CatalogPlugin,
  type PluginInfo,
  type PluginNews,
  type PluginOffer,
  type PluginSettings as SettingsOfPlugin,
  type PluginScreenshot,
  type PluginSource,
  type PluginTool,
  type PluginUpdate as FoundUpdate,
} from "../shared/apps.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection, type ConnectionStatus } from "./connection.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { choosePluginSetting, usePluginSettings } from "./plugin-settings.ts";

const words = t.plugins;

type PluginsListed = Extract<ServerMessage, { type: "plugins.listed" }>;

/** Sends a change to the plugins and waits for it: null once done, else what went wrong, git's or the build's output included. */
async function changePlugins(send: (requestId: string) => ClientMessage): Promise<string | null> {
  try {
    return await connection.sendAndAwait(send, (message, requestId) => (message.type === "plugins.changed" && message.requestId === requestId ? message.problem : undefined));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

type Offered = { offer: PluginOffer; problem: null } | { offer: null; problem: string };

/** Has the host clone a plugin, or what updating one brings, without building it, for the user to agree to. */
async function offerPlugin(send: (requestId: string) => ClientMessage): Promise<Offered> {
  try {
    return await connection.sendAndAwait(send, (message, requestId) =>
      message.type === "plugins.offered" && message.requestId === requestId ? (message.offer ? { offer: message.offer, problem: null } : { offer: null, problem: message.problem ?? "" }) : undefined,
    );
  } catch (error) {
    return { offer: null, problem: error instanceof Error ? error.message : String(error) };
  }
}

/** Runs `start` when the view opens for it, as when the tile's Install or Update opened it. */
function useStartOnce(wanted: boolean, start: () => void) {
  const started = useRef(false);
  useEffect(() => {
    if (!wanted || started.current) return;
    started.current = true;
    start();
  });
}

const discard = (offers: PluginOffer[]) => offers.forEach(({ id }) => connection.send({ type: "plugins.discard", offerId: id }));

function OfferDetails({ offer }: { offer: PluginOffer }) {
  return (
    <div className="plugin-offer">
      <span className="plugin-title">{offer.title}</span>
      <span className="plugin-version">{offer.version}</span>
      <span className="plugin-source">{offerSource(offer)}</span>
      {offer.replaces && offer.replaces.commits.length > 0 && (
        <ul className="plugin-commits" aria-label={words.commitsOfUpdate(offer.title)}>
          {offer.replaces.commits.map(({ commit, subject }) => (
            <li key={commit}>
              <code>{commit}</code> {subject}
            </li>
          ))}
        </ul>
      )}
      <ul className="plugin-runs" aria-label={words.whatRuns(offer.title)}>
        {offerRuns(offer).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

type Settled = { agreed: boolean; problem: string | null };

/**
 * What the cloned plugins bring, for the user to agree to before any of their code runs. Agreeing builds and installs
 * them one after the other, stopping at the first that fails; declining, or closing Settings first, discards the clones.
 */
function PluginConsent({ question, offers, agree, decline, onSettled }: { question: string; offers: PluginOffer[]; agree: string; decline: string; onSettled: (settled: Settled) => void }) {
  const [installing, setInstalling] = useState<string | null>(null);
  const notSentToInstall = useRef(offers);
  useEffect(() => () => discard(notSentToInstall.current), []);
  const install = async () => {
    for (const offer of offers) {
      notSentToInstall.current = notSentToInstall.current.filter(({ id }) => id !== offer.id);
      setInstalling(offer.title);
      const problem = await changePlugins((requestId) => ({ type: "plugins.install", requestId, offerId: offer.id }));
      if (problem) return onSettled({ agreed: true, problem: offers.length > 1 ? `${offer.title}: ${problem}` : problem });
    }
    onSettled({ agreed: true, problem: null });
  };
  return (
    <div className="plugin-consent" role="group" aria-label={question}>
      <p className="plugin-question">{question}</p>
      {offers.map((offer) => (
        <OfferDetails key={offer.id} offer={offer} />
      ))}
      <p className="hint">{words.consentHint}</p>
      {installing ? (
        <span className="plugin-status">{words.building(installing)}</span>
      ) : (
        <span className="plugin-actions">
          <button type="button" data-hint={hints.agreeToPlugin} onClick={install}>
            {agree}
          </button>
          <button type="button" onClick={() => onSettled({ agreed: false, problem: null })}>
            {decline}
          </button>
        </span>
      )}
    </div>
  );
}

async function findNews(folder: string): Promise<PluginNews & { problem: string | null }> {
  try {
    return await connection.sendAndAwait(
      (requestId) => ({ type: "plugins.find-commits", requestId, folder }),
      (message, requestId) => (message.type === "plugins.commits-found" && message.requestId === requestId ? message : undefined),
    );
  } catch (error) {
    return { release: null, commits: [], problem: error instanceof Error ? error.message : String(error) };
  }
}

function sourceLine(source: PluginSource) {
  switch (source.kind) {
    case "git":
      return [source.remote ?? words.noRemote, source.release ? words.releases : (source.branch ?? words.noBranch), `${source.commit} ${source.subject}`].join(" · ");
    case "linked":
      return words.linkedTo(source.target);
    case "folder":
      return words.folderByHand;
  }
}

type Updating =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "found"; news: PluginNews }
  | { step: "cloning"; news: PluginNews }
  | { step: "consenting"; news: PluginNews; offer: PluginOffer }
  | { step: "failed"; problem: string };

/** How many plugins have new commits, as Mirador found by itself; nothing when none has. */
export function UpdatesWaiting({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="updates-waiting" data-hint={hints.pluginUpdatesWaiting} aria-label={words.updatesWaiting(count)}>
      {count}
    </span>
  );
}

const isNothingNew = ({ release, commits }: PluginNews) => release === null && commits.length === 0;

function PluginUpdate({ plugin, found, startUpdating }: { plugin: PluginInfo; found: PluginNews | undefined; startUpdating: boolean }) {
  const [checked, setUpdating] = useState<Updating>({ step: "idle" });
  const updating: Updating = checked.step === "idle" && found ? { step: "found", news: found } : checked;
  const check = async () => {
    setUpdating({ step: "checking" });
    const { problem, ...news } = await findNews(plugin.folder);
    setUpdating(problem ? { step: "failed", problem } : { step: "found", news });
  };
  const offerUpdate = async (news: PluginNews) => {
    setUpdating({ step: "cloning", news });
    const { offer, problem } = await offerPlugin((requestId) => ({ type: "plugins.offer-update", requestId, folder: plugin.folder }));
    setUpdating(offer ? { step: "consenting", news, offer } : { step: "failed", problem });
  };
  const settled = (news: PluginNews, { problem }: Settled) => setUpdating(problem ? { step: "failed", problem } : { step: "found", news });
  useStartOnce(startUpdating && found !== undefined, () => offerUpdate(found!));
  switch (updating.step) {
    case "idle":
      return (
        <button type="button" data-hint={hints.checkPluginUpdates} onClick={check}>
          {words.checkForUpdates}
        </button>
      );
    case "checking":
      return <span className="plugin-status">{words.checking}</span>;
    case "found":
      if (isNothingNew(updating.news)) {
        return (
          <>
            <span className="plugin-status">{words.upToDate}</span>
            <button type="button" data-hint={hints.checkPluginUpdates} onClick={check}>
              {words.checkAgain}
            </button>
          </>
        );
      }
      return (
        <>
          {updating.news.release && (
            <span className="plugin-release">
              {plugin.version ?? "?"} → {updating.news.release}
            </span>
          )}
          <ul className="plugin-commits" aria-label={words.newCommits(plugin.title ?? plugin.folder)}>
            {updating.news.commits.map(({ commit, subject }) => (
              <li key={commit}>
                <code>{commit}</code> {subject}
              </li>
            ))}
          </ul>
          <button type="button" data-hint={hints.updatePlugin} onClick={() => offerUpdate(updating.news)}>
            {words.update}
          </button>
        </>
      );
    case "cloning":
      return <span className="plugin-status">{words.cloning}</span>;
    case "consenting":
      return (
        <PluginConsent
          question={words.updateQuestion(updating.offer.title)}
          offers={[updating.offer]}
          agree={words.update}
          decline={words.dontUpdate}
          onSettled={(outcome) => settled(updating.news, outcome)}
        />
      );
    case "failed":
      return (
        <>
          <pre className="plugin-output">{updating.problem}</pre>
          <button type="button" data-hint={hints.checkPluginUpdates} onClick={check}>
            {words.checkAgain}
          </button>
        </>
      );
  }
}

function SettingsOf({ settings }: { settings: SettingsOfPlugin }) {
  return (
    <span className="plugin-settings">
      {settings.settings.map((setting) => (
        <label key={setting.id} data-hint={setting.hint}>
          {setting.label}
          <select value={settingValue(settings, setting.id)} onChange={(event) => choosePluginSetting(settings.plugin, setting.id, event.target.value)}>
            {setting.choices.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </span>
  );
}

/** A plugin as the gallery shows it: installed, from the catalog, or both. */
interface GalleryPlugin {
  key: string;
  title: string;
  installed: PluginInfo | null;
  official: CatalogPlugin | null;
}

const galleryOf = (listed: PluginsListed): { installed: GalleryPlugin[]; discover: GalleryPlugin[] } => {
  const official = listed.official ?? [];
  const installed = listed.plugins.map((plugin) => ({
    key: plugin.name ?? plugin.folder,
    title: plugin.title ?? plugin.folder,
    installed: plugin,
    official: official.find(({ name }) => name === plugin.name) ?? null,
  }));
  const discover = toInstall(official, listed.plugins).map((plugin) => ({ key: plugin.name, title: plugin.title, installed: null, official: plugin }));
  return { installed, discover };
};

const toInstall = (official: CatalogPlugin[], installed: PluginInfo[]) => official.filter((plugin) => !installed.some(({ name }) => name === plugin.name));

const MONOGRAM_HUES = [262, 145, 220, 355, 30, 190, 300, 95];

const hueOf = (key: string) => MONOGRAM_HUES[[...key].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0) % MONOGRAM_HUES.length]!;

const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** The plugin's own icon, drawn as an image so its SVG runs no script; its monogram while it has none or the icon fails. */
function PluginIcon({ plugin }: { plugin: GalleryPlugin }) {
  const icon = plugin.installed?.icon ?? plugin.official?.icon;
  const [failed, setFailed] = useState(false);
  if (icon && !failed) return <img className="plugin-icon" src={svgDataUrl(icon)} alt="" onError={() => setFailed(true)} />;
  return (
    <span className="plugin-monogram" aria-hidden style={{ "--monogram-hue": hueOf(plugin.key) } as CSSProperties}>
      {plugin.title.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Screenshots({ title, screenshots }: { title: string; screenshots: PluginScreenshot[] }) {
  return (
    <ul className="plugin-screenshots" aria-label={words.screenshotsOf(title)}>
      {screenshots.map(({ url, caption }) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noreferrer">
            <img src={url} alt={caption} loading="lazy" />
          </a>
          <span>{caption}</span>
        </li>
      ))}
    </ul>
  );
}

function PluginBadges({ plugin, news }: { plugin: GalleryPlugin; news: PluginNews | undefined }) {
  const { installed, official } = plugin;
  return (
    <span className="plugin-badges">
      {installed?.kinds?.map((kind) => (
        <span key={kind} className="plugin-badge">
          {words.kind[kind]}
        </span>
      ))}
      {official && (
        <span className="plugin-badge plugin-official" data-hint={hints.officialPlugin}>
          {words.official}
        </span>
      )}
      {news && <span className="plugin-badge plugin-has-update">{words.updateAvailable}</span>}
      {installed?.problem && <span className="plugin-badge plugin-failed">{words.didntLoadBadge}</span>}
      {installed?.waitsForRestart && <span className="plugin-badge plugin-waits">{words.waitsForRestart}</span>}
    </span>
  );
}

type Start = "install" | "update" | null;

function PluginTile({ plugin, news, onOpen }: { plugin: GalleryPlugin; news: PluginNews | undefined; onOpen: (start: Start) => void }) {
  const action = !plugin.installed ? { label: words.install, start: "install" as const } : news ? { label: words.update, start: "update" as const } : { label: words.open, start: null };
  return (
    <li className={plugin.installed?.problem ? "plugin-tile failed" : "plugin-tile"} aria-label={plugin.title} onClick={() => onOpen(null)}>
      <span className="plugin-tile-top">
        <PluginIcon plugin={plugin} />
        <span className="plugin-title">{plugin.title}</span>
      </span>
      <span className="plugin-tagline">{plugin.official?.description}</span>
      <span className="plugin-tile-bottom">
        <PluginBadges plugin={plugin} news={news} />
        <button
          type="button"
          className={action.start ? "primary" : undefined}
          aria-label={`${action.label} ${plugin.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(action.start);
          }}
        >
          {action.label}
        </button>
      </span>
    </li>
  );
}

function ToolList({ title, tools }: { title: string; tools: PluginTool[] }) {
  return (
    <>
      <h3>{words.toolsHeading}</h3>
      <ul className="plugin-tools" aria-label={words.toolsOf(title)}>
        {tools.map(({ name, description }) => (
          <li key={name}>
            <code>{name}</code> <span title={description}>{description}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function InstallOfficial({ plugin, startInstalling }: { plugin: CatalogPlugin; startInstalling: boolean }) {
  const [step, setStep] = useState<"idle" | "cloning" | PluginOffer>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const offer = async () => {
    setStep("cloning");
    setProblem(null);
    const offered = await offerPlugin((requestId) => ({ type: "plugins.offer", requestId, url: plugin.repo, branch: plugin.branch ?? null }));
    setStep(offered.offer ?? "idle");
    setProblem(offered.problem);
  };
  useStartOnce(startInstalling, offer);
  const settled = (outcome: Settled) => {
    setStep("idle");
    setProblem(outcome.problem);
  };
  return (
    <>
      {typeof step === "object" ? (
        <PluginConsent question={words.installQuestion(step.title)} offers={[step]} agree={words.install} decline={words.dontInstall} onSettled={settled} />
      ) : (
        <span className="plugin-actions">
          <button type="button" className="primary" data-hint={hints.installOfficialPlugin} disabled={step === "cloning"} onClick={offer}>
            {step === "cloning" ? words.cloning : words.install}
          </button>
        </span>
      )}
      {problem && <pre className="plugin-output">{problem}</pre>}
    </>
  );
}

function InstalledDetail({ plugin, title, news, startUpdating }: { plugin: PluginInfo; title: string; news: PluginNews | undefined; startUpdating: boolean }) {
  const settings = usePluginSettings().find(({ plugin: name }) => name === plugin.name);
  const [problem, setProblem] = useState<string | null>(null);
  const linked = plugin.source.kind === "linked";
  const remove = async () => setProblem(await changePlugins((requestId) => ({ type: "plugins.remove", requestId, folder: plugin.folder })));
  return (
    <>
      {plugin.problem && <p className="plugin-problem">{words.didntLoad(plugin.problem)}</p>}
      {plugin.tools && plugin.tools.length > 0 && <ToolList title={title} tools={plugin.tools} />}
      {settings && settings.settings.length > 0 && (
        <>
          <h3>{words.settingsHeading}</h3>
          <SettingsOf settings={settings} />
        </>
      )}
      {plugin.source.kind === "git" && (
        <span className="plugin-actions">
          <PluginUpdate key={plugin.source.commit} plugin={plugin} found={news} startUpdating={startUpdating} />
        </span>
      )}
      <details className="plugin-upkeep">
        <summary>{words.details}</summary>
        <dl>
          <dt>{words.nameLabel}</dt>
          <dd>{plugin.name ?? "?"}</dd>
          <dt>{words.versionLabel}</dt>
          <dd>{plugin.version ?? "?"}</dd>
          <dt>{words.sourceLabel}</dt>
          <dd className="plugin-source">{sourceLine(plugin.source)}</dd>
          <dt>{words.folderLabel}</dt>
          <dd>
            <code>{plugin.folder}</code>
          </dd>
        </dl>
        <span className="plugin-actions">
          <ConfirmButton
            className="danger"
            label={words.removeLabel(title)}
            armedText={linked ? words.removeLinkArmed : words.removeArmed}
            armedHint={linked ? hints.unlinkPluginArmed : hints.removePluginArmed}
            onConfirm={remove}
          >
            {words.remove}
          </ConfirmButton>
        </span>
        {problem && <pre className="plugin-output">{problem}</pre>}
      </details>
    </>
  );
}

function PluginDetail({ plugin, news, start, onBack }: { plugin: GalleryPlugin; news: PluginNews | undefined; start: Start; onBack: () => void }) {
  return (
    <section className="plugin-detail" aria-label={plugin.title}>
      <button type="button" className="link" onClick={onBack}>
        {words.allPlugins}
      </button>
      <header className="plugin-detail-head">
        <PluginIcon plugin={plugin} />
        <h3>{plugin.title}</h3>
      </header>
      <PluginBadges plugin={plugin} news={news} />
      {plugin.official && <p className="plugin-description">{plugin.official.description}</p>}
      {plugin.official?.screenshots && <Screenshots title={plugin.title} screenshots={plugin.official.screenshots} />}
      {plugin.installed ? (
        <InstalledDetail plugin={plugin.installed} title={plugin.title} news={news} startUpdating={start === "update"} />
      ) : (
        plugin.official && <InstallOfficial plugin={plugin.official} startInstalling={start === "install"} />
      )}
    </section>
  );
}

function AddFromGit() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="link plugin-add-from-git" data-hint={hints.addPlugin} onClick={() => setOpen(true)}>
        {words.addFromGitOpen}
      </button>
    );
  }
  return (
    <>
      <h3>{words.addFromGit}</h3>
      <p className="hint">{words.addFromGitHint}</p>
      <AddPlugin />
    </>
  );
}

function AddPlugin() {
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [cloning, setCloning] = useState(false);
  const [offer, setOffer] = useState<PluginOffer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const add = async (event: FormEvent) => {
    event.preventDefault();
    setCloning(true);
    setProblem(null);
    const offered = await offerPlugin((requestId) => ({ type: "plugins.offer", requestId, url, branch: branch.trim() || null }));
    setCloning(false);
    setOffer(offered.offer);
    setProblem(offered.problem);
  };
  const settled = ({ agreed, problem }: Settled) => {
    setOffer(null);
    setProblem(problem);
    if (agreed && !problem) {
      setUrl("");
      setBranch("");
    }
  };
  const busy = cloning || offer !== null;
  return (
    <form className="plugin-add" aria-label={words.addLabel} onSubmit={add}>
      <input aria-label={words.urlLabel} placeholder={words.urlPlaceholder} value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} />
      <input aria-label={words.branchLabel} placeholder={words.branchPlaceholder} value={branch} disabled={busy} onChange={(event) => setBranch(event.target.value)} />
      <button type="submit" data-hint={hints.addPlugin} disabled={busy || !url.trim()}>
        {cloning ? words.cloning : words.add}
      </button>
      {offer && <PluginConsent question={words.installQuestion(offer.title)} offers={[offer]} agree={words.install} decline={words.dontInstall} onSettled={settled} />}
      {problem && <pre className="plugin-output">{problem}</pre>}
    </form>
  );
}

/** Asked for again whenever the page reconnects, as it does after a restart. */
function usePluginsListed() {
  const [listed, setListed] = useState<PluginsListed | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(connection.status);
  useEffect(() => connection.onStatus(setStatus), []);
  useEffect(
    () =>
      connection.onMessage((message) => {
        if (message.type === "plugins.listed") setListed(message);
      }),
    [],
  );
  useEffect(() => {
    if (status === "open") connection.send({ type: "plugins.list" });
  }, [status]);
  return listed;
}

/** The news Mirador found for the plugin: none once it was updated past the commit it was found from. */
function newsFor(plugin: PluginInfo, pluginUpdates: FoundUpdate[]): PluginNews | undefined {
  const found = pluginUpdates.find(({ folder }) => folder === plugin.folder);
  return found && plugin.source.kind === "git" && plugin.source.commit === found.from ? found : undefined;
}

/** Clones every plugin's update, then asks once for all of them; stops at the first clone or build that fails. */
function UpdateAll({ updates }: { updates: FoundUpdate[] }) {
  const [cloning, setCloning] = useState<string | null>(null);
  const [offers, setOffers] = useState<PluginOffer[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const offerAll = async () => {
    setProblem(null);
    const offered: PluginOffer[] = [];
    for (const { folder, title } of updates) {
      setCloning(title);
      const { offer, problem } = await offerPlugin((requestId) => ({ type: "plugins.offer-update", requestId, folder }));
      if (!offer) {
        discard(offered);
        setCloning(null);
        return setProblem(`${title}: ${problem}`);
      }
      offered.push(offer);
    }
    setCloning(null);
    setOffers(offered);
  };
  const settled = (outcome: Settled) => {
    setOffers(null);
    setProblem(outcome.problem);
  };
  return (
    <div className="plugin-update-all">
      {cloning ? (
        <span className="plugin-status">{words.cloningPlugin(cloning)}</span>
      ) : offers ? (
        <PluginConsent
          question={offers.length === 1 ? words.updateQuestion(offers[0]!.title) : words.updateSeveralQuestion(offers.length)}
          offers={offers}
          agree={words.updateAll}
          decline={words.dontUpdate}
          onSettled={settled}
        />
      ) : (
        <button type="button" data-hint={hints.updateAllPlugins} onClick={offerAll}>
          {words.updateAllCount(updates.length)}
        </button>
      )}
      {problem && <pre className="plugin-output">{problem}</pre>}
    </div>
  );
}

function TileList({ label, plugins, newsOf, onOpen }: { label: string; plugins: GalleryPlugin[]; newsOf: (plugin: GalleryPlugin) => PluginNews | undefined; onOpen: (plugin: GalleryPlugin, start: Start) => void }) {
  return (
    <ul className="plugin-tiles" aria-label={label}>
      {plugins.map((plugin) => (
        <PluginTile key={plugin.key} plugin={plugin} news={newsOf(plugin)} onOpen={(start) => onOpen(plugin, start)} />
      ))}
    </ul>
  );
}

/** Plugins, as a gallery of what each does; a tile opens what it gives the agent, its settings and its upkeep. */
export function PluginsDialog({ pluginUpdates, onClose }: { pluginUpdates: FoundUpdate[]; onClose: () => void }) {
  const listed = usePluginsListed();
  const [opened, setOpened] = useState<{ key: string; start: Start } | null>(null);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const gallery = listed ? galleryOf(listed) : { installed: [], discover: [] };
  const newsOf = ({ installed }: GalleryPlugin) => (installed ? newsFor(installed, pluginUpdates) : undefined);
  const waiting = pluginUpdates.filter(({ folder }) => listed?.plugins.some((plugin) => plugin.folder === folder && newsFor(plugin, pluginUpdates)));
  const openedPlugin = opened && [...gallery.installed, ...gallery.discover].find(({ key }) => key === opened.key);
  const open = (plugin: GalleryPlugin, start: Start) => setOpened({ key: plugin.key, start });
  const openedIsGone = opened !== null && listed !== null && !openedPlugin;
  useEffect(() => {
    if (openedIsGone) setOpened(null);
  }, [openedIsGone]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal plugins" role="dialog" aria-label={words.title}>
        <header>
          <h2>{words.title}</h2>
          <button className="icon" title={t.shell.close} aria-label={t.shell.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="plugins-body">
          {listed?.restartNeeded && (
            <p className="restart-needed">
              {words.restartNeeded}
              <button type="button" data-hint={hints.restartHost} onClick={() => connection.send({ type: "host.restart" })}>
                {t.shell.app.restartHost}
              </button>
            </p>
          )}
          {openedPlugin ? (
            <PluginDetail key={openedPlugin.key} plugin={openedPlugin} news={newsOf(openedPlugin)} start={opened.start} onBack={() => setOpened(null)} />
          ) : (
            <>
              <p className="hint">
                {words.introBeforeFolder}
                {listed ? <code>{listed.folder}</code> : words.pluginsFolder}
                {words.introAfterFolder}
              </p>
              {waiting.length > 0 && <UpdateAll updates={waiting} />}
              <h3>{words.installed}</h3>
              {gallery.installed.length > 0 ? <TileList label={words.installed} plugins={gallery.installed} newsOf={newsOf} onOpen={open} /> : listed && <p className="plugin-none">{words.noPlugins}</p>}
              {gallery.discover.length > 0 && (
                <>
                  <h3>{words.discover}</h3>
                  <p className="hint">{words.moreOfficialHint}</p>
                  <TileList label={words.discover} plugins={gallery.discover} newsOf={newsOf} onOpen={open} />
                </>
              )}
              <AddFromGit />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
