import { useEffect, useRef, useState, type FormEvent } from "react";
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
  type PluginUpdateMode,
} from "../shared/apps.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection, type ConnectionStatus } from "./connection.ts";
import { hints } from "./hints.ts";
import { describedText, replyProblemText } from "./host-error.ts";
import { t } from "./i18n/index.ts";
import { choosePluginSetting, usePluginSettings } from "./plugin-settings.ts";
import { PluginIcon } from "./PluginIcon.tsx";

const words = t.plugins;

type PluginsListed = Extract<ServerMessage, { type: "plugins.listed" }>;

/** Sends a change to the plugins and waits for it: null once done, else what went wrong, git's or the build's output included. */
async function changePlugins(send: (requestId: string) => ClientMessage): Promise<string | null> {
  try {
    return await connection.sendAndAwait(send, (message, requestId) => (message.type === "plugins.changed" && message.requestId === requestId ? replyProblemText(message) : undefined));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

type Offered = { offer: PluginOffer; problem: null } | { offer: null; problem: string };

/** Has the host clone a plugin, or what updating one brings, without building it, for the user to agree to. */
async function offerPlugin(send: (requestId: string) => ClientMessage): Promise<Offered> {
  try {
    return await connection.sendAndAwait(send, (message, requestId) =>
      message.type === "plugins.offered" && message.requestId === requestId ? (message.offer ? { offer: message.offer, problem: null } : { offer: null, problem: replyProblemText(message) ?? "" }) : undefined,
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
      (message, requestId) => (message.type === "plugins.commits-found" && message.requestId === requestId ? { ...message, problem: replyProblemText(message) } : undefined),
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

/** When a found update goes in by itself, or why it waits for the user; nothing while the user is asked for each. */
function whenItGoesIn(found: FoundUpdate | undefined, mode: PluginUpdateMode): string | null {
  if (mode === "ask" || !found) return null;
  if (found.heldBack) return words.heldBack[found.heldBack];
  if (!found.ready) return null;
  return mode === "with-mirador" ? words.goesInWithMirador : words.goesInAtRestart;
}

function PluginUpdate({ plugin, found, goesIn, startUpdating }: { plugin: PluginInfo; found: PluginNews | undefined; goesIn: string | null; startUpdating: boolean }) {
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
          {goesIn && <span className="plugin-goes-in">{goesIn}</span>}
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

/** The catalog's pictures load through the host, since the page may block images from other sites. */
const throughTheHost = (url: string) => `/plugin-screenshot?url=${encodeURIComponent(url)}`;

/** An installed plugin's own words and pictures, from its plugin.json, else the catalog's. */
const descriptionOf = ({ installed, official }: GalleryPlugin) => installed?.description ?? official?.description ?? null;
const taglineOf = (plugin: GalleryPlugin) => plugin.installed?.tagline ?? plugin.official?.tagline ?? descriptionOf(plugin);
const picturesOf = ({ installed, official }: GalleryPlugin): PluginScreenshot[] =>
  installed && installed.screenshots.length > 0 ? installed.screenshots : (official?.screenshots ?? []).map(({ url, caption }) => ({ url: throughTheHost(url), caption }));

/** Fetched while the gallery is open, so a plugin's page shows its pictures at once rather than after the host has fetched them. */
function usePicturesFetchedAhead(official: CatalogPlugin[] | undefined) {
  const urls = (official ?? []).flatMap(({ screenshots }) => (screenshots ?? []).map(({ url }) => url));
  const key = urls.join("\n");
  useEffect(() => {
    for (const url of urls) new Image().src = throughTheHost(url);
  }, [key]);
}

function Screenshots({ title, screenshots }: { title: string; screenshots: PluginScreenshot[] }) {
  const [shown, setShown] = useState<number | null>(null);
  return (
    <>
      <ul className="plugin-screenshots" aria-label={words.screenshotsOf(title)}>
        {screenshots.map(({ url, caption }, index) => (
          <li key={url}>
            <button type="button" className="plugin-screenshot" onClick={() => setShown(index)}>
              <img src={url} alt={caption} loading="lazy" />
            </button>
            <span>{caption}</span>
          </li>
        ))}
      </ul>
      {shown !== null && <PictureViewer screenshots={screenshots} shown={shown} onShow={setShown} onClose={() => setShown(null)} />}
    </>
  );
}

/** A picture large, over the plugin's page; the arrow keys step through them, Escape closes just the picture. */
function PictureViewer({ screenshots, shown, onShow, onClose }: { screenshots: PluginScreenshot[]; shown: number; onShow: (index: number) => void; onClose: () => void }) {
  const count = screenshots.length;
  const step = (by: number) => onShow((shown + by + count) % count);
  const keys: Record<string, () => void> = { Escape: onClose, ArrowLeft: () => step(-1), ArrowRight: () => step(1) };
  const latestKeys = useRef(keys);
  latestKeys.current = keys;
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const handle = latestKeys.current[event.key];
      if (!handle) return;
      event.preventDefault();
      handle();
    };
    window.addEventListener("keydown", handleKey, { capture: true });
    return () => window.removeEventListener("keydown", handleKey, { capture: true });
  }, []);
  const { url, caption } = screenshots[shown]!;
  return (
    <div className="plugin-viewer" role="group" aria-label={words.pictureOf(shown + 1, count)} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <button type="button" className="icon plugin-viewer-close" title={words.closePicture} aria-label={words.closePicture} onClick={onClose}>
        ×
      </button>
      <figure>
        <img src={url} alt={caption} />
        <figcaption>
          {count > 1 && (
            <button type="button" className="icon" title={words.previousPicture} aria-label={words.previousPicture} onClick={() => step(-1)}>
              ‹
            </button>
          )}
          <span>{caption}</span>
          {count > 1 && (
            <button type="button" className="icon" title={words.nextPicture} aria-label={words.nextPicture} onClick={() => step(1)}>
              ›
            </button>
          )}
        </figcaption>
      </figure>
    </div>
  );
}

function PluginBadges({ plugin, news }: { plugin: GalleryPlugin; news: FoundUpdate | undefined }) {
  const { installed, official } = plugin;
  return (
    <span className="plugin-badges">
      {(installed?.kinds ?? official?.kinds)?.map((kind) => (
        <span key={kind} className="plugin-badge">
          {words.kind[kind]}
        </span>
      ))}
      {official && (
        <span className="plugin-badge plugin-official" data-hint={hints.officialPlugin}>
          {words.official}
        </span>
      )}
      {news && (news.ready ? <span className="plugin-badge plugin-update-ready">{words.updateReady}</span> : <span className="plugin-badge plugin-has-update">{words.updateAvailable}</span>)}
      {installed?.problem && <span className="plugin-badge plugin-failed">{words.didntLoadBadge}</span>}
      {installed?.waitsForRestart && <span className="plugin-badge plugin-waits">{words.waitsForRestart}</span>}
    </span>
  );
}

type Start = "install" | "update" | null;

const mainActionOf = (plugin: GalleryPlugin, news: PluginNews | undefined) =>
  !plugin.installed ? { label: words.install, start: "install" as const } : news ? { label: words.update, start: "update" as const } : null;

/** The whole tile opens the plugin's page; its title is the button that does so for the keyboard. */
function PluginTile({ plugin, news, updating, onOpen }: { plugin: GalleryPlugin; news: FoundUpdate | undefined; updating: boolean; onOpen: (start: Start) => void }) {
  const action = mainActionOf(plugin, news);
  return (
    <li className={plugin.installed?.problem ? "plugin-tile failed" : "plugin-tile"} aria-label={plugin.title} onClick={() => onOpen(null)}>
      <span className="plugin-tile-top">
        <PluginIcon name={plugin.key} title={plugin.title} icon={plugin.installed?.icon ?? plugin.official?.icon} />
        <button type="button" className="plugin-title" onClick={(event) => (event.stopPropagation(), onOpen(null))}>
          {plugin.title}
        </button>
      </span>
      <span className="plugin-tagline">{taglineOf(plugin)}</span>
      <span className="plugin-tile-bottom">
        <PluginBadges plugin={plugin} news={news} />
        {action && (
          <button
            type="button"
            className="primary"
            aria-label={`${action.label} ${plugin.title}`}
            aria-busy={updating}
            disabled={updating}
            onClick={(event) => (event.stopPropagation(), onOpen(action.start))}
          >
            {updating && <span className="button-spinner" aria-hidden="true" />}
            {action.label}
          </button>
        )}
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

function useInstallOfficial(plugin: CatalogPlugin | null, startInstalling: boolean) {
  const [step, setStep] = useState<"idle" | "cloning" | PluginOffer>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const offer = async () => {
    if (!plugin) return;
    setStep("cloning");
    setProblem(null);
    const offered = await offerPlugin((requestId) => ({ type: "plugins.offer", requestId, url: plugin.repo, branch: plugin.branch ?? null }));
    setStep(offered.offer ?? "idle");
    setProblem(offered.problem);
  };
  useStartOnce(startInstalling && plugin !== null, offer);
  const settled = (outcome: Settled) => {
    setStep("idle");
    setProblem(outcome.problem);
  };
  return { step, problem, offer, settled };
}

type Installing = ReturnType<typeof useInstallOfficial>;

function InstallButton({ installing }: { installing: Installing }) {
  const { step, offer } = installing;
  if (typeof step === "object") return null;
  return (
    <button type="button" className="primary" data-hint={hints.installOfficialPlugin} disabled={step === "cloning"} onClick={offer}>
      {step === "cloning" ? words.cloning : words.install}
    </button>
  );
}

function InstallConsent({ installing }: { installing: Installing }) {
  const { step, problem, settled } = installing;
  return (
    <>
      {typeof step === "object" && <PluginConsent question={words.installQuestion(step.title)} offers={[step]} agree={words.install} decline={words.dontInstall} onSettled={settled} />}
      {problem && <pre className="plugin-output">{problem}</pre>}
    </>
  );
}

function InstalledDetail({
  plugin,
  title,
  news,
  updateMode,
  startUpdating,
}: {
  plugin: PluginInfo;
  title: string;
  news: FoundUpdate | undefined;
  updateMode: PluginUpdateMode;
  startUpdating: boolean;
}) {
  const settings = usePluginSettings().find(({ plugin: name }) => name === plugin.name);
  const [problem, setProblem] = useState<string | null>(null);
  const linked = plugin.source.kind === "linked";
  const remove = async () => setProblem(await changePlugins((requestId) => ({ type: "plugins.remove", requestId, folder: plugin.folder })));
  const setUpdatesByItself = (updatesByItself: boolean) => connection.send({ type: "plugins.set-updates-by-itself", folder: plugin.folder, updatesByItself });
  return (
    <>
      {plugin.problem && <p className="plugin-problem">{words.didntLoad(describedText(plugin.problem, plugin.problemAbout))}</p>}
      {plugin.tools && plugin.tools.length > 0 && <ToolList title={title} tools={plugin.tools} />}
      {settings && settings.settings.length > 0 && (
        <>
          <h3>{words.settingsHeading}</h3>
          <SettingsOf settings={settings} />
        </>
      )}
      {plugin.source.kind === "git" && plugin.source.release !== null && updateMode !== "ask" && (
        <label className="plugin-updates-by-itself" data-hint={hints.pluginUpdatesByItself}>
          <input type="checkbox" checked={plugin.updatesByItself} onChange={(event) => setUpdatesByItself(event.target.checked)} />
          {words.updatesByItself}
        </label>
      )}
      {plugin.source.kind === "git" && (
        <span className="plugin-actions">
          <PluginUpdate key={plugin.source.commit} plugin={plugin} found={news} goesIn={whenItGoesIn(news, updateMode)} startUpdating={startUpdating} />
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

function PluginDetail({ plugin, news, updateMode, start, onBack }: { plugin: GalleryPlugin; news: FoundUpdate | undefined; updateMode: PluginUpdateMode; start: Start; onBack: () => void }) {
  const installing = useInstallOfficial(plugin.installed ? null : plugin.official, start === "install");
  return (
    <section className="plugin-detail" aria-label={plugin.title}>
      <button type="button" className="link" onClick={onBack}>
        {words.allPlugins}
      </button>
      <header className="plugin-detail-head">
        <PluginIcon name={plugin.key} title={plugin.title} icon={plugin.installed?.icon ?? plugin.official?.icon} />
        <span className="plugin-detail-name">
          <h3>{plugin.title}</h3>
          <PluginBadges plugin={plugin} news={news} />
        </span>
        {!plugin.installed && plugin.official && <InstallButton installing={installing} />}
      </header>
      {descriptionOf(plugin) && <p className="plugin-description">{descriptionOf(plugin)}</p>}
      {!plugin.installed && <InstallConsent installing={installing} />}
      {picturesOf(plugin).length > 0 && <Screenshots title={plugin.title} screenshots={picturesOf(plugin)} />}
      {plugin.installed && <InstalledDetail plugin={plugin.installed} title={plugin.title} news={news} updateMode={updateMode} startUpdating={start === "update"} />}
    </section>
  );
}

function AddFromGit({ folder }: { folder: string | null }) {
  const [open, setOpen] = useState(false);
  const whereTheyLive = (
    <p className="hint plugin-folder">
      {words.folderBefore}
      {folder ? <code>{folder}</code> : words.pluginsFolder}
      {words.folderAfter}
    </p>
  );
  if (!open) {
    return (
      <>
        <button type="button" className="link plugin-add-from-git" data-hint={hints.addPlugin} onClick={() => setOpen(true)}>
          {words.addFromGitOpen}
        </button>
        {whereTheyLive}
      </>
    );
  }
  return (
    <>
      <h3>{words.addFromGit}</h3>
      <p className="hint">{words.addFromGitHint}</p>
      <AddPlugin />
      {whereTheyLive}
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
function newsFor(plugin: PluginInfo, pluginUpdates: FoundUpdate[]): FoundUpdate | undefined {
  const found = pluginUpdates.find(({ folder }) => folder === plugin.folder);
  return found && plugin.source.kind === "git" && plugin.source.commit === found.from ? found : undefined;
}

/** Clones every plugin's update, then asks once for all of them; stops at the first clone or build that fails. A tile's Update starts it right away for just that plugin. */
function UpdateAll({ updates, startNow = false, onDone, onBusy }: { updates: FoundUpdate[]; startNow?: boolean; onDone?: () => void; onBusy?: (busy: boolean) => void }) {
  const [cloning, setCloning] = useState<string | null>(null);
  const [offers, setOffers] = useState<PluginOffer[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = cloning !== null || offers !== null;
  useEffect(() => {
    if (!busy) return;
    onBusy?.(true);
    return () => onBusy?.(false);
  }, [busy]);
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
  useStartOnce(startNow, offerAll);
  const shownAtTheTop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (startNow) shownAtTheTop.current?.scrollIntoView({ block: "nearest" });
  }, [startNow]);
  const settled = (outcome: Settled) => {
    setOffers(null);
    setProblem(outcome.problem);
    if (!outcome.problem) onDone?.();
  };
  return (
    <div className="plugin-update-all" ref={shownAtTheTop}>
      {cloning ? (
        <span className="plugin-status">{words.cloningPlugin(cloning)}</span>
      ) : offers ? (
        <PluginConsent
          question={offers.length === 1 ? words.updateQuestion(offers[0]!.title) : words.updateSeveralQuestion(offers.length)}
          offers={offers}
          agree={startNow ? words.update : words.updateAll}
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

type TileUpdate = { run: number; update: FoundUpdate; busy: boolean };

/** The updates started from tiles, each on its own until it ends; one that failed stays, with its problem, until its tile's Update tries again. */
function useTileUpdates() {
  const [running, setRunning] = useState<TileUpdate[]>([]);
  const runs = useRef(0);
  const start = (update: FoundUpdate) => {
    const run = ++runs.current;
    setRunning((all) => [...all.filter((tileUpdate) => tileUpdate.update.folder !== update.folder), { run, update, busy: true }]);
  };
  const end = (run: number) => setRunning((all) => all.filter((tileUpdate) => tileUpdate.run !== run));
  const setBusy = (run: number, busy: boolean) => setRunning((all) => all.map((tileUpdate) => (tileUpdate.run === run ? { ...tileUpdate, busy } : tileUpdate)));
  const isBusyWith = (folder: string) => running.some(({ update, busy }) => busy && update.folder === folder);
  return { running, start, end, setBusy, isBusyWith };
}

const updatingNothing = () => false;

function TileList({
  label,
  plugins,
  newsOf,
  isUpdating = updatingNothing,
  onOpen,
}: {
  label: string;
  plugins: GalleryPlugin[];
  newsOf: (plugin: GalleryPlugin) => FoundUpdate | undefined;
  isUpdating?: (folder: string) => boolean;
  onOpen: (plugin: GalleryPlugin, start: Start) => void;
}) {
  return (
    <ul className="plugin-tiles" aria-label={label}>
      {plugins.map((plugin) => (
        <PluginTile key={plugin.key} plugin={plugin} news={newsOf(plugin)} updating={plugin.installed !== null && isUpdating(plugin.installed.folder)} onOpen={(start) => onOpen(plugin, start)} />
      ))}
    </ul>
  );
}

const PLUGIN_UPDATE_MODES: PluginUpdateMode[] = ["ask", "with-mirador", "any-restart"];

function UpdateModeChoice({ mode }: { mode: PluginUpdateMode }) {
  return (
    <label className="plugin-update-mode" data-hint={hints.pluginUpdateMode}>
      {words.updateMode}
      <select value={mode} onChange={(event) => connection.send({ type: "settings.set-plugin-update-mode", mode: event.target.value as PluginUpdateMode })}>
        {PLUGIN_UPDATE_MODES.map((choice) => (
          <option key={choice} value={choice}>
            {words.updateModes[choice]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Plugins, as a gallery of what each does; a tile opens what it gives the agent, its settings and its upkeep. */
export function PluginsDialog({ pluginUpdates, pluginUpdateMode, onClose }: { pluginUpdates: FoundUpdate[]; pluginUpdateMode: PluginUpdateMode; onClose: () => void }) {
  const listed = usePluginsListed();
  const [opened, setOpened] = useState<{ key: string; start: Start } | null>(null);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && !event.defaultPrevented && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const gallery = listed ? galleryOf(listed) : { installed: [], discover: [] };
  const newsOf = ({ installed }: GalleryPlugin) => (installed ? newsFor(installed, pluginUpdates) : undefined);
  const waiting = pluginUpdates.filter(({ folder }) => listed?.plugins.some((plugin) => plugin.folder === folder && newsFor(plugin, pluginUpdates)));
  const openedPlugin = opened && [...gallery.installed, ...gallery.discover].find(({ key }) => key === opened.key);
  usePicturesFetchedAhead(listed?.official);
  const tileUpdates = useTileUpdates();
  const [updatingAll, setUpdatingAll] = useState(false);
  const isUpdating = (folder: string) => tileUpdates.isBusyWith(folder) || (updatingAll && waiting.some((update) => update.folder === folder));
  const open = (plugin: GalleryPlugin, start: Start) => {
    const found = start === "update" && newsOf(plugin) ? pluginUpdates.find(({ folder }) => folder === plugin.installed?.folder) : undefined;
    if (!found) return setOpened({ key: plugin.key, start });
    if (!isUpdating(found.folder)) tileUpdates.start(found);
  };
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
            <PluginDetail key={openedPlugin.key} plugin={openedPlugin} news={newsOf(openedPlugin)} updateMode={pluginUpdateMode} start={opened.start} onBack={() => setOpened(null)} />
          ) : (
            <>
              <p className="hint">{words.intro}</p>
              <UpdateModeChoice mode={pluginUpdateMode} />
              {tileUpdates.running.map(({ run, update }) => (
                <UpdateAll key={run} updates={[update]} startNow onDone={() => tileUpdates.end(run)} onBusy={(busy) => tileUpdates.setBusy(run, busy)} />
              ))}
              {waiting.length > 0 && (updatingAll || !tileUpdates.running.some(({ busy }) => busy)) && <UpdateAll updates={waiting} onBusy={setUpdatingAll} />}
              <h3>{words.installed}</h3>
              {gallery.installed.length > 0 ? <TileList label={words.installed} plugins={gallery.installed} newsOf={newsOf} isUpdating={isUpdating} onOpen={open} /> : listed && <p className="plugin-none">{words.noPlugins}</p>}
              {gallery.discover.length > 0 && (
                <>
                  <h3>{words.discover}</h3>
                  <p className="hint">{words.moreOfficialHint}</p>
                  <TileList label={words.discover} plugins={gallery.discover} newsOf={newsOf} onOpen={open} />
                </>
              )}
              <AddFromGit folder={listed?.folder ?? null} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
