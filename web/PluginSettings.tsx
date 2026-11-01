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
  type PluginSource,
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

function PluginUpdate({ plugin, found }: { plugin: PluginInfo; found: PluginNews | undefined }) {
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

function PluginRow({ plugin, official, found }: { plugin: PluginInfo; official?: CatalogPlugin; found: PluginNews | undefined }) {
  const settings = usePluginSettings().find(({ plugin: name }) => name === plugin.name);
  const [problem, setProblem] = useState<string | null>(null);
  const title = plugin.title ?? plugin.folder;
  const linked = plugin.source.kind === "linked";
  const remove = async () => setProblem(await changePlugins((requestId) => ({ type: "plugins.remove", requestId, folder: plugin.folder })));
  return (
    <li className={plugin.problem ? "failed" : undefined}>
      <span className="plugin-title">{title}</span>
      {plugin.name && <span className="plugin-name">{plugin.name}</span>}
      {plugin.version && <span className="plugin-version">{plugin.version}</span>}
      {official && (
        <span className="plugin-official" data-hint={hints.officialPlugin}>
          {words.official}
        </span>
      )}
      {plugin.waitsForRestart && <span className="plugin-waits">{words.waitsForRestart}</span>}
      {official && <span className="plugin-description">{official.description}</span>}
      <span className="plugin-source">{sourceLine(plugin.source)}</span>
      {plugin.problem && <span className="plugin-problem">{words.didntLoad(plugin.problem)}</span>}
      {settings && settings.settings.length > 0 && <SettingsOf settings={settings} />}
      <span className="plugin-actions">
        {plugin.source.kind === "git" && <PluginUpdate key={plugin.source.commit} plugin={plugin} found={found} />}
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
    </li>
  );
}

function OfficialPluginToInstall({ plugin }: { plugin: CatalogPlugin }) {
  const [step, setStep] = useState<"idle" | "cloning" | PluginOffer>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const offer = async () => {
    setStep("cloning");
    setProblem(null);
    const offered = await offerPlugin((requestId) => ({ type: "plugins.offer", requestId, url: plugin.repo, branch: plugin.branch ?? null }));
    setStep(offered.offer ?? "idle");
    setProblem(offered.problem);
  };
  const settled = (outcome: Settled) => {
    setStep("idle");
    setProblem(outcome.problem);
  };
  return (
    <li>
      <span className="plugin-title">{plugin.title}</span>
      <span className="plugin-name">{plugin.name}</span>
      <span className="plugin-description">{plugin.description}</span>
      {typeof step === "object" ? (
        <PluginConsent question={words.installQuestion(step.title)} offers={[step]} agree={words.install} decline={words.dontInstall} onSettled={settled} />
      ) : (
        <span className="plugin-actions">
          <button type="button" data-hint={hints.installOfficialPlugin} disabled={step === "cloning"} onClick={offer}>
            {step === "cloning" ? words.cloning : words.install}
          </button>
        </span>
      )}
      {problem && <pre className="plugin-output">{problem}</pre>}
    </li>
  );
}

const toInstall = (official: CatalogPlugin[], installed: PluginInfo[]) =>
  official.filter((plugin) => !installed.some(({ name }) => name === plugin.name));

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

export function PluginSettings({ pluginUpdates }: { pluginUpdates: FoundUpdate[] }) {
  const listed = usePluginsListed();
  const waiting = pluginUpdates.filter(({ folder }) => listed?.plugins.some((plugin) => plugin.folder === folder && newsFor(plugin, pluginUpdates)));
  return (
    <>
      <h3>{words.title}</h3>
      <p className="hint">
        {words.introBeforeFolder}
        {listed ? <code>{listed.folder}</code> : words.pluginsFolder}
        {words.introAfterFolder}
      </p>
      {listed?.restartNeeded && (
        <p className="restart-needed">
          {words.restartNeeded}
          <button type="button" data-hint={hints.restartHost} onClick={() => connection.send({ type: "host.restart" })}>
            {t.shell.app.restartHost}
          </button>
        </p>
      )}
      {waiting.length > 0 && <UpdateAll updates={waiting} />}
      <ul className="plugin-list" aria-label={words.title}>
        {listed?.plugins.map((plugin) => (
          <PluginRow
            key={plugin.folder}
            plugin={plugin}
            official={listed.official?.find(({ name }) => name === plugin.name)}
            found={newsFor(plugin, pluginUpdates)}
          />
        ))}
        {listed?.plugins.length === 0 && <li className="plugin-none">{words.noPlugins}</li>}
      </ul>
      {listed && toInstall(listed.official ?? [], listed.plugins).length > 0 && (
        <>
          <h3>{words.moreOfficial}</h3>
          <p className="hint">{words.moreOfficialHint}</p>
          <ul className="plugin-list" aria-label={words.moreOfficial}>
            {toInstall(listed.official ?? [], listed.plugins).map((plugin) => (
              <OfficialPluginToInstall key={plugin.name} plugin={plugin} />
            ))}
          </ul>
        </>
      )}
      <h3>{words.addFromGit}</h3>
      <p className="hint">
        {words.addFromGitHint}
      </p>
      <AddPlugin />
    </>
  );
}
