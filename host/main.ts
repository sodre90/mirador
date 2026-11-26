// First, so that what any module logs as it loads is stamped too.
import "./stamped-log.ts";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { serveCanvasAssets } from "./canvas/assets.ts";
import { authorityFingerprint, namesToCover, servingCertificate } from "./certificates.ts";
import { CanvasMcpEndpoints } from "./canvas/mcp.ts";
import { AppDocuments } from "./apps/documents.ts";
import { defaultPluginsIn, installDefaultPlugins } from "./apps/default-plugins.ts";
import { commitsOf, InstalledPlugins, pluginLooksOf } from "./apps/installed-plugins.ts";
import { applyReadyUpdatesAtStart, ReadyPluginUpdates } from "./apps/ready-plugin-updates.ts";
import { loadPlugins, pluginFolders, watchViews } from "./apps/plugins.ts";
import { CanvasPlugins } from "./canvas/plugins.ts";
import { PluginSettingsStore } from "./plugin-settings.ts";
import { officialPluginInstaller, PluginCatalog, revokedWhileRunning } from "./plugin-catalog.ts";
import { CanvasService } from "./canvas/service.ts";
import { restoreCanvas } from "./canvas/canvas-calls.ts";
import { DAY_MS, workingCopyIdOf } from "../shared/model.ts";
import { agentLogsDirectory, loadConfig } from "./config.ts";
import { ConversationService } from "./conversations.ts";
import { DeviceService } from "./devices.ts";
import { ownerKey } from "./person-keys.ts";
import { JoinRequestService } from "./join-requests.ts";
import { MachineRelays } from "./machine-relays.ts";
import { forgetMachine, forgetSignInAt, leftEveryRoomAt } from "./machine-sign-in.ts";
import { MachineTunnels } from "./machine-tunnels.ts";
import { MachineWatch } from "./machine-watch.ts";
import { BroughtAgents, broughtAgentsFolder } from "./brought-agents.ts";
import { ownPageOrigins } from "./addresses.ts";
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
import { agentEnvironment } from "./acp/environment.ts";
import { installedHarnesses } from "./acp/harnesses.ts";
import { basicEnvironment } from "../shared/room-agent-setup.ts";
import { giveEveryWorkspaceAProfile, moveProfilelessOntoProfiles, ProfileService } from "./profiles.ts";
import { RoomService } from "./rooms.ts";
import { RoomQuestions } from "./room-questions.ts";
import { RoomReadingService } from "./room-reading.ts";
import { applyConfigFile } from "./settings-file/config-file.ts";
import { SettingsImport } from "./settings-file/import-settings.ts";
import { HostRestart, relaunch, stoppedWithinTimeout, takeRelaunchEnvironment, takeTurnsStoppedForRestart } from "./restart.ts";
import { DesktopAppCheck } from "./desktop-app-check.ts";
import { switchOf, type PluginUpdate } from "../shared/apps.ts";
import { englishProblem } from "../shared/host-problems.ts";
import type { ConfigFileStatus } from "../shared/settings-file.ts";
import { Lookout } from "./lookout.ts";
import { NewerVersionWatcher, newerVersionLookup, pullCheckout } from "./newer-version.ts";
import { desktopAppCode } from "../shared/desktop-app-code.ts";
import { startServer } from "./server.ts";
import { BUILT_IN_BROKER, PeerToPeer, peerToPeerSettings, peerToPeerUnlessBuiltInFails } from "./p2p/service.ts";
import { dialProgram } from "./p2p/dial.ts";
import { downloadedSidecar } from "./p2p/sidecar-download.ts";
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
import { askFormOnCanvas } from "./acp/elicitation.ts";
import { conversationCanvasToken } from "./canvas-token.ts";
import { currentPath } from "./current-path.ts";
import { homedir } from "node:os";
import { AppleContainer } from "./sandbox/apple-container.ts";
import { agentImagesOf } from "./sandbox/agent-version.ts";
import { computersOwnOnLinux, Podman } from "./sandbox/podman.ts";
import { belongsToSandbox, Sandboxes } from "./sandbox/sandboxes.ts";
import type { SandboxControl } from "./sandbox/sandbox-control.ts";
import { WorkspaceSandboxes } from "./workspace-sandbox.ts";
import { otherSandboxesOf, SandboxFolderService } from "./sandbox-folders.ts";

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
store.forgetExpiredDeletedCanvases();
const forgettingDeletedCanvases = setInterval(() => store.forgetExpiredDeletedCanvases(), DAY_MS);
const hub = new Hub();
const images = new ImageStore(join(config.dataDir, "images"));
const droppedFiles = new DroppedFiles(join(config.dataDir, "dropped-files"));
const pushes = new PushNotifications(store, { grantRelay: config.pushGrantRelay });
const notifications = new SystemNotifications(store, hub, pushes);
const notifierMute = new NotifierMute(config.notifierDir, join(config.dataDir, MUTED_LIST_FILE));
notifierMute.unmuteSessionsOfEarlierRuns();
const sourceDir = dirname(import.meta.dir);
const pluginsFolder = join(config.dataDir, "plugins");
const loadedPluginNames = new Set<string>();
const catalog = new PluginCatalog(store, config.pluginCatalogUrl, (name) => loadedPluginNames.has(name) || existsSync(join(pluginsFolder, name)));
const defaultPlugins = config.defaultPluginsFile ? await defaultPluginsIn(config.defaultPluginsFile) : [];
if (defaultPlugins.length > 0) {
  const defaultsInstaller = new InstalledPlugins(pluginsFolder, []);
  defaultsInstaller.refusesRevokedFrom(catalog);
  await installDefaultPlugins(defaultPlugins, defaultsInstaller, store);
}
const pluginsUpdatedAtStart = await applyReadyUpdatesAtStart(pluginsFolder, store, sourceDir, catalog);
const pluginCommitsAtStart = await commitsOf(pluginFolders(pluginsFolder));
const loadedPlugins = await loadPlugins(pluginsFolder, (folder) => catalog.revocationOf(pluginCommitsAtStart.get(folder) ?? null));
for (const { folder, message } of loadedPlugins.problems) console.warn(`The plugin in ${folder} didn't load: ${message}`);
const canvasPlugins = new CanvasPlugins(store, hub, loadedPlugins.canvases);
for (const { manifest } of [...loadedPlugins.canvases, ...loadedPlugins.apps]) loadedPluginNames.add(manifest.name);
const revokedPluginsRunning = () => revokedWhileRunning([...loadedPlugins.canvases, ...loadedPlugins.apps], pluginCommitsAtStart, catalog);
catalog.tellsRevocationsTo(() => hub.broadcast({ type: "plugins.revoked-running", plugins: revokedPluginsRunning() }));
void catalog.refresh();
canvasPlugins.offersFrom(catalog);
const pluginLooks = await pluginLooksOf([...loadedPlugins.canvases, ...loadedPlugins.apps]);
const pluginSettings = new PluginSettingsStore(
  store,
  [...loadedPlugins.canvases, ...loadedPlugins.apps].map(({ manifest }) => manifest),
  canvasPlugins.checkingProfiles(),
);
const conversations = new ConversationService(store, hub, config, notifierMute, images, droppedFiles, notifications, (conversationId) => canvasPlugins.guidanceFor(conversationId));
canvasPlugins.notifiesWith((workspace, said) => notifications.fromPlugin(workspace, said));
canvasPlugins.sendsPromptsWith((conversationId, text, { afterTurn, fromPlugin }) => conversations.send(conversationId, text, [], { afterTurn, fromPlugin }));
canvasPlugins.startsConversationsWith((callerId, plugin, profileName, prompt, title, choices, worktree) =>
  !worktree
    ? conversations.startBeside(callerId, plugin, profileName, prompt, title, choices)
    : conversations.startInOwnWorktree(callerId, plugin, profileName, prompt, title, choices, worktree === "own" ? undefined : worktree.from),
);
canvasPlugins.stopsConversationsWith((callerId, plugin, conversationId) => conversations.stopStarted(callerId, plugin, conversationId));
canvasPlugins.deletesConversationsWith((callerId, plugin, conversationId) => conversations.deleteStarted(callerId, plugin, conversationId));
canvasPlugins.promptsStartedWith((callerId, plugin, pluginTitle, conversationId, text) => conversations.promptStarted(callerId, plugin, pluginTitle, conversationId, text));
canvasPlugins.readsUsageWith((callerId, plugin, conversationId) => conversations.usageOf(callerId, plugin, conversationId));
canvasPlugins.startsWorkspaceConversationsWith((workspaceId, pluginTitle, start) => conversations.startForPlugin(workspaceId, pluginTitle, start));
canvasPlugins.asksProfileChoicesWith((profileId) => conversations.profileChoicesForPlugin(profileId));
conversations.hearRepliesWith(
  (started, startedBy, reply) => canvasPlugins.replied(started, startedBy, reply),
  (plugin) => canvasPlugins.tellsItsCaller(plugin),
);
conversations.hearActivityWith((conversationId, activity) => {
  canvasPlugins.activity(conversationId, activity);
  if (activity.kind === "turn-ended") canvas.turnEnded(conversationId);
  const conversation = activity.kind === "turn-ended" ? store.findConversation(conversationId) : undefined;
  if (conversation) apps.filesMayHaveChanged(workingCopyIdOf(conversation));
});
const canvasAssetsOrigins = [
  ...new Set([
    config.canvasAssetsOrigin,
    `http://127.0.0.1:${config.canvasAssetsPort}`,
    ...(network && certificate ? certificate.names.map((name) => `https://${name}:${network.canvasPort}`) : []),
  ]),
];
const canvas = new CanvasService(store, hub, conversations, notifications, canvasAssetsOrigins);
conversations.askFormsWith((conversationId, request, signal) => askFormOnCanvas(canvas, conversationId, request, signal));
conversations.withdrawsQuestionsWith((conversationId) => canvas.withdrawWaitingAsks(conversationId));
conversations.restoresCanvasWith((conversationId, source, events) => restoreCanvas(conversationId, source, events, store, canvas, canvasPlugins));
// The checklist plugin's note about the user's ticks came before the page errors when the checklist was Mirador's own.
conversations.hearCanvasNotesFrom((conversationId) => [...canvasPlugins.notesForAgent(conversationId), ...canvas.notesForAgent(conversationId)]);
const plugins = new InstalledPlugins(pluginsFolder, loadedPlugins.problems, loadedPlugins.canvases);
const readyPluginUpdates = new ReadyPluginUpdates(
  pluginsFolder,
  plugins,
  store,
  () => [...catalog.all, ...defaultPlugins.map(({ name, repo, tag, commit }) => ({ name, repo, release: tag.replace(/^v/, ""), commit }))],
  () => hub.announcePluginUpdates(readyPluginUpdates.marked(pluginUpdates.current ?? [])),
);
plugins.decidesUpdatesByItselfWith(readyPluginUpdates.updatesByItself);
plugins.followsPinsWith(readyPluginUpdates.pins);
plugins.refusesRevokedFrom(catalog);
await readyPluginUpdates.started(pluginsUpdatedAtStart, loadedPlugins.problems);
canvas.installsPluginsWith(officialPluginInstaller(catalog, plugins, (listed) => hub.broadcast(listed)));
const apps = new AppDocuments(store, loadedPlugins.apps, {
  openAppsChanged: (openApps) => hub.broadcast({ type: "apps.open", openApps }),
  stateChanged: (state) => hub.publishAppState(state),
});
conversations.hearWorktreeRemovalsWith((folderId) => apps.forgetFolder(folderId));
await apps.reopenAll();
const stopWatchingViews = watchViews(loadedPlugins, () =>
  hub.broadcast({ type: "plugins.views", installedApps: apps.installed(), canvasViews: canvasPlugins.viewPaths() }),
);
const rooms = new RoomService(store, hub, conversations, notifications, config.dataDir, () => basicEnvironment(agentEnvironment()));
conversations.followsRoomRulesOf(rooms);
const roomQuestions = new RoomQuestions(store, hub, canvas);
const roomReading = new RoomReadingService(store, hub, notifications);
rooms.hearPostsWith((message, newlyTagged, by) => roomReading.posted(message, newlyTagged, by));
rooms.hearWaitingWith((roomId, approvals, tasks, workspace) => roomReading.waitingChanged(roomId, approvals, tasks, workspace));
roomReading.countsWaitingWith((roomId) => rooms.countWaiting(roomId));
canvas.hearRoomQuestionsWith((roomId, item, startsWaiting) => {
  const room = store.findRoom(roomId);
  if (!room) return;
  roomQuestions.changed(room, item);
  roomReading.questionChanged(room, item, startsWaiting);
});
const mcp = new CanvasMcpEndpoints({
  canvas,
  conversations,
  assetsOrigin: config.canvasAssetsOrigin,
  apps,
  canvasPlugins,
  catalog,
  store,
  rooms,
  roomsWorkspaces: { callInWorkspace: (conversationId, call, signal) => broughtAgents.callInWorkspace(conversationId, call, signal) },
  antigravityAskWaitMs: config.antigravityAskWaitMs,
});
const podman = process.platform === "linux" ? Podman.here(config.sandboxContainer, currentPath() ?? "", config.selinuxEnforceFile) : null;
const sandboxes = new Sandboxes(podman ?? AppleContainer.here(config.sandboxContainer, currentPath() ?? ""), {
  dataDir: config.dataDir,
  places: { home: homedir(), dataDir: config.dataDir, checkout: sourceDir, computersOwn: podman ? computersOwnOnLinux(homedir(), podman) : [] },
  workspaceOf: (owner) => store.findWorkspace(owner.kind === "room" ? (store.findRoom(owner.id)?.workspaceId ?? "") : owner.id)?.path ?? null,
  canvasOf: (owner) => ({
    belongs: (conversationId) => {
      const conversation = store.findConversation(conversationId);
      return conversation !== undefined && belongsToSandbox(conversation, owner);
    },
    tokenOf: (conversationId) => conversationCanvasToken(config.mcpToken, conversationId),
    handle: (conversationId, request) => mcp.handleFromSandbox(conversationId, request),
  }),
  atWork: (owner) => {
    const working =
      owner.kind === "room"
        ? (store.findRoom(owner.id)?.agents ?? []).filter(({ answering, brought }) => answering !== null && !brought).map(({ profileId, conversationId }) => ({ profileId, id: conversationId }))
        : store.listConversations().filter((conversation) => belongsToSandbox(conversation, owner) && conversations.isAtWork(conversation.id));
    return {
      agents: [...new Set(working.flatMap(({ profileId }) => profileId ?? []))],
      conversationIds: working.flatMap(({ id }) => id ?? []),
    };
  },
  setupChanged: (setup) => hub.broadcast({ type: "sandbox.setup", setup }),
  heldChanged: (owner, changes, full) => hub.broadcast({ type: "sandbox.held-changes", owner, changes, full }),
  foldersOf: (owner) => store.sandboxFoldersOf(owner),
  networkOf: (owner) => (owner.kind === "room" ? store.findRoom(owner.id) : store.findWorkspace(owner.id))?.sandbox.network ?? "closed",
  otherSandboxes: (owner) => otherSandboxesOf(store, owner),
  foldersStarted: (owner) => sandboxFolders.vmStarted(owner),
});
const sandboxFolders = new SandboxFolderService(store, hub, conversations, sandboxes);
conversations.startsSandboxedAgentsIn(sandboxes);
const sandboxControl: SandboxControl = {
  availability: () => sandboxes.availability(),
  prepare: (profiles) => void agentImagesOf(profiles, store.claudeProgramSetting()).then((images) => images.forEach((image) => sandboxes.prepareInBackground(image))),
  answerHeldChange: (owner, changeId, answer) => sandboxes.answerHeldChange(owner, changeId, answer),
  workspaceRefusal: (workspace, turningOn) => sandboxes.workspaceRefusal(workspace, turningOn),
  launchForBrought: ({ profiles, ...call }) => sandboxes.launchForBrought({ ...call, images: () => agentImagesOf(profiles, store.claudeProgramSetting()) }),
  stopBrought: (owner, agentId) => sandboxes.stopBrought(owner, agentId),
  turnEnded: (owner) => sandboxes.turnEnded(owner),
  networkChanged: (owner) => sandboxes.networkChanged(owner),
  ownerGone: (owner) => {
    sandboxFolders.ownerGone(owner);
    return sandboxes.ownerGone(owner);
  },
};
rooms.keepsSandboxesWith(sandboxControl);
const terminals = new TerminalService(hub, store);
const workspaceSandboxes = new WorkspaceSandboxes(store, hub, conversations, terminals);
workspaceSandboxes.keepsSandboxesWith(sandboxControl);
void sandboxes.reapLeftovers().catch((error: unknown) => console.error("removing the sandboxes a previous run left failed:", error));
const appViewCode = (pathname: string) => apps.viewCode(pathname) ?? canvasPlugins.viewCode(pathname);
const appMediaFile = (pathname: string) => apps.mediaFile(pathname);
const assetsServer = serveCanvasAssets(config.canvasAssetsPort, { knownOrigins: canvasAssetsOrigins, appViewCode, appMediaFile });
const networkAssetsServer = network && certificate && serveCanvasAssets(network.canvasPort, { certificate, knownOrigins: canvasAssetsOrigins, appViewCode, appMediaFile });
const profiles = new ProfileService(store, hub, conversations, pluginSettings.secretSettings(), (plugin) => {
  const pluginSwitch = switchOf(pluginSettings.all().find((each) => each.plugin === plugin)?.profileSettings);
  const givesConversations = canvasPlugins.conversationPlugins().some((each) => each.plugin === plugin);
  return pluginSwitch || givesConversations ? { pluginSwitch } : undefined;
});
profiles.whenProfilesChange(() => canvasPlugins.profilesChanged());
profiles.whenSavedOver((previous, saved) => {
  if (canvasPlugins.pluginsOffFor(previous).join("\n") !== canvasPlugins.pluginsOffFor(saved).join("\n")) mcp.toolsChangedForProfile(saved.id);
});
const statusline = new StatuslineService(store, conversations, canvasPlugins, config.runsUserStatusLine);
const restart = new HostRestart(hub, conversations, config.dataDir, stopServices, relaunchHow && (() => relaunch(relaunchHow)));
const desktopApp = new DesktopAppCheck(
  () => desktopAppCode(join(sourceDir, "desktop")),
  (outdated) => hub.broadcast({ type: "desktop-app.outdated", outdated }),
);
const newerVersion = new NewerVersionWatcher(newerVersionLookup(sourceDir, config.latestReleaseUrl), (found) => hub.announceNewerVersion(found));
// Prepared after every look, not only when what was found changed, so a clone that failed is tried again. Each fetching look
// reads the catalog first, so an official plugin updates to the release it pins now.
const pluginUpdates = new Lookout(
  async (fetching, last: PluginUpdate[] | null) => {
    if (fetching) await catalog.refresh();
    const found = await plugins.updatesFound(last);
    void readyPluginUpdates.prepare(found);
    return found;
  },
  (found) => hub.announcePluginUpdates(readyPluginUpdates.marked(found ?? [])),
);
const devices = new DeviceService(store);
const ownersKey = ownerKey(config.dataDir);
const joinRequests = new JoinRequestService(store, devices, ownAuthorityFingerprint);
const signInCodes = new SignInCodes(store);
const p2pSettings = peerToPeerSettings(process.env, { sidecar: downloadedSidecar(config.dataDir), broker: BUILT_IN_BROKER });
const p2p = p2pSettings && peerToPeerUnlessBuiltInFails(process.env, () => new PeerToPeer({ ...p2pSettings, canvasAssetsPort: config.canvasAssetsPort }, join(config.dataDir, "p2p"), store));
const search = new ConversationSearch(store);
const signedIn = signedInWith(config.browserToken, devices, store.ownerId());
const tunnels = new MachineTunnels(store, join(config.dataDir, "machine-tunnels"), dialProgram(process.env, downloadedSidecar(config.dataDir)), config.relayPorts);
const watch = new MachineWatch(
  store,
  { id: store.hostId(), origins: ownPageOrigins(config, certificate) },
  (status) => hub.broadcast({ type: "machine.status", status }),
  () => hub.broadcast({ type: "machines.changed", machines: store.listMachines() }),
  (notification) => hub.notifyThisComputer(notification),
  (notification) => notifications.passOnFromJoinedRoom(notification),
  machineSignedOut,
  tunnels,
);
const broughtAgents = new BroughtAgents(store, hub, watch, conversations, notifications, broughtAgentsFolder(config.dataDir));
watch.hearRoomMachinesWith({
  opened: (machineId) => broughtAgents.connected(machineId),
  closed: (machineId) => broughtAgents.disconnected(machineId),
  heard: (machineId, message) => broughtAgents.heard(machineId, message),
});
conversations.followsBroughtTasksOf(broughtAgents);
conversations.hearTurnsWith({
  turnStarted: (conversationId, turnSeq) => {
    rooms.turnStarted(conversationId, turnSeq);
    broughtAgents.turnStarted(conversationId, turnSeq);
  },
  turnEnded: (conversationId, turnSeq) => {
    rooms.turnEnded(conversationId, turnSeq);
    broughtAgents.turnEnded(conversationId, turnSeq);
  },
});
const relays = new MachineRelays(
  store,
  config.relayPorts,
  `http://127.0.0.1:${config.canvasAssetsPort}`,
  [config.appOrigin, `http://localhost:${config.port}`],
  (request, fromThisComputer) => signedIn(request, fromThisComputer)?.isOwner === true,
  (machineId) => {
    hub.broadcast({ type: "machines.changed", machines: store.listMachines() });
    watch.start(machineId);
  },
  machineSignedOut,
  ownersKey,
  tunnels,
);
tunnels.startAll();
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
const settingsImport = new SettingsImport({ dataDir: config.dataDir, store, hub, profiles, conversations, workspaceSandboxes, plugins, pluginSettings });
const configFile = config.userConfigFile === null ? null : await applyConfigFile(config.userConfigFile, settingsImport, store);
if (configFile) reportConfigFile(configFile);
const server = startServer({ config, store, hub, conversations, sandboxes, canvas, mcp, apps, plugins, canvasPlugins, pluginSettings, pluginLooks, catalog, profiles, statusline, terminals, images, droppedFiles, voice, voiceEngine, restart, desktopApp, newerVersion, pullNewerVersion: () => pullCheckout(sourceDir), pluginUpdates, readyPluginUpdates, revokedPluginsRunning, devices, ownerKey: ownersKey, joinRequests, signInCodes, search, relays, watch, tunnels, certificate, keepAwake, p2p, pushes, notifications, rooms, workspaceSandboxes, sandboxFolders, roomQuestions, roomReading, broughtAgents, settingsImport, configFile });
const sourceWatcher = new SourceWatcher(sourceDir, {
  uiEdited: (edited) => {
    console.log(`${edited} changed, so the page is built again`);
    server.rebuildUi();
    newerVersion.recount();
  },
  hostEdited: () => {
    restart.hostCodeEdited();
    newerVersion.recount();
  },
});
if (config.watchesSource) sourceWatcher.start();
if (config.checksForNewerVersion) newerVersion.start();
if (config.checksForPluginUpdates) pluginUpdates.start();
conversations.resumeAfterRestart(takeTurnsStoppedForRestart(config.dataDir));
void conversations.deleteUnusedPictures().catch((error: unknown) => console.error("deleting unused pictures failed:", error));
conversations.startReminders();
canvasPlugins.startBackgroundWork();
const terminalSessions = new TerminalSessionWatcher(
  () => conversations.claudeConfigDirs(),
  (activityBySession) => conversations.showTerminalActivity(activityBySession),
);
terminalSessions.start();

if (process.stdout.isTTY) console.log(`Mirador is running. Open:\n\n  ${signInLink(config.appOrigin, signInCodes.mint())}\n`);
else console.log(`Mirador is running at ${config.appOrigin}. To sign a browser in, open the link mirador sign-in prints.`);
console.log(`data: ${config.dataDir}  agent logs: ${agentLogsDirectory(config.dataDir)}`);
if (network) console.log(`other devices: ${config.publicOrigin} (HTTPS on port ${network.port} of every network this machine is on)`);

function reportConfigFile({ path, found, added, overwritten, problems }: ConfigFileStatus) {
  if (!found) return;
  if (added.length + overwritten.length > 0) console.log(`The config file ${path} added ${added.length} and changed ${overwritten.length} of Mirador's settings.`);
  problems.forEach((problem) => console.warn(`The config file ${path}: ${englishProblem(problem)}`));
}

function machineSignedOut(machineId: string) {
  broughtAgents.forgotMachine(machineId);
  if (leftEveryRoomAt(store, machineId)) forgetMachine({ store, relays, watch, tunnels }, machineId);
  else {
    forgetSignInAt(store, tunnels, machineId);
    watch.stop(machineId);
  }
  hub.broadcast({ type: "machines.changed", machines: store.listMachines() });
}

async function stopServices() {
  stopWatchingViews();
  rooms.shutdown();
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
  tunnels.stopAll();
  keepAwake.stop();
  clearInterval(forgettingDeletedCanvases);
  apps.stop();
  const sandboxesStopped = childrenExited.then(() => sandboxes.stopAll());
  // An agent's exit is handled before its stop resolves, and that handling still reads and writes the store.
  await Promise.all([childrenExited, voiceEngineStopped, sandboxesStopped]);
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
  tunnels.stopAll();
  rooms.shutdown();
  conversations.shutdown();
  voiceEngine.killServersNow();
});
