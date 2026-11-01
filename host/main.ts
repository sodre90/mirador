// First, so that what any module logs as it loads is stamped too.
import "./stamped-log.ts";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { serveCanvasAssets } from "./canvas/assets.ts";
import { authorityFingerprint, namesToCover, servingCertificate } from "./certificates.ts";
import { CanvasMcpEndpoints } from "./canvas/mcp.ts";
import { AppDocuments } from "./apps/documents.ts";
import { defaultPluginsIn, installDefaultPlugins } from "./apps/default-plugins.ts";
import { InstalledPlugins } from "./apps/installed-plugins.ts";
import { loadPlugins, watchViews } from "./apps/plugins.ts";
import { CanvasPlugins } from "./canvas/plugins.ts";
import { PluginSettingsStore } from "./plugin-settings.ts";
import { officialPluginInstaller, PluginCatalog } from "./plugin-catalog.ts";
import { CanvasService } from "./canvas/service.ts";
import { agentLogsDirectory, loadConfig } from "./config.ts";
import { ConversationService } from "./conversations.ts";
import { DeviceService } from "./devices.ts";
import { JoinRequestService } from "./join-requests.ts";
import { MachineRelays } from "./machine-relays.ts";
import { MachineWatch } from "./machine-watch.ts";
import { ConversationSearch } from "./search.ts";
import { signedInWith } from "./sign-in.ts";
import { SignInCodes, signInLink } from "./sign-in-codes.ts";
import { Hub } from "./hub.ts";
import { DroppedFiles } from "./dropped-files.ts";
import { ImageStore } from "./images.ts";
import { Voice } from "./voice/voice.ts";
import { engineSources } from "./voice/engine/catalog.ts";
import { VoiceEngineInstaller } from "./voice/engine/installer.ts";
import { VoiceEngineServers } from "./voice/engine/servers.ts";
import { VoiceEngine } from "./voice/engine/engine.ts";
import { MUTED_LIST_FILE, NotifierMute } from "./notifier.ts";
import { installedHarnesses } from "./acp/harnesses.ts";
import { giveEveryWorkspaceAProfile, moveProfilelessOntoProfiles, ProfileService } from "./profiles.ts";
import { HostRestart, relaunch, stoppedWithinTimeout, takeRelaunchEnvironment, takeTurnsStoppedForRestart } from "./restart.ts";
import { DesktopAppCheck } from "./desktop-app-check.ts";
import type { PluginUpdate } from "../shared/apps.ts";
import { Lookout } from "./lookout.ts";
import { NewerVersionWatcher, newerVersionLookup } from "./newer-version.ts";
import { desktopAppCode } from "../shared/desktop-app-code.ts";
import { startServer } from "./server.ts";
import { PeerToPeer, peerToPeerSettings } from "./p2p/service.ts";
import { SourceWatcher } from "./source-watcher.ts";
import { StatuslineService } from "./statusline.ts";
import { SystemNotifications } from "./system-notifications.ts";
import { PushNotifications } from "./push-notifications.ts";
import { Store } from "./store.ts";
import { TerminalSessionWatcher } from "./terminal-sessions.ts";
import { TerminalService } from "./terminals.ts";
import { KeepAwakeHold } from "./keep-awake.ts";
import { keepDataFolderToHostAccount } from "./windows-folder-access.ts";
import { stopIgnoringCtrlC } from "./windows-processes.ts";

if (process.platform === "win32") stopIgnoringCtrlC();
const config = loadConfig();
if (process.platform === "win32") keepDataFolderToHostAccount(config.dataDir);
const relaunchHow = takeRelaunchEnvironment(process.env, process.platform, typeof process.execve === "function");
const { network } = config.reachability;
const certificate = network && servingCertificate(config.dataDir, namesToCover(config.publicOrigin && new URL(config.publicOrigin).hostname), network.ownCertificate);
const store = new Store(config.databasePath);
moveProfilelessOntoProfiles(store, installedHarnesses(store.claudeProgramSetting()));
giveEveryWorkspaceAProfile(store);
store.rememberPublicAddress(config.publicOrigin ? { origin: config.publicOrigin, canvasOrigin: config.canvasAssetsOrigin } : null);
const ownAuthorityFingerprint = certificate?.authority ? authorityFingerprint(certificate.authority) : null;
store.rememberAuthorityFingerprint(ownAuthorityFingerprint);
const hub = new Hub();
const images = new ImageStore(join(config.dataDir, "images"));
const droppedFiles = new DroppedFiles(join(config.dataDir, "dropped-files"));
const pushes = new PushNotifications(store);
const notifications = new SystemNotifications(store, hub, pushes);
const notifierMute = new NotifierMute(config.notifierDir, join(config.dataDir, MUTED_LIST_FILE));
notifierMute.unmuteSessionsOfEarlierRuns();
const sourceDir = dirname(import.meta.dir);
const pluginsFolder = join(config.dataDir, "plugins");
if (config.defaultPluginsFile) await installDefaultPlugins(await defaultPluginsIn(config.defaultPluginsFile), new InstalledPlugins(pluginsFolder, []), store);
const loadedPlugins = await loadPlugins(pluginsFolder);
for (const { folder, message } of loadedPlugins.problems) console.warn(`The plugin in ${folder} didn't load: ${message}`);
const canvasPlugins = new CanvasPlugins(store, hub, loadedPlugins.canvases);
const loadedPluginNames = new Set([...loadedPlugins.canvases, ...loadedPlugins.apps].map(({ manifest }) => manifest.name));
const catalog = new PluginCatalog(store, config.pluginCatalogUrl, (name) => loadedPluginNames.has(name) || existsSync(join(pluginsFolder, name)));
void catalog.refresh();
canvasPlugins.offersFrom(catalog);
const pluginSettings = new PluginSettingsStore(store, [...loadedPlugins.canvases, ...loadedPlugins.apps].map(({ manifest }) => manifest));
const conversations = new ConversationService(store, hub, config, notifierMute, images, droppedFiles, notifications, (conversationId) => canvasPlugins.guidanceFor(conversationId));
canvasPlugins.sendsPromptsWith((conversationId, text, { afterTurn, fromPlugin }) => conversations.send(conversationId, text, [], { afterTurn, fromPlugin }));
canvasPlugins.startsConversationsWith((callerId, plugin, profileName, prompt) => conversations.startBeside(callerId, plugin, profileName, prompt));
conversations.hearRepliesWith((started, startedBy, reply) => canvasPlugins.replied(started, startedBy, reply));
const canvasAssetsOrigins = [
  ...new Set([
    config.canvasAssetsOrigin,
    `http://127.0.0.1:${config.canvasAssetsPort}`,
    ...(network && certificate ? certificate.names.map((name) => `https://${name}:${network.canvasPort}`) : []),
  ]),
];
const canvas = new CanvasService(store, hub, conversations, notifications, canvasAssetsOrigins);
// The checklist plugin's note about the user's ticks came before the page errors when the checklist was Mirador's own.
conversations.hearCanvasNotesFrom((conversationId) => [...canvasPlugins.notesForAgent(conversationId), ...canvas.notesForAgent(conversationId)]);
const plugins = new InstalledPlugins(pluginsFolder, loadedPlugins.problems, loadedPlugins.canvases);
canvas.installsPluginsWith(officialPluginInstaller(catalog, plugins, (listed) => hub.broadcast(listed)));
const apps = new AppDocuments(store, loadedPlugins.apps, {
  openAppsChanged: (openApps) => hub.broadcast({ type: "apps.open", openApps }),
  stateChanged: (state) => hub.publishAppState(state),
});
await apps.reopenAll();
const stopWatchingViews = watchViews(loadedPlugins, () =>
  hub.broadcast({ type: "plugins.views", installedApps: apps.installed(), canvasViews: canvasPlugins.viewPaths() }),
);
const mcp = new CanvasMcpEndpoints(canvas, conversations, config.canvasAssetsOrigin, apps, canvasPlugins, catalog, store);
const appViewCode = (pathname: string) => apps.viewCode(pathname) ?? canvasPlugins.viewCode(pathname);
const appMediaFile = (pathname: string) => apps.mediaFile(pathname);
const assetsServer = serveCanvasAssets(config.canvasAssetsPort, { knownOrigins: canvasAssetsOrigins, appViewCode, appMediaFile });
const networkAssetsServer = network && certificate && serveCanvasAssets(network.canvasPort, { certificate, knownOrigins: canvasAssetsOrigins, appViewCode, appMediaFile });
const profiles = new ProfileService(store, hub, conversations);
const statusline = new StatuslineService(store, conversations, config.runsUserStatusLine);
const terminals = new TerminalService(hub, store);
const restart = new HostRestart(hub, conversations, config.dataDir, stopServices, relaunchHow && (() => relaunch(relaunchHow)));
const desktopApp = new DesktopAppCheck(
  () => desktopAppCode(join(sourceDir, "desktop")),
  (outdated) => hub.broadcast({ type: "desktop-app.outdated", outdated }),
);
const newerVersion = new NewerVersionWatcher(newerVersionLookup(sourceDir, config.latestReleaseUrl), (found) => hub.announceNewerVersion(found));
const pluginUpdates = new Lookout((_, last: PluginUpdate[] | null) => plugins.updatesFound(last), (found) => hub.announcePluginUpdates(found ?? []));
const devices = new DeviceService(store);
const joinRequests = new JoinRequestService(store, devices, ownAuthorityFingerprint);
const signInCodes = new SignInCodes(store);
const p2pSettings = peerToPeerSettings(process.env);
const p2p = p2pSettings && new PeerToPeer({ ...p2pSettings, canvasAssetsPort: config.canvasAssetsPort }, join(config.dataDir, "p2p"), store);
const search = new ConversationSearch(store);
const signedIn = signedInWith(config.browserToken, devices);
const watch = new MachineWatch(
  store,
  (status) => hub.broadcast({ type: "machine.status", status }),
  (notification) => hub.notifyThisComputer(notification),
  machineSignedOut,
);
const relays = new MachineRelays(
  store,
  config.relayPorts,
  `http://127.0.0.1:${config.canvasAssetsPort}`,
  (request) => signedIn(request) !== null,
  (machineId) => {
    hub.broadcast({ type: "machines.changed", machines: store.listMachines() });
    watch.start(machineId);
  },
  machineSignedOut,
);
relays.startAll();
watch.startAll();
const voiceDir = join(config.dataDir, "voice");
const voiceEngineChanged = () => hub.broadcast({ type: "voice.engine", engine: voiceEngine.status() });
const voiceEngineInstaller = new VoiceEngineInstaller({
  voiceDir,
  logsDir: agentLogsDirectory(config.dataDir),
  sources: engineSources(config.voiceModelsUrl),
  fakePython: config.voiceEnginePython,
  memoryBytes: config.voiceEngineMemoryBytes ?? undefined,
  onChange: voiceEngineChanged,
});
const voiceEngine = new VoiceEngine(
  voiceEngineInstaller,
  new VoiceEngineServers({
    installer: voiceEngineInstaller,
    voiceDir,
    logsDir: agentLogsDirectory(config.dataDir),
    idleMs: () => store.voiceSettings().engineIdleMinutes * 60_000,
    onChange: voiceEngineChanged,
  }),
);
voiceEngineInstaller.load().catch((error) => console.error(`reading how voice is set up on this Mac failed:`, error));
const voice = new Voice(() => store.voiceSettings(), (profileId) => store.findProfile(profileId), voiceEngine.use);
const keepAwake = new KeepAwakeHold(store.keepAwake());
hub.whenRunningTurnsCounted((count) => keepAwake.setRunningTurns(count));
const server = startServer({ config, store, hub, conversations, canvas, mcp, apps, plugins, canvasPlugins, pluginSettings, catalog, profiles, statusline, terminals, images, droppedFiles, voice, voiceEngine, restart, desktopApp, newerVersion, pluginUpdates, devices, joinRequests, signInCodes, search, relays, watch, certificate, keepAwake, p2p, pushes });
const sourceWatcher = new SourceWatcher(sourceDir, {
  uiEdited: () => {
    server.rebuildUi();
    newerVersion.recount();
  },
  hostEdited: () => {
    restart.hostCodeEdited();
    newerVersion.recount();
  },
});
sourceWatcher.start();
if (config.checksForNewerVersion) newerVersion.start();
if (config.checksForPluginUpdates) pluginUpdates.start();
conversations.resumeAfterRestart(takeTurnsStoppedForRestart(config.dataDir));
const terminalSessions = new TerminalSessionWatcher(
  () => conversations.claudeConfigDirs(),
  (activityBySession) => conversations.showTerminalActivity(activityBySession),
);
terminalSessions.start();

if (process.stdout.isTTY) console.log(`Mirador is running. Open:\n\n  ${signInLink(config.appOrigin, signInCodes.mint())}\n`);
else console.log(`Mirador is running at ${config.appOrigin}. To sign a browser in, open the link mirador sign-in prints.`);
console.log(`data: ${config.dataDir}  agent logs: ${agentLogsDirectory(config.dataDir)}`);
if (network) console.log(`other devices: ${config.publicOrigin} (HTTPS on port ${network.port} of every network this machine is on)`);

function machineSignedOut(machineId: string) {
  store.forgetMachineDeviceToken(machineId);
  watch.stop(machineId);
  hub.broadcast({ type: "machines.changed", machines: store.listMachines() });
}

async function stopServices() {
  stopWatchingViews();
  const voiceEngineStopped = voiceEngine.stop();
  terminalSessions.stop();
  sourceWatcher.stop();
  newerVersion.stop();
  pluginUpdates.stop();
  const childrenExited = Promise.all([terminals.shutdown(), conversations.shutdown()]);
  server.stop();
  assetsServer.stop(true);
  networkAssetsServer?.stop(true);
  relays.stopAll();
  watch.stopAll();
  keepAwake.stop();
  apps.stop();
  // An agent's exit is handled before its stop resolves, and that handling still reads and writes the store.
  await Promise.all([childrenExited, voiceEngineStopped]);
  store.close();
}

let stopping = false;
async function shutdown() {
  if (stopping) process.exit(0);
  stopping = true;
  await stoppedWithinTimeout(stopServices).catch((error) => console.error(`stopping the services failed:`, error));
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    console.log(`received ${signal}, stopping`);
    shutdown();
  });
}
process.on("exit", () => {
  conversations.shutdown();
  voiceEngine.killServersNow();
});
