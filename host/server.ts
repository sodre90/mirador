import { homedir } from "node:os";
import { basename } from "node:path";
import index from "../web/index.html";
import {
  isCanvasUse,
  isPastel,
  type CanvasUse,
  type ClientAddress,
  type FoundAddress,
  type ListedDevice,
  type PromptTemplate,
  type PublicAddress,
  type ReachabilitySettings,
  type StoredEvent,
  type Workspace,
  type Pastel,
} from "../shared/model.ts";
import { readJobWaitRequest } from "../shared/job-waits.ts";
import { avatarProblem } from "../shared/avatar.ts";
import { promptTemplateProblem } from "../shared/prompt-templates.ts";
import { joinRequestNotification } from "../shared/system-notifications.ts";
import { CANVAS_ASSETS_ORIGIN_HEADER, DESKTOP_APP_CODE_PARAMETER, PROFILE_LAUNCH_PARAMETER, TOKEN_COOKIE, type ClientMessage, type ServerMessage } from "../shared/protocol.ts";
import { claudeProgramLookUps, claudeProgramReport } from "./acp/claude-program.ts";
import { installedHarnesses } from "./acp/harnesses.ts";
import type { CanvasMcpEndpoints } from "./canvas/mcp.ts";
import type { CanvasService } from "./canvas/service.ts";
import { AppFileRefused, type AppDocuments } from "./apps/documents.ts";
import { withoutCredentials, type InstalledPlugins } from "./apps/installed-plugins.ts";
import type { CanvasPlugins } from "./canvas/plugins.ts";
import { AppStorage } from "./apps/storage.ts";
import { messageOf } from "./apps/plugins.ts";
import { appKey, type PluginUpdate } from "../shared/apps.ts";
import type { PluginSettingsStore } from "./plugin-settings.ts";
import { pluginsListed as listedPlugins, type PluginCatalog } from "./plugin-catalog.ts";
import { FileAlreadyThere } from "./canvas/save-to-project.ts";
import { OutsideWorkspace } from "./changes.ts";
import { extensionFor, isImageId } from "../shared/images.ts";
import { canvasChangedSince, DEFLATED_MESSAGES_HEADER, type LowDataSubscription } from "../shared/low-data.ts";
import { sidebarIdsAfterMove } from "../shared/sidebar-order.ts";
import { withChunksCoalesced } from "../shared/timeline.ts";
import { authorityFingerprint as fingerprintOf, type ServingCertificate } from "./certificates.ts";
import { publicAddressOf, reachability, savedNetwork, saveNetwork, savedPublicAddress, savePublicAddress, type HostConfig } from "./config.ts";
import { HERE_PATH, addressesThatAnswer, addressesUsed, rememberAddressUsed, type AddressCandidate } from "./addresses.ts";
import { servePortOnTailnet, tailnetName, tailscaleCommand } from "./tailscale.ts";
import { errorMessage, type ConversationService } from "./conversations.ts";
import { deviceName, type DeviceService } from "./devices.ts";
import { JobWaitRefused } from "./job-waits.ts";
import { JoinRequestRefused, SenderLimit, type JoinRequestService } from "./join-requests.ts";
import type { ConversationSearch } from "./search.ts";
import { machineAddress } from "../shared/machines.ts";
import { MIRADOR_VERSION } from "../shared/version.ts";
import { socketData, webSocketCompression, type BrowserSocket, type Hub, type SocketData } from "./hub.ts";
import { newestOnly } from "./newest-only.ts";
import type { MachineRelays } from "./machine-relays.ts";
import type { MachineWatch } from "./machine-watch.ts";
import { cookieValue, sameSecret, signedInWith } from "./sign-in.ts";
import { MAX_DROPPED_FILE_BYTES, type DroppedFiles } from "./dropped-files.ts";
import { MAX_IMAGE_BYTES, type ImageStore } from "./images.ts";
import { imagesOf, lowDataEvent, pageEvent, wholeToolOutput } from "./low-data.ts";
import { completeDirectories, createsDirectory, directoryToAdd } from "./paths.ts";
import { launchForNewWorkspace, profileFor, type ProfileService } from "./profiles.ts";
import type { DesktopAppCheck } from "./desktop-app-check.ts";
import type { Lookout } from "./lookout.ts";
import type { NewerVersionWatcher } from "./newer-version.ts";
import type { HostRestart } from "./restart.ts";
import { signInLink, type SignInCodes } from "./sign-in-codes.ts";
import { showWithNotifySend } from "./notify-send.ts";
import type { StatuslineService } from "./statusline.ts";
import type { Store } from "./store.ts";
import type { TerminalService } from "./terminals.ts";
import { VoiceUnavailable, type Voice } from "./voice/voice.ts";
import type { VoiceEngine } from "./voice/engine/engine.ts";
import { thisMacModelsInUse, voiceSettingsProblem, voiceSettingsWithoutKeys, type VoiceSettings } from "../shared/voice.ts";

export interface HostServices {
  config: HostConfig;
  store: Store;
  hub: Hub;
  conversations: ConversationService;
  canvas: CanvasService;
  mcp: CanvasMcpEndpoints;
  apps: AppDocuments;
  plugins: InstalledPlugins;
  canvasPlugins: CanvasPlugins;
  pluginSettings: PluginSettingsStore;
  catalog: PluginCatalog;
  profiles: ProfileService;
  statusline: StatuslineService;
  terminals: TerminalService;
  images: ImageStore;
  droppedFiles: DroppedFiles;
  voice: Voice;
  voiceEngine: VoiceEngine;
  restart: HostRestart;
  desktopApp: DesktopAppCheck;
  newerVersion: NewerVersionWatcher;
  pluginUpdates: Lookout<PluginUpdate[]>;
  devices: DeviceService;
  joinRequests: JoinRequestService;
  signInCodes: SignInCodes;
  search: ConversationSearch;
  relays: MachineRelays;
  watch: MachineWatch;
  /** What the network listener serves with; null while the host listens on 127.0.0.1 only. */
  certificate: ServingCertificate | null;
}

const MAX_SCRIPT_MESSAGE_BYTES = 64 * 1024;
const ONLY_OWN_PAGES_SET_UP_VOICE: ServerMessage = { type: "error", message: "Only Mirador's own pages set up voice on this Mac." };
const MODEL_IN_USE: ServerMessage = { type: "error", message: "The voice settings use this model. Choose another one and save before removing it." };
/** What OpenAI's speech API takes at most: over 13 minutes of 16 kHz mono WAV. */
const MAX_SPOKEN_CLIP_BYTES = 25 * 1024 * 1024;
const MAX_REPLY_BYTES = 1024 * 1024;
const MAX_SPOKEN_SENTENCE_BYTES = 4 * 1024;

async function textWithin(request: Request, maxBytes: number) {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return null;
  const text = await request.text();
  return Buffer.byteLength(text) > maxBytes ? null : text;
}
/**
 * How much of a conversation's history, as stored, a page gets at a time: the page shows at most a few hundred entries,
 * and a long conversation holds hundreds of megabytes.
 */
const PAGE_HISTORY_SIZE = 4_000_000;
const hostRunId = crypto.randomUUID();

const parsedJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const isLoopback = (address: string) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);

const tokenCookie = (token: string, secure: boolean) =>
  `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure ? "; Secure" : ""}`;


/** A header the page encoded with encodeURIComponent, since headers carry Latin-1 only; null when missing or malformed. */
function decodedHeader(value: string | null) {
  if (value === null) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function startServer(services: HostServices) {
  const {
    config,
    store,
    hub,
    conversations,
    canvas,
    mcp,
    apps,
    plugins,
    canvasPlugins,
    pluginSettings,
    catalog,
    profiles,
    statusline,
    terminals,
    images,
    droppedFiles,
    voice,
    voiceEngine,
    restart,
    desktopApp,
    newerVersion,
    pluginUpdates,
    devices,
    joinRequests,
    signInCodes,
    search,
    relays,
    watch,
    certificate,
  } = services;
  const appStorage = new AppStorage(store, (name) => apps.installed().some((app) => app.name === name));
  const { network } = config.reachability;
  const localHosts = [`127.0.0.1:${config.port}`, `localhost:${config.port}`];
  const publicHost = config.publicOrigin ? [new URL(config.publicOrigin).host] : [];
  const networkHosts = network && certificate ? certificate.names.map((name) => `${name}:${network.port}`) : [];
  const allowedHosts = new Set([...localHosts, ...publicHost, ...networkHosts]);
  const hasAllowedHost = (request: Request) => allowedHosts.has(request.headers.get("host") ?? "");
  const pageOrigins = [config.appOrigin, config.publicOrigin, ...networkHosts.map((host) => `https://${host}`)].filter((origin) => origin !== null);
  const isPageOrigin = (origin: string | null) => origin !== null && pageOrigins.includes(origin);
  const localCanvasAssetsOrigin = `http://127.0.0.1:${config.canvasAssetsPort}`;

  /** Each page loads canvas libraries from the address it reached the host at, so it never needs to trust another. */
  function canvasAssetsOriginFor(request: Request) {
    const viewingComputersCopy = request.headers.get(CANVAS_ASSETS_ORIGIN_HEADER);
    if (viewingComputersCopy && /^http:\/\/127\.0\.0\.1:\d+$/.test(viewingComputersCopy)) return viewingComputersCopy;
    const host = request.headers.get("host") ?? "";
    if (localHosts.includes(host)) return localCanvasAssetsOrigin;
    if (network && networkHosts.includes(host)) return `https://${host.slice(0, host.lastIndexOf(":"))}:${network.canvasPort}`;
    return config.canvasAssetsOrigin;
  }

  /** Public, so Settings can tell whether an address reaches this Mirador before it believes it. */
  const here = () => Response.json({ mirador: true });

  /** Public, so devices can trust Mirador's own certificate authority before they join. */
  const serveAuthority = () =>
    certificate?.authority
      ? new Response(certificate.authority, { headers: { "Content-Type": "application/x-pem-file", "Content-Disposition": 'attachment; filename="mirador-ca.pem"' } })
      : new Response("This Mirador has no certificate authority of its own.", { status: 404 });

  const signedInAs = signedInWith(config.browserToken, devices);

  function authenticate(request: Request) {
    if (!hasAllowedHost(request)) return new Response("forbidden host", { status: 403 });
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return Response.redirect(`${config.appOrigin}${url.pathname}${url.search}`, 302);
    const code = url.searchParams.get("code");
    const signsIn = code === null ? sameSecret(url.searchParams.get("token"), config.browserToken) : signInCodes.redeem(code);
    if (!signsIn) return new Response("This sign-in link is not valid, or was used or expired. Run mirador sign-in on this machine for a new one.", { status: 403 });
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": tokenCookie(config.browserToken, false),
      },
    });
  }

  /** From a page of this host, or from no page at all, as when another Mirador joins. */
  function refusedSender(request: Request) {
    if (!hasAllowedHost(request)) return new Response("forbidden host", { status: 403 });
    const origin = request.headers.get("origin");
    if (origin !== null && !isPageOrigin(origin)) return new Response("forbidden origin", { status: 403 });
    return null;
  }

  /** A browser joins with the cookie it gets here; an app without cookies keeps the token from the reply. */
  const admittedWith = (request: Request, token: string) => ({ "Set-Cookie": tokenCookie(token, request.headers.get("origin")?.startsWith("https://") ?? false) });

  async function join(request: Request) {
    const refused = refusedSender(request);
    if (refused) return refused;
    const { code, name } = (await request.json().catch(() => ({}))) as { code?: unknown; name?: unknown };
    if (typeof code !== "string") return new Response("The invite code is missing.", { status: 400 });
    const joined = devices.join(code, deviceName(name));
    if (!joined) return new Response("This invite code is wrong, used or expired. Ask for a new one.", { status: 403 });
    sendDevicesToEveryPage();
    return Response.json({ deviceId: joined.device.id, token: joined.token }, { headers: admittedWith(request, joined.token) });
  }

  const askingToJoin = new SenderLimit();
  const sendJoinRequestsToEveryPage = () => hub.broadcast({ type: "join-requests.listed", joinRequests: joinRequests.waiting() });

  async function answerAboutJoining(request: Request, answer: (body: Record<string, unknown>) => Response | Promise<Response>) {
    const refused = refusedSender(request);
    if (refused) return refused;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return await answer(body);
    } catch (error) {
      if (error instanceof JoinRequestRefused) return new Response(error.message, { status: error.status });
      throw error;
    }
  }

  /** Behind a proxy on this machine, such as `tailscale serve`, the device's own address is the one the proxy forwards. */
  function clientAddressOf(request: Request, server: Bun.Server<SocketData>): ClientAddress {
    const peer = server.requestIP(request)?.address ?? "an unknown address";
    const viaProxyHere = isLoopback(peer);
    const fromAddress = (viaProxyHere && request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim()) || peer;
    return { fromAddress, tailscaleUser: viaProxyHere ? request.headers.get("tailscale-user-login") : null };
  }

  const openJoinRequest = (request: Request, server: Bun.Server<SocketData>) =>
    answerAboutJoining(request, ({ name, commitment, authorityFingerprint }) => {
      const { fromAddress, tailscaleUser } = clientAddressOf(request, server);
      if (!askingToJoin.allows(tailscaleUser ?? fromAddress)) throw new JoinRequestRefused(429, "This device asked to join too often. Try again in a minute.");
      return Response.json(joinRequests.open({ name, commitment, authorityFingerprint, fromAddress, tailscaleUser }), { status: 201 });
    });

  const revealJoinRequestNonce = (request: Bun.BunRequest<"/join-requests/:id/reveal">) =>
    answerAboutJoining(request, async ({ secret, nonce }) => {
      const waiting = await joinRequests.reveal(request.params.id, secret, nonce);
      sendJoinRequestsToEveryPage();
      const notification = joinRequestNotification(waiting);
      if (!hub.notifyThisComputer(notification)) void showWithNotifySend(notification, waiting.expiresAt, () => signInLink(config.appOrigin, signInCodes.mint()));
      return new Response(null, { status: 204 });
    });

  const pollJoinRequest = (request: Bun.BunRequest<"/join-requests/:id/poll">) =>
    answerAboutJoining(request, ({ secret }) => {
      const answer = joinRequests.poll(request.params.id, secret);
      if (answer.answer === "waiting") return Response.json(answer);
      sendJoinRequestsToEveryPage();
      if (answer.answer === "denied") return Response.json(answer);
      sendDevicesToEveryPage();
      return Response.json(answer, { headers: admittedWith(request, answer.token) });
    });

  const authorityFingerprint = certificate?.authority ? fingerprintOf(certificate.authority) : null;
  function reachabilitySettings(): ReachabilitySettings {
    const running = config.reachability;
    const afterRestart = reachability(process.env, config.dataDir, config.port);
    return {
      publicAddress: running.publicAddress,
      savedPublicAddress: savedPublicAddress(config.dataDir),
      publicAddressSetByEnvironment: running.publicAddressSetByEnvironment,
      port: config.port,
      canvasAssetsPort: config.canvasAssetsPort,
      network: running.network !== null,
      savedNetwork: savedNetwork(config.dataDir),
      networkSetByEnvironment: running.networkSetByEnvironment,
      networkPort: running.network?.port ?? config.port + 2,
      networkCanvasPort: running.network?.canvasPort ?? config.port + 3,
      restartNeeded: JSON.stringify(afterRestart) !== JSON.stringify(running),
      authorityFingerprint,
    };
  }
  /** The addresses other devices could reach this host at: its tailnet name, and the addresses devices already used, each one asked.
   * With `serve` the host first puts both of its ports on the tailnet, so a machine with Tailscale needs no commands typed anywhere. */
  async function foundAddresses(serve: boolean) {
    const command = tailscaleCommand();
    const name = command && (await tailnetName(command));
    let problem: string | null = null;
    if (serve && command && name) {
      for (const port of [config.port, config.canvasAssetsPort]) {
        problem ??= await servePortOnTailnet(command, port);
      }
    }
    const candidates: AddressCandidate[] = [
      ...(name ? [{ origin: `https://${name}:${config.port}`, how: "tailnet" as const }] : []),
      ...addressesUsed().map((host) => ({ origin: `https://${host}`, how: "devices" as const })),
    ];
    return { addresses: await addressesThatAnswer(candidates, config.canvasAssetsPort), tailscale: command ? ("present" as const) : ("absent" as const), problem };
  }

  const listedDevices = (): ListedDevice[] => {
    const connections = hub.deviceConnections();
    return devices.list().map((device) => ({ ...device, connection: connections.get(device.id) ?? null }));
  };
  const devicesListed = (socket: BrowserSocket): ServerMessage => ({
    type: "devices.listed",
    devices: listedDevices(),
    thisDeviceId: socket.data.deviceId,
    reachability: reachabilitySettings(),
  });
  const sendDevicesToEveryPage = () => hub.sendEach(devicesListed);
  const pluginsListed = () => listedPlugins(plugins, catalog);

  /** Answers whoever asked for the change, then shows the plugins as they are now on every page. */
  async function changePlugins(socket: BrowserSocket, requestId: string, change: () => Promise<unknown>) {
    const problem = await change().then(
      () => null,
      (error) => withoutCredentials(messageOf(error)),
    );
    hub.send(socket, { type: "plugins.changed", requestId, problem });
    if (problem !== null) return;
    hub.broadcast(await pluginsListed());
    pluginUpdates.recount();
  }

  /** Saves a setting from Settings for the next start, or says what is wrong with it. */
  function problemSaving(save: () => void) {
    try {
      save();
    } catch (error) {
      return errorMessage(error);
    }
    sendDevicesToEveryPage();
    return null;
  }

  function savePublicAddressFromSettings(address: PublicAddress | null) {
    if (config.reachability.publicAddressSetByEnvironment) throw new Error("The host's environment sets its address, so Settings can't change it.");
    const names = { origin: "Address", canvasOrigin: "Canvas address" };
    savePublicAddress(config.dataDir, address && publicAddressOf(address.origin.trim(), address.canvasOrigin.trim(), names));
  }

  function saveNetworkFromSettings(on: boolean) {
    if (config.reachability.networkSetByEnvironment) throw new Error("The host's environment sets whether it listens on the network, so Settings can't change it.");
    saveNetwork(config.dataDir, on);
  }

  function revokeDevice(deviceId: string) {
    devices.revoke(deviceId);
    hub.disconnectWhere((socket) => socket.data.deviceId === deviceId, "device revoked");
    sendDevicesToEveryPage();
  }

  const broadcastMachines = () => hub.broadcast({ type: "machines.changed", machines: store.listMachines() });

  /** With an invite link, this host joins the machine right away; otherwise its place in the window asks for a code. */
  async function addMachine(name: string, address: string) {
    const parsed = machineAddress(address);
    if (!parsed) throw new Error(`"${address}" is not a machine's address.`);
    const { origin, joinCode, authorityFingerprint } = parsed;
    if (pageOrigins.includes(origin)) throw new Error("That is this machine.");
    if (store.findMachineByOrigin(origin)) throw new Error(`${origin} is already among your machines.`);
    const id = crypto.randomUUID();
    store.insertMachine({ id, name: name.trim() || new URL(origin).hostname, origin, createdAt: Date.now() });
    relays.start(store.findMachine(id)!);
    broadcastMachines();
    if (joinCode) await relays.join(id, joinCode, authorityFingerprint);
  }

  function colorMachine(machineId: string, color: Pastel | null) {
    if (color !== null && !isPastel(color)) throw new Error(`Unknown machine colour ${color}`);
    store.setMachineColor(machineId, color);
    broadcastMachines();
  }

  function removeMachine(machineId: string) {
    relays.stop(machineId);
    watch.stop(machineId);
    store.deleteMachine(machineId);
    broadcastMachines();
  }

  /** Agents and the scripts they start call with the host's token and, unlike a browser's POST, no Origin header. */
  function refusedAgentRequest(request: Request, token: string) {
    if (!hasAllowedHost(request) || request.headers.has("origin")) return new Response("forbidden", { status: 403 });
    const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "");
    return sameSecret(bearer, token) ? null : new Response("unauthorized", { status: 401 });
  }

  function serveMcp(request: Request, conversationId: string) {
    const refused = refusedAgentRequest(request, config.mcpToken);
    if (refused) return refused;
    if (!store.findConversation(conversationId)) return new Response("unknown conversation", { status: 404 });
    return mcp.handle(conversationId, request);
  }

  /** A script knows only the agent session it was started from, so it reaches the conversation running that session. */
  const conversationRunning = (sessionId: string) => store.listConversations().find(({ acpSessionId }) => acpSessionId === sessionId);
  const noConversationRuns = () => new Response("No Mirador conversation runs this agent session.", { status: 404 });

  async function scriptRequestText(request: Request) {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_SCRIPT_MESSAGE_BYTES) return null;
    const text = await request.text();
    return text.length > MAX_SCRIPT_MESSAGE_BYTES ? null : text;
  }

  async function receiveScriptMessage(request: Bun.BunRequest<"/sessions/:sessionId/messages">) {
    const refused = refusedAgentRequest(request, config.scriptToken);
    if (refused) return refused;
    const conversation = conversationRunning(request.params.sessionId);
    if (!conversation) return noConversationRuns();
    const text = await scriptRequestText(request);
    if (text === null) return new Response("message too long", { status: 413 });
    if (!text.trim()) return new Response("empty message", { status: 400 });
    conversations.send(conversation.id, text, [], { fromScript: true }).catch(() => {});
    return Response.json({ conversationId: conversation.id }, { status: 202 });
  }

  /** From `mirador when-done`, which an agent runs after starting a job it leaves running. */
  async function receiveJobWait(request: Bun.BunRequest<"/sessions/:sessionId/job-waits">) {
    const refused = refusedAgentRequest(request, config.scriptToken);
    if (refused) return refused;
    const conversation = conversationRunning(request.params.sessionId);
    if (!conversation) return noConversationRuns();
    const body = await scriptRequestText(request);
    if (body === null) return new Response("message too long", { status: 413 });
    const waitRequest = readJobWaitRequest(parsedJson(body));
    if (typeof waitRequest === "string") return new Response(waitRequest, { status: 400 });
    try {
      const wait = await conversations.waitForJob(conversation.id, waitRequest);
      return Response.json({ conversationId: conversation.id, wait }, { status: 201 });
    } catch (error) {
      return new Response(errorMessage(error), { status: error instanceof JobWaitRefused ? 400 : 500 });
    }
  }

  /** Only the app's own pages, signed in with the browser cookie, may read or add a conversation's images and dropped files, or read an app's files. */
  function refusedPageRequest(request: Request) {
    if (!hasAllowedHost(request)) return new Response("forbidden host", { status: 403 });
    if (!signedInAs(request)) return new Response("unauthorized", { status: 401 });
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin") return new Response("forbidden", { status: 403 });
    if (request.method !== "GET" && !isPageOrigin(request.headers.get("origin"))) return new Response("forbidden origin", { status: 403 });
    return null;
  }

  function refusedAttachmentRequest(request: Request, conversationId: string) {
    const refused = refusedPageRequest(request);
    if (refused) return refused;
    if (!store.findConversation(conversationId)) return new Response("unknown conversation", { status: 404 });
    return null;
  }

  /** The network listener drops a request still arriving after Bun's default 10 s; an upload from a signed-in page may take longer. */
  const letUploadTakeItsTime = (request: Request, server: Bun.Server<SocketData>) => server.timeout(request, 0);

  async function addImage(request: Bun.BunRequest<"/conversations/:conversationId/images">, server: Bun.Server<SocketData>) {
    const { conversationId } = request.params;
    const refused = refusedAttachmentRequest(request, conversationId);
    if (refused) return refused;
    letUploadTakeItsTime(request, server);
    if (Number(request.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return new Response("image too large", { status: 413 });
    try {
      const imageId = await images.save(conversationId, request.headers.get("content-type") ?? "", await request.arrayBuffer());
      return Response.json({ imageId });
    } catch (error) {
      return new Response(errorMessage(error), { status: 400 });
    }
  }

  /** What a clip the user spoke says, ready for the message box; sent as WAV, which every speech server reads. */
  async function dictate(request: Bun.BunRequest<"/conversations/:conversationId/speech">, server: Bun.Server<SocketData>) {
    const refused = refusedAttachmentRequest(request, request.params.conversationId);
    if (refused) return refused;
    letUploadTakeItsTime(request, server);
    if (Number(request.headers.get("content-length") ?? 0) > MAX_SPOKEN_CLIP_BYTES) return new Response("The spoken clip is too long.", { status: 413 });
    const clip = await request.blob();
    if (clip.size > MAX_SPOKEN_CLIP_BYTES) return new Response("The spoken clip is too long.", { status: 413 });
    return voiceAnswer(async () => Response.json(await voice.dictation(clip)));
  }

  /** A reply of the agent, sent as text, summed up for reading aloud a sentence at a time. */
  async function sumUpReply(request: Bun.BunRequest<"/conversations/:conversationId/reply-summary">) {
    const refused = refusedAttachmentRequest(request, request.params.conversationId);
    if (refused) return refused;
    const reply = await textWithin(request, MAX_REPLY_BYTES);
    if (reply === null) return new Response("The reply is too long to sum up.", { status: 413 });
    return voiceAnswer(async () => Response.json({ sentences: await voice.replySummary(reply) }));
  }

  /** A sentence of a reply's summary, sent as text, spoken as MP3. */
  async function speakSentence(request: Bun.BunRequest<"/conversations/:conversationId/spoken-sentence">) {
    const refused = refusedAttachmentRequest(request, request.params.conversationId);
    if (refused) return refused;
    const sentence = await textWithin(request, MAX_SPOKEN_SENTENCE_BYTES);
    if (sentence === null) return new Response("The sentence is too long to speak.", { status: 413 });
    return voiceAnswer(async () => new Response(await voice.spoken(sentence), { headers: { "Content-Type": "audio/mpeg" } }));
  }

  /** 409 when Settings → Voice can change what failed. */
  async function voiceAnswer(work: () => Promise<Response>) {
    try {
      return await work();
    } catch (error) {
      return new Response(errorMessage(error), { status: error instanceof VoiceUnavailable ? 409 : 502 });
    }
  }

  const voiceSettingsFor = (socket: BrowserSocket): ServerMessage => {
    const settings = store.voiceSettings();
    return { type: "voice.settings", settings: socket.data.readsProfileLaunch ? settings : voiceSettingsWithoutKeys(settings) };
  };

  /** Says what is wrong instead of saving, as a problem for Settings to show; settings of another shape, as from an older page, get an answer too. */
  function saveVoiceSettings(socket: BrowserSocket, settings: VoiceSettings) {
    if (!socket.data.readsProfileLaunch) return "Only Mirador's own pages change voice settings.";
    try {
      const problem = voiceSettingsProblem(settings);
      if (problem) return problem;
    } catch (error) {
      return errorMessage(error);
    }
    const idleMinutesBefore = store.voiceSettings().engineIdleMinutes;
    store.setVoiceSettings(settings);
    if (settings.engineIdleMinutes !== idleMinutesBefore) voiceEngine.idleTimeChanged();
    void voiceEngine.unloadAllBut(thisMacModelsInUse(settings));
    hub.sendEach(voiceSettingsFor);
    return null;
  }

  /** The browser gives a dropped file's contents but not its path; the host keeps a copy and answers where it is. */
  async function addDroppedFile(request: Bun.BunRequest<"/conversations/:conversationId/files">, server: Bun.Server<SocketData>) {
    const { conversationId } = request.params;
    const refused = refusedAttachmentRequest(request, conversationId);
    if (refused) return refused;
    letUploadTakeItsTime(request, server);
    if (Number(request.headers.get("content-length") ?? 0) > MAX_DROPPED_FILE_BYTES) {
      return new Response(`A dropped file can be at most ${MAX_DROPPED_FILE_BYTES / 1024 / 1024} MB.`, { status: 413 });
    }
    const name = decodedHeader(request.headers.get("x-file-name"));
    if (!name) return new Response("A dropped file needs a name.", { status: 400 });
    try {
      return Response.json({ path: await droppedFiles.save(conversationId, name, await request.blob()) });
    } catch (error) {
      return new Response(errorMessage(error), { status: 400 });
    }
  }

  async function serveImage(request: Bun.BunRequest<"/conversations/:conversationId/images/:imageId">) {
    const { conversationId, imageId } = request.params;
    const refused = refusedAttachmentRequest(request, conversationId);
    if (refused) return refused;
    const file = isImageId(imageId) ? images.file(conversationId, imageId) : null;
    if (!file || !(await file.exists())) return new Response("not found", { status: 404 });
    return new Response(file, { headers: { "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
  }

  /** A file next to an open app's document, for the app's view in the signed-in page. */
  function serveAppFile(request: Bun.BunRequest<"/workspaces/:workspaceId/apps/:app/file">) {
    const refused = refusedPageRequest(request);
    if (refused) return refused;
    const { workspaceId, app } = request.params;
    try {
      const file = Bun.file(apps.fileNextToDocument(workspaceId, app, new URL(request.url).searchParams.get("path")));
      return new Response(file, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    } catch (error) {
      return new Response(errorMessage(error), { status: error instanceof AppFileRefused ? error.status : 500 });
    }
  }

  /** An address the app's view streams a file next to its document from, on the canvas assets, where its sandboxed page may load media. */
  function grantAppMedia(request: Bun.BunRequest<"/workspaces/:workspaceId/apps/:app/media">) {
    const refused = refusedPageRequest(request);
    if (refused) return refused;
    const { workspaceId, app } = request.params;
    try {
      return Response.json(apps.mediaGrant(workspaceId, app, new URL(request.url).searchParams.get("path")));
    } catch (error) {
      return new Response(errorMessage(error), { status: error instanceof AppFileRefused ? error.status : 500 });
    }
  }

  /** An image an agent's tool returned, which the low-data form of its event links to. */
  function serveEventImage(request: Bun.BunRequest<"/conversations/:conversationId/events/:seq/images/:index">) {
    const { conversationId, seq, index } = request.params;
    const refused = refusedAttachmentRequest(request, conversationId);
    if (refused) return refused;
    const stored = store.findEvent(conversationId, Number(seq));
    const image = stored ? imagesOf(stored)[Number(index)] : undefined;
    if (!image || !extensionFor(image.mimeType)) return new Response("not found", { status: 404 });
    return new Response(Buffer.from(image.data, "base64"), {
      headers: { "Content-Type": image.mimeType, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  }

  const listedCanvas = (conversationId: string) => canvas.list(conversationId).map((item) => (item.kind === "plugin" ? canvasPlugins.listed(item) : item));

  /** A phone that held events before gets only the ones after them, unless a rewind took the last of them away; otherwise the latest turns, and earlier ones when it asks. */
  function lowDataHistory(conversationId: string, { latestTurns, afterSeq, canvasChangedAfter }: LowDataSubscription): ServerMessage {
    const inLowData = (events: StoredEvent[]) => events.map((event) => lowDataEvent(conversationId, event));
    const history = { type: "conversation.history", conversationId, canvas: listedCanvas(conversationId) } as const;
    const missed = afterSeq === undefined ? null : store.eventsMissedAfter(conversationId, afterSeq);
    if (missed) {
      const changedCanvas = canvasChangedAfter === undefined ? history.canvas : canvasChangedSince(history.canvas, canvasChangedAfter);
      return { ...history, canvas: changedCanvas, events: inLowData(coalescedFromNextTurn(missed)), continuesAfter: afterSeq };
    }
    const { fromSeq, hasEarlier } = store.latestTurns(conversationId, latestTurns);
    return { ...history, events: inLowData(withChunksCoalesced(store.listEventsFrom(conversationId, fromSeq))), hasEarlier };
  }

  /** A page gets the newest turns first, about as much of them at a time as PAGE_HISTORY_SIZE, and earlier ones as it asks. */
  function pageHistory(conversationId: string): ServerMessage {
    const { events, hasEarlier } = pageHistoryBefore(conversationId, Number.MAX_SAFE_INTEGER);
    return { type: "conversation.history", conversationId, events, canvas: listedCanvas(conversationId), hasEarlier };
  }

  /** The turns before `beforeSeq` that make up the next part of the history, or more to reach back to an event the page wants. */
  function pageHistoryBefore(conversationId: string, beforeSeq: number, reaching?: number) {
    const newest = store.newestTurnsWithin(conversationId, beforeSeq, PAGE_HISTORY_SIZE);
    const fromSeq = reaching === undefined ? newest : Math.min(newest, store.turnStartOf(conversationId, reaching));
    const events = withChunksCoalesced(store.listEventsBetween(conversationId, fromSeq, beforeSeq)).map(pageEvent);
    return { conversationId, events, hasEarlier: store.hasEventsBefore(conversationId, fromSeq) };
  }

  /** The phone may hold the first chunks of a message the events it missed go on with, so those stay as they are. */
  function coalescedFromNextTurn(events: StoredEvent[]) {
    const nextTurn = events.findIndex(({ event }) => event.type === "user-message");
    return nextTurn === -1 ? events : [...events.slice(0, nextTurn), ...withChunksCoalesced(events.slice(nextTurn))];
  }

  /** The desktop app listens on /notifications with the same token and origin as the pages, and hears only system notifications. */
  function upgradeBrowser(request: Request, server: Bun.Server<SocketData>, role: SocketData["role"]) {
    if (!hasAllowedHost(request)) return new Response("forbidden host", { status: 403 });
    const signedIn = signedInAs(request);
    if (!signedIn) return new Response("unauthorized", { status: 401 });
    if (!isPageOrigin(request.headers.get("origin"))) return new Response("forbidden origin", { status: 403 });
    const readsDeflatedMessages = request.headers.has(DEFLATED_MESSAGES_HEADER);
    const { searchParams } = new URL(request.url);
    const readsProfileLaunch = searchParams.has(PROFILE_LAUNCH_PARAMETER);
    const desktopAppCode = role === "notifier" ? searchParams.get(DESKTOP_APP_CODE_PARAMETER) : null;
    rememberAddressUsed(request.headers.get("host"));
    const data = socketData(role, signedIn.deviceId, canvasAssetsOriginFor(request), clientAddressOf(request, server), readsDeflatedMessages, readsProfileLaunch, desktopAppCode);
    const upgraded = server.upgrade(request, { data });
    return upgraded ? undefined : new Response("upgrade failed", { status: 400 });
  }

  function deleteConversation(conversationId: string) {
    canvas.withdrawWaitingAsks(conversationId);
    terminals.closeConversation(conversationId);
    conversations.delete(conversationId);
    mcp.forget(conversationId);
  }

  const sidebarNow = () => ({ workspaces: store.listWorkspaces(), groups: store.listWorkspaceGroups() });

  /** Tells every window of the workspaces and groups whose place in the sidebar changed since `before`: their position, or a workspace's group. */
  function broadcastSidebarChanges(before: ReturnType<typeof sidebarNow>) {
    const placeOf = ({ position, groupId }: Workspace) => `${position} ${groupId}`;
    const workspacePlaces = new Map(before.workspaces.map((workspace) => [workspace.id, placeOf(workspace)]));
    const groupPositions = new Map(before.groups.map(({ id, position }) => [id, position]));
    const now = sidebarNow();
    now.workspaces.filter((workspace) => workspacePlaces.get(workspace.id) !== placeOf(workspace)).forEach((workspace) => hub.broadcast({ type: "workspace.upserted", workspace }));
    now.groups.filter(({ id, position }) => groupPositions.get(id) !== position).forEach((group) => hub.broadcast({ type: "workspace-group.upserted", group }));
  }

  /** Something lands in a group just before a workspace of it, or among the groups and the workspaces in none before either; or last. */
  function checkLanding({ workspaces, groups }: ReturnType<typeof sidebarNow>, groupId: string | null, beforeWorkspaceId: string | null, beforeGroupId: string | null) {
    const groupExists = (id: string) => groups.some((group) => group.id === id);
    if (groupId !== null && !groupExists(groupId)) throw new Error("That group is gone");
    if (beforeGroupId !== null && groupId !== null) throw new Error("Only something in no group can land before a group");
    if (beforeGroupId !== null && !groupExists(beforeGroupId)) throw new Error("That group is gone");
    const landsBefore = workspaces.find(({ id }) => id === beforeWorkspaceId);
    if (landsBefore && landsBefore.groupId !== groupId) throw new Error("A workspace can only land before another of the same group");
  }

  /** Without a group, as the phone app moves it, a workspace keeps its own, and lands near the workspace named if that is in another. */
  function moveWorkspace(workspaceId: string, groupId: string | null | undefined, beforeWorkspaceId: string | null, beforeGroupId: string | null) {
    const before = sidebarNow();
    const moving = before.workspaces.find(({ id }) => id === workspaceId);
    if (!moving) throw new Error("That workspace is gone");
    const landsIn = groupId === undefined ? moving.groupId : groupId;
    if (groupId !== undefined) {
      checkLanding(before, groupId, beforeWorkspaceId, beforeGroupId);
      store.setWorkspaceGroup(workspaceId, groupId);
    }
    const workspaces = before.workspaces.map((workspace) => (workspace.id === workspaceId ? { ...workspace, groupId: landsIn } : workspace));
    store.setSidebarOrder(sidebarIdsAfterMove(workspaces, before.groups, workspaceId, beforeGroupId ?? beforeWorkspaceId));
    broadcastSidebarChanges(before);
  }

  function groupName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A group needs a name");
    return trimmed;
  }

  function createWorkspaceGroup(name: string) {
    const group = store.insertWorkspaceGroup({ id: crypto.randomUUID(), name: groupName(name), createdAt: Date.now() });
    hub.broadcast({ type: "workspace-group.upserted", group });
  }

  function renameWorkspaceGroup(groupId: string, name: string) {
    store.renameWorkspaceGroup(groupId, groupName(name));
    const group = store.findWorkspaceGroup(groupId);
    if (group) hub.broadcast({ type: "workspace-group.upserted", group });
  }

  function moveWorkspaceGroup(groupId: string, beforeGroupId: string | null, beforeWorkspaceId: string | null) {
    const before = sidebarNow();
    if (!before.groups.some(({ id }) => id === groupId)) throw new Error("That group is gone");
    checkLanding(before, null, beforeWorkspaceId, beforeGroupId);
    store.setSidebarOrder(sidebarIdsAfterMove(before.workspaces, before.groups, groupId, beforeGroupId ?? beforeWorkspaceId));
    broadcastSidebarChanges(before);
  }

  function deleteWorkspaceGroup(groupId: string) {
    const before = sidebarNow();
    store.deleteWorkspaceGroup(groupId);
    broadcastSidebarChanges(before);
    hub.broadcast({ type: "workspace-group.deleted", groupId });
  }

  function savePromptTemplate(draft: Pick<PromptTemplate, "id" | "name" | "text">) {
    const problem = promptTemplateProblem(draft);
    if (problem) throw new Error(problem);
    const { id, name, text } = draft;
    store.savePromptTemplate({ id, name: name.trim(), text, createdAt: Date.now() });
    hub.broadcast({ type: "prompt-template.upserted", template: store.findPromptTemplate(id)! });
  }

  let claudeProgram = claudeProgramReport(store.claudeProgramSetting(), null, null);
  const lookUpClaudeProgram = claudeProgramLookUps((program) => {
    claudeProgram = program;
    hub.broadcast({ type: "settings.claude-program", claudeProgram });
  });
  void lookUpClaudeProgram(store.claudeProgramSetting());

  /** Claude Code agents start again with the new program; turns they were running stop, as when a profile changes. */
  function setClaudeProgram(path: string) {
    store.setClaudeProgramSetting(path.trim());
    conversations.restartClaudeAgents();
    return lookUpClaudeProgram(store.claudeProgramSetting());
  }

  function setScriptProgram(program: string) {
    store.setScriptProgramSetting(program.trim());
    hub.broadcast({ type: "settings.script-program", scriptProgram: store.scriptProgramSetting() });
  }

  /** The picture every page shows next to the user's messages; null leaves the person icon. */
  function setAvatar(image: string | null) {
    const problem = image === null ? null : avatarProblem(image);
    if (problem) throw new Error(problem);
    store.setAvatarSetting(image);
    hub.broadcast({ type: "settings.avatar", image });
  }

  /** Conversations pick it up when their session next starts or resumes. */
  function setCanvasUse(canvasUse: CanvasUse) {
    if (!isCanvasUse(canvasUse)) throw new Error(`Unknown canvas use ${canvasUse}`);
    store.setCanvasUse(canvasUse);
    hub.broadcast({ type: "settings.canvas-use", canvasUse });
  }

  function deletePromptTemplate(templateId: string) {
    store.deletePromptTemplate(templateId);
    hub.broadcast({ type: "prompt-template.deleted", templateId });
  }

  function colorWorkspace(workspaceId: string, color: Pastel | null) {
    if (color !== null && !isPastel(color)) throw new Error(`Unknown workspace colour ${color}`);
    store.setWorkspaceColor(workspaceId, color);
    const workspace = store.findWorkspace(workspaceId);
    if (workspace) hub.broadcast({ type: "workspace.upserted", workspace });
  }

  async function createWorkspace(path: string, profileId: string | null): Promise<Workspace> {
    const directory = await directoryToAdd(path);
    const existing = store.findWorkspaceByPath(directory);
    if (existing) return existing;
    return store.insertWorkspace({
      id: crypto.randomUUID(),
      name: basename(directory) || directory,
      path: directory,
      defaultLaunch: launchForNewWorkspace(store, profileId),
      createdAt: Date.now(),
    });
  }

  const newestSessionSearch = newestOnly<BrowserSocket>();

  async function dispatch(socket: BrowserSocket, message: ClientMessage) {
    const reply = (response: ServerMessage) => hub.send(socket, response);
    switch (message.type) {
      case "workspace.create":
        return hub.broadcast({ type: "workspace.upserted", workspace: await createWorkspace(message.path, message.profileId) });
      case "workspace.delete":
        conversations
          .list()
          .filter((conversation) => conversation.workspaceId === message.workspaceId)
          .forEach((conversation) => deleteConversation(conversation.id));
        apps.forgetWorkspace(message.workspaceId);
        store.deleteWorkspace(message.workspaceId);
        return hub.broadcast({ type: "workspace.deleted", workspaceId: message.workspaceId });
      case "workspace.set-default-launch":
        return profiles.setWorkspaceDefault(message.workspaceId, message.launch);
      case "workspace.move":
        return moveWorkspace(message.workspaceId, message.groupId, message.beforeWorkspaceId, message.beforeGroupId ?? null);
      case "workspace.set-color":
        return colorWorkspace(message.workspaceId, message.color);
      case "workspace-group.create":
        return createWorkspaceGroup(message.name);
      case "workspace-group.rename":
        return renameWorkspaceGroup(message.groupId, message.name);
      case "workspace-group.move":
        return moveWorkspaceGroup(message.groupId, message.beforeGroupId, message.beforeWorkspaceId ?? null);
      case "workspace-group.delete":
        return deleteWorkspaceGroup(message.groupId);
      case "profile.save":
        return reply({ type: "profile.saved", requestId: message.requestId, profileId: profiles.save(message.profile).id });
      case "profile.delete":
        return profiles.delete(message.profileId);
      case "prompt-template.save":
        return savePromptTemplate(message.template);
      case "prompt-template.delete":
        return deletePromptTemplate(message.templateId);
      case "settings.set-canvas-use":
        return setCanvasUse(message.canvasUse);
      case "settings.set-claude-program":
        return setClaudeProgram(message.path);
      case "newer-version.check":
        return void newerVersion.lookNow().then((failure) => reply({ type: "newer-version.checked", requestId: message.requestId, failure }));
      case "settings.set-script-program":
        return setScriptProgram(message.program);
      case "settings.set-avatar":
        return setAvatar(message.image);
      case "conversation.create":
        conversations.create(message.workspaceId, message.launch);
        return;
      case "sessions.list":
        conversations
          .listSessionsInWorkspace(message.workspaceId, message.launch)
          .then((sessions) => reply({ type: "sessions.listed", requestId: message.requestId, sessions }))
          .catch((error) => reply({ type: "sessions.failed", requestId: message.requestId, message: errorMessage(error) }));
        return;
      case "sessions.search":
        conversations
          .searchSessionsInWorkspace(message.workspaceId, message.launch, message.query, newestSessionSearch(socket))
          .then((sessions) => reply({ type: "sessions.searched", requestId: message.requestId, sessions }))
          .catch((error) => reply({ type: "sessions.failed", requestId: message.requestId, message: errorMessage(error) }));
        return;
      case "mentions.suggest":
        return reply({ type: "mentions.suggested", requestId: message.requestId, suggestions: await conversations.mentionSuggestions(message.conversationId, message.query) });
      case "slash-commands.list":
        return reply({ type: "slash-commands.listed", requestId: message.requestId, commands: conversations.slashCommands(message.conversationId) });
      case "prompt-history.list":
        return reply({
          type: "prompt-history.listed",
          requestId: message.requestId,
          prompts: conversations.typedElsewhere(message.conversationId),
          ...(message.ownBeforeSeq !== undefined && { ownEarlier: conversations.typedEarlierIn(message.conversationId, message.ownBeforeSeq) }),
        });
      case "conversation.rename":
        return conversations.rename(message.conversationId, message.title);
      case "conversation.set-unread":
        return message.unread ? conversations.markUnread(message.conversationId) : conversations.markSeen(message.conversationId);
      case "conversation.set-profile":
        return conversations.setProfile(message.conversationId, message.profileId);
      case "conversation.adopt":
        conversations.adopt(message.workspaceId, message.launch, message.session, message.mode);
        return;
      case "conversation.delete":
        return deleteConversation(message.conversationId);
      case "conversation.move":
        return conversations.move(message.conversationId, message.beforeConversationId);
      case "conversation.subscribe":
        socket.data.subscriptions.add(message.conversationId);
        if (message.lowData) {
          socket.data.lowDataSubscriptions.add(message.conversationId);
          return reply(lowDataHistory(message.conversationId, message.lowData));
        }
        socket.data.lowDataSubscriptions.delete(message.conversationId);
        return reply(pageHistory(message.conversationId));
      case "conversation.unsubscribe":
        socket.data.subscriptions.delete(message.conversationId);
        socket.data.lowDataSubscriptions.delete(message.conversationId);
        return;
      case "conversation.load-earlier": {
        const { conversationId, beforeSeq, turns, reaching } = message;
        if (turns === undefined) return reply({ type: "conversation.earlier", requestId: message.requestId, beforeSeq, ...pageHistoryBefore(conversationId, beforeSeq, reaching) });
        const { fromSeq, hasEarlier } = store.turnsBefore(conversationId, beforeSeq, turns);
        const events = withChunksCoalesced(store.listEventsBetween(conversationId, fromSeq, beforeSeq)).map((event) => lowDataEvent(conversationId, event));
        return reply({ type: "conversation.earlier", requestId: message.requestId, conversationId, beforeSeq, events, hasEarlier });
      }
      case "conversation.find": {
        const { requestId, conversationId, query, caseSensitive, beforeSeq } = message;
        return reply({ type: "conversation.found", requestId, conversationId, entries: search.matchesBefore(conversationId, query, { caseSensitive }, beforeSeq) });
      }
      case "tool-raw-output.get":
        return reply({ type: "tool-raw-output.got", requestId: message.requestId, rawOutput: store.latestRawOutput(message.conversationId, message.toolCallId) });
      case "tool-output.get": {
        const stored = store.findEvent(message.conversationId, message.seq);
        return reply({ type: "tool-output.got", requestId: message.requestId, content: stored ? wholeToolOutput(message.conversationId, stored) : [] });
      }
      case "conversation.prompt":
        conversations.send(message.conversationId, message.text, message.imageIds, { afterTurn: message.afterTurn }).catch((error) => reply({ type: "error", message: errorMessage(error) }));
        return;
      case "conversation.run-command":
        return conversations.runCommand(message.conversationId, message.command);
      case "conversation.stop-command":
        return conversations.stopCommand(message.conversationId, message.commandId);
      case "conversation.drop-command-outputs":
        return conversations.dropCommandOutputs(message.conversationId, message.commandIds);
      case "conversation.queue.edit":
        return conversations.editQueuedMessage(message.conversationId, message.messageId, message.text);
      case "conversation.queue.move":
        return conversations.moveQueuedMessage(message.conversationId, message.messageId, message.beforeMessageId);
      case "conversation.queue.remove":
        return conversations.removeQueuedMessage(message.conversationId, message.messageId);
      case "images.discard":
        return conversations.discardImages(message.conversationId, message.imageIds);
      case "conversation.queue.set-after-turn":
        return conversations.setQueuedMessageAfterTurn(message.conversationId, message.messageId, message.afterTurn);
      case "conversation.usage-limit.continue":
        return conversations.continueAfterUsageLimit(message.conversationId);
      case "conversation.try-again":
        return conversations.tryAgainAfterError(message.conversationId, message.errorSeq);
      case "conversation.usage-limit.stop-waiting":
        return conversations.stopWaitingForUsageLimit(message.conversationId);
      case "conversation.job-wait.stop":
        return conversations.stopWaitingForJob(message.conversationId, message.waitId);
      case "conversation.async-task.stop":
        return conversations.stopAsyncTask(message.conversationId, message.asyncTaskId).catch((error) =>
          reply({ type: "error", message: errorMessage(error) }),
        );
      case "conversation.async-task.dismiss":
        return conversations.dismissAsyncTask(message.conversationId, message.asyncTaskId);
      case "conversation.async-task.clear-finished":
        return conversations.clearFinishedAsyncTasks(message.conversationId);
      case "conversation.delegation.dismiss":
        return conversations.dismissDelegation(message.conversationId);
      case "async-task.output.get":
        return reply({
          type: "async-task.output.got",
          requestId: message.requestId,
          text: conversations.asyncTaskOutput(message.conversationId, message.asyncTaskId),
        });
      case "conversation.cancel":
        canvas.withdrawWaitingAsks(message.conversationId);
        return conversations.cancel(message.conversationId, { force: message.force });
      case "conversation.revert-preview":
        return conversations
          .previewRevert(message.conversationId, message.seq)
          .then(({ plan, files, cannotUndo }) => reply({ type: "conversation.revert-previewed", requestId: message.requestId, plan, ...(files && { files }), ...(cannotUndo && { cannotUndo }) }))
          .catch((error) => reply({ type: "conversation.revert-failed", requestId: message.requestId, message: errorMessage(error) }));
      case "conversation.revert":
        return conversations
          .revert(message.conversationId, message.seq)
          .then((plan) => reply({ type: "conversation.reverted", requestId: message.requestId, plan }))
          .catch((error) => reply({ type: "conversation.revert-failed", requestId: message.requestId, message: errorMessage(error) }));
      case "conversation.rewind-preview":
        return conversations
          .previewRewind(message.conversationId, message.seq)
          .then(({ turnsLeaving, keptFrom, plan, files, cannotRewind, filesNote }) =>
            reply({ type: "conversation.rewind-previewed", requestId: message.requestId, turnsLeaving, keptFrom, plan, ...(files && { files }), ...(cannotRewind && { cannotRewind }), ...(filesNote && { filesNote }) }),
          )
          .catch((error) => reply({ type: "conversation.rewind-failed", requestId: message.requestId, message: errorMessage(error) }));
      case "conversation.rewind":
        return conversations
          .rewind(message.conversationId, message.seq, { keepFiles: message.keepFiles === true })
          .then(({ fromSeq }) => reply({ type: "conversation.rewind-done", requestId: message.requestId, conversationId: message.conversationId, fromSeq }))
          .catch((error) => reply({ type: "conversation.rewind-failed", requestId: message.requestId, message: errorMessage(error) }));
      case "conversation.set-ask-mode":
        return conversations.setAskMode(message.conversationId, message.askMode);
      case "conversation.set-plugin-setting":
        conversations.setPluginSetting(message.conversationId, message.plugin, message.setting, message.value);
        return canvasPlugins.settingChanged(message.conversationId, message.plugin, message.setting);
      case "conversation.set-bypass-permissions":
        return conversations.setBypassPermissions(message.conversationId, message.bypassPermissions);
      case "conversation.set-config":
        return conversations.setConfigOption(message.conversationId, message.configId, message.value);
      case "permission.respond":
        return conversations.respondToPermission(message.conversationId, message.permissionId, message.optionId);
      case "ask.answer":
        return canvas.answer(message.itemId, message.label, message.note, message.answers);
      case "app.subscribe": {
        socket.data.appSubscriptions.add(appKey(message));
        hub.send(socket, { type: "app.storage", workspaceId: message.workspaceId, app: message.app, items: appStorage.items(message.workspaceId, message.app) });
        const state = apps.state(message.workspaceId, message.app);
        if (state) hub.send(socket, { type: "app.state", state });
        return;
      }
      case "app.unsubscribe":
        socket.data.appSubscriptions.delete(appKey(message));
        return;
      case "app.apply":
        return void apps
          .apply(message.workspaceId, message.app, message.op, { kind: "you" })
          .catch((error) => {
            console.warn(`${message.app}'s view applied an operation that failed: ${messageOf(error)}`);
            hub.send(socket, { type: "error", message: messageOf(error) });
          });
      case "app.use-in":
        try {
          return apps.useIn(message.workspaceId, message.app, message.conversationId);
        } catch (error) {
          return hub.send(socket, { type: "error", message: messageOf(error) });
        }
      case "app.run":
        try {
          return void apps.runFromView(message.workspaceId, message.app, message.task);
        } catch (error) {
          return hub.send(socket, { type: "error", message: messageOf(error) });
        }
      case "app.stop-task":
        try {
          return apps.stopTask(message.workspaceId, message.app);
        } catch (error) {
          return hub.send(socket, { type: "error", message: messageOf(error) });
        }
      case "app.storage-set": {
        const { workspaceId, app } = message;
        try {
          const items = appStorage.set(workspaceId, app, message.key, message.value);
          return hub.publishWhere((each) => each.data.appSubscriptions.has(appKey(message)), { type: "app.storage", workspaceId, app, items });
        } catch (error) {
          return hub.send(socket, { type: "error", message: messageOf(error) });
        }
      }
      case "canvas.report":
        return canvas.reportRender(message.itemId, { errors: message.errors });
      case "canvas.item-action":
        return void canvasPlugins.act(message.itemId, message.action).then(
          (answer) => reply({ type: "canvas.item-acted", requestId: message.requestId, reply: answer, problem: null }),
          (error) => reply({ type: "canvas.item-acted", requestId: message.requestId, reply: null, problem: messageOf(error) }),
        );
      case "canvas.dismiss":
        return canvasPlugins.dismiss(message.itemId);
      case "canvas.export":
        canvas
          .exportPage(message.itemId, message.libraries)
          .then(({ html }) => reply({ type: "canvas.exported", requestId: message.requestId, html }))
          .catch((error) => reply({ type: "canvas.export-failed", requestId: message.requestId, message: errorMessage(error), alreadyThere: false }));
        return;
      case "canvas.save-to-project":
      case "canvas.save-image-to-project":
        canvas
          .saveIntoProject(message.itemId, message.path, message.replace, message.type === "canvas.save-to-project" ? message.libraries : Buffer.from(message.image, "base64"))
          .then((path) => reply({ type: "canvas.saved-to-project", requestId: message.requestId, path }))
          .catch((error) =>
            reply({ type: "canvas.export-failed", requestId: message.requestId, message: errorMessage(error), alreadyThere: error instanceof FileAlreadyThere }),
          );
        return;
      case "changes.list":
        conversations.changes
          .list(message.conversationId, message.scope)
          .then((list) => reply({ type: "changes.listed", requestId: message.requestId, list }))
          .catch((error) => reply({ type: "changes.failed", requestId: message.requestId, message: errorMessage(error) }));
        return;
      case "changes.diff":
        conversations.changes
          .diff(message.conversationId, message.scope, message.path)
          .then((changes) => reply({ type: "changes.diffed", requestId: message.requestId, changes }))
          .catch((error) => reply({ type: "changes.failed", requestId: message.requestId, message: errorMessage(error) }));
        return;
      case "changes.files":
        conversations.changes
          .files(message.conversationId)
          .then((files) => reply({ type: "changes.files-listed", requestId: message.requestId, files }))
          .catch((error) => reply({ type: "changes.failed", requestId: message.requestId, message: errorMessage(error) }));
        return;
      case "changes.open-in-editor":
        return conversations.changes.openInEditor(message.conversationId, message.path, message.line);
      case "files.open":
        return conversations.changes
          .openFile(message.conversationId, message.path, message.ownerAgreed === true)
          .catch((error) =>
            reply(error instanceof OutsideWorkspace ? { type: "files.ask-to-open", conversationId: message.conversationId, file: error.file } : { type: "error", message: errorMessage(error) }),
          );
      case "fs.complete":
        return reply({
          type: "fs.completions",
          requestId: message.requestId,
          directories: await completeDirectories(message.prefix),
          createsDirectory: await createsDirectory(message.prefix),
        });
      case "statusline.render":
        // A page asks a moment after each change of the conversation, so the conversation may have been deleted meanwhile.
        if (!store.findConversation(message.conversationId)) return;
        return statusline
          .render(message.conversationId, message.columns, message.runCommand)
          .then((render) => reply({ type: "statusline.rendered", requestId: message.requestId, statusline: render }))
          .catch((error) => reply({ type: "error", message: errorMessage(error) }));
      case "subagent-usage.get":
        // A page asks every few seconds while subagents show, so the conversation may have been deleted meanwhile.
        if (!store.findConversation(message.conversationId)) return;
        return conversations
          .subagentUsage(message.conversationId, message.toolCallIds)
          .then((usage) => reply({ type: "subagent-usage.got", requestId: message.requestId, usage }))
          .catch((error) => reply({ type: "error", message: errorMessage(error) }));
      case "terminals.attach":
        return terminals.attach(socket, message.conversationId);
      case "terminal.open":
        return reply({ type: "terminal.opened", requestId: message.requestId, ...terminals.open(message.conversationId, message.columns, message.rows, message.split) });
      case "terminal.open-login": {
        const program = conversations.loginProgram(message.conversationId);
        const { exited, ...opened } = terminals.openProgram(message.conversationId, message.columns, message.rows, program);
        void exited.then((exitCode) => conversations.loginEnded(message.conversationId, exitCode === 0));
        return reply({ type: "terminal.opened", requestId: message.requestId, ...opened });
      }
      case "terminal.follow-job": {
        const program = conversations.jobFollowProgram(message.conversationId, message.waitId);
        const { exited: _, ...opened } = terminals.openProgram(message.conversationId, message.columns, message.rows, program);
        return reply({ type: "terminal.opened", requestId: message.requestId, ...opened });
      }
      case "terminal.open-panel-command": {
        const program = conversations.panelCommandProgram(message.conversationId, message.line);
        const { exited: _, ...opened } = terminals.openProgram(message.conversationId, message.columns, message.rows, program);
        return reply({ type: "terminal.opened", requestId: message.requestId, ...opened });
      }
      case "terminal.replay":
        return terminals.replay(socket, message.terminalId);
      case "terminal.input":
        return terminals.input(message.terminalId, message.data);
      case "terminal.resize":
        return terminals.resize(message.terminalId, message.columns, message.rows);
      case "terminal.close":
        return message.unlessBusy ? terminals.closeUnlessBusy(socket, message.terminalId) : terminals.close(message.terminalId);
      case "terminal.close-tab":
        return message.unlessBusy ? terminals.closeTabUnlessBusy(socket, message.tabId) : terminals.closeTab(message.tabId);
      case "presence":
        socket.data.presence = { conversationId: message.conversationId, attentive: message.attentive };
        if (message.attentive && message.conversationId) conversations.markSeen(message.conversationId);
        return;
      case "terminal.clear":
        return terminals.clear(message.terminalId);
      case "host.restart":
        return restart.restart();
      case "devices.list":
        return hub.send(socket, devicesListed(socket));
      case "plugins.choose-setting":
        try {
          pluginSettings.choose(message.plugin, message.setting, message.value);
          return hub.broadcast({ type: "plugins.settings", pluginSettings: pluginSettings.all() });
        } catch (error) {
          return hub.send(socket, { type: "error", message: messageOf(error) });
        }
      case "plugins.list":
        return void pluginsListed()
          .then((listed) => hub.send(socket, listed))
          .then(() => catalog.refresh())
          .then(pluginsListed)
          .then((listed) => hub.send(socket, listed))
          .catch((error) => console.warn(`Listing the plugins failed: ${messageOf(error)}`));
      case "plugins.add":
        return void changePlugins(socket, message.requestId, () => plugins.add(message.url, message.branch));
      case "plugins.update":
        return void changePlugins(socket, message.requestId, () => plugins.update(message.folder));
      case "plugins.remove":
        return void changePlugins(socket, message.requestId, async () => {
          const name = await plugins.remove(message.folder);
          if (name) store.forgetOpenApps(name);
        });
      case "plugins.find-commits":
        return void plugins.news(message.folder).then(
          (news) => {
            reply({ type: "plugins.commits-found", requestId: message.requestId, ...news, problem: null });
            pluginUpdates.recount();
          },
          (error) => reply({ type: "plugins.commits-found", requestId: message.requestId, release: null, commits: [], problem: withoutCredentials(messageOf(error)) }),
        );
      case "devices.invite":
        return hub.send(socket, { type: "devices.invited", requestId: message.requestId, ...devices.invite() });
      case "address.find":
      case "address.serve":
        return void foundAddresses(message.type === "address.serve").then((found) =>
          reply({ type: "address.found", requestId: message.requestId, ...found }),
        );
      case "device.revoke":
        return revokeDevice(message.deviceId);
      case "settings.set-public-address":
        return reply({ type: "settings.saved", requestId: message.requestId, problem: problemSaving(() => savePublicAddressFromSettings(message.address)) });
      case "settings.set-network":
        return reply({ type: "settings.saved", requestId: message.requestId, problem: problemSaving(() => saveNetworkFromSettings(message.on)) });
      case "voice.set-settings":
        return reply({ type: "settings.saved", requestId: message.requestId, problem: saveVoiceSettings(socket, message.settings) });
      case "voice.engine.set-up":
        if (!socket.data.readsProfileLaunch) return reply(ONLY_OWN_PAGES_SET_UP_VOICE);
        return voiceEngine.setUp(message.models);
      case "voice.engine.cancel":
        if (!socket.data.readsProfileLaunch) return reply(ONLY_OWN_PAGES_SET_UP_VOICE);
        return voiceEngine.cancel();
      case "voice.engine.remove":
        if (!socket.data.readsProfileLaunch) return reply(ONLY_OWN_PAGES_SET_UP_VOICE);
        return await voiceEngine.remove();
      case "voice.engine.remove-model":
        if (!socket.data.readsProfileLaunch) return reply(ONLY_OWN_PAGES_SET_UP_VOICE);
        if (thisMacModelsInUse(store.voiceSettings()).includes(message.model)) return reply(MODEL_IN_USE);
        return await voiceEngine.removeModel(message.model);
      case "machine.add":
        return await addMachine(message.name, message.address);
      case "machine.remove":
        return removeMachine(message.machineId);
      case "machine.set-color":
        return colorMachine(message.machineId, message.color);
      case "join-request.approve": {
        const problem = await joinRequests.approve(message.joinRequestId, message.number).then(
          (approved) => (approved ? null : "That is not the number the device shows, so its request was denied. It can ask again."),
          errorMessage,
        );
        sendJoinRequestsToEveryPage();
        return reply({ type: "join-request.answered", requestId: message.requestId, problem });
      }
      case "join-request.deny":
        joinRequests.deny(message.joinRequestId);
        return sendJoinRequestsToEveryPage();
      case "machine.ask-to-join":
        return void relays
          .askToJoin(message.machineId, (number) => reply({ type: "machine.join-asked", requestId: message.requestId, number }))
          .then(() => null, errorMessage)
          .then((problem) => reply({ type: "machine.join-answered", requestId: message.requestId, problem }));
      case "machine.join": {
        const problem = await relays.join(message.machineId, message.code, message.authorityFingerprint).then(() => null, errorMessage);
        return reply({ type: "machine.join-answered", requestId: message.requestId, problem });
      }
      case "search":
        return reply({ type: "search.results", requestId: message.requestId, conversations: search.find(message.query) });
      default:
        return message satisfies never;
    }
  }

  /** All the network listener serves: what pages of other devices use. */
  const routesForDevices = {
    "/": index,
    "/join": { POST: join },
    "/join-requests": { POST: openJoinRequest },
    "/join-requests/:id/reveal": { POST: revealJoinRequestNonce },
    "/join-requests/:id/poll": { POST: pollJoinRequest },
    "/conversations/:conversationId/images": { POST: addImage },
    "/conversations/:conversationId/files": { POST: addDroppedFile },
    "/conversations/:conversationId/speech": { POST: dictate },
    "/conversations/:conversationId/reply-summary": { POST: sumUpReply },
    "/conversations/:conversationId/spoken-sentence": { POST: speakSentence },
    "/conversations/:conversationId/images/:imageId": { GET: serveImage },
    "/conversations/:conversationId/events/:seq/images/:index": { GET: serveEventImage },
    "/workspaces/:workspaceId/apps/:app/file": { GET: serveAppFile },
    "/workspaces/:workspaceId/apps/:app/media": { POST: grantAppMedia },
    "/mirador-ca.pem": serveAuthority,
    "/mirador-here": here,
  };
  /** Only this machine's own browser, agents and scripts sign in with these tokens, so they are served on 127.0.0.1 alone. */
  const routesForThisMachine = {
    "/auth": authenticate,
    "/mcp/:conversationId": (request: Bun.BunRequest<"/mcp/:conversationId">) => serveMcp(request, request.params.conversationId),
    "/sessions/:sessionId/messages": { POST: receiveScriptMessage },
    "/sessions/:sessionId/job-waits": { POST: receiveJobWait },
    "/devices": { GET: listDevicesForCommandLine },
  };

  function sendSnapshot(socket: BrowserSocket) {
    if (!claudeProgram.found) void lookUpClaudeProgram(store.claudeProgramSetting());
    hub.send(socket, {
      type: "snapshot",
      workspaces: store.listWorkspaces(),
      workspaceGroups: store.listWorkspaceGroups(),
      conversations: conversations.list(),
      profiles: store.listProfiles().map((profile) => profileFor(socket, profile)),
      promptTemplates: store.listPromptTemplates(),
      canvasUse: store.canvasUse(),
      claudeProgram,
      scriptProgram: store.scriptProgramSetting(),
      avatar: store.avatarSetting(),
      installedAgents: installedHarnesses(store.claudeProgramSetting()),
      canvasAssetsOrigin: socket.data.canvasAssetsOrigin,
      agentsCanvasAssetsOrigin: config.canvasAssetsOrigin,
      machines: store.listMachines(),
      machineStatuses: watch.statuses(),
      homeDir: homedir(),
      hostRunId,
      hostCodeChanged: restart.codeChanged,
      desktopAppOutdated: desktopApp.outdated,
      version: MIRADOR_VERSION,
      newerVersion: newerVersion.current,
      pluginUpdates: pluginUpdates.current ?? [],
      installedApps: apps.installed(),
      openApps: apps.openApps(),
      canvasViews: canvasPlugins.viewPaths(),
      pluginToolTitles: canvasPlugins.toolTitles(),
      pluginSettings: pluginSettings.all(),
    });
    hub.send(socket, { type: "join-requests.listed", joinRequests: joinRequests.waiting() });
    hub.send(socket, voiceSettingsFor(socket));
    hub.send(socket, { type: "voice.engine", engine: voiceEngine.status() });
  }

  /** Every page's list of devices shows who is connected now, and when the others were last seen. */
  function deviceCameOrLeft(deviceId: string) {
    devices.seen(deviceId);
    sendDevicesToEveryPage();
  }

  /** For `mirador devices`, which signs in with the host's own token, as this machine's browser does. */
  function listDevicesForCommandLine(request: Request) {
    return refusedAgentRequest(request, config.browserToken) ?? Response.json({ devices: listedDevices() });
  }

  function upgradeSockets(request: Request, server: Bun.Server<SocketData>) {
    const { pathname } = new URL(request.url);
    if (pathname === "/ws") return upgradeBrowser(request, server, "page");
    if (pathname === "/notifications") return upgradeBrowser(request, server, "notifier");
    return new Response("not found", { status: 404 });
  }

  const websocket: Bun.WebSocketHandler<SocketData> = {
    /** Bun drops what is sent while more than the limit waits to go out (16 MB by default, less than one long history), so the limit is far above that, and a client that falls further behind is disconnected to reconnect and fetch again instead of silently missing messages. */
    backpressureLimit: 1024 * 1024 * 1024,
    closeOnBackpressureLimit: true,
    perMessageDeflate: webSocketCompression,
    open(socket) {
      hub.add(socket);
      if (socket.data.role === "page") sendSnapshot(socket);
      else {
        desktopApp.connected(socket, socket.data.desktopAppCode);
        hub.send(socket, { type: "waiting.counted", ...conversations.waiting() });
        hub.send(socket, { type: "running-turns.counted", count: conversations.runningTurnsCount() });
        if (newerVersion.current && socket.data.deviceId === null) hub.send(socket, { type: "newer-version.found", newerVersion: newerVersion.current });
      }
      if (socket.data.deviceId) deviceCameOrLeft(socket.data.deviceId);
      else if (socket.data.role === "page") hub.send(socket, devicesListed(socket));
    },
    close(socket, code, reason) {
      hub.remove(socket);
      desktopApp.disconnected(socket);
      if (socket.data.deviceId) deviceCameOrLeft(socket.data.deviceId);
      if (code !== 1000 && code !== 1001) console.log(`browser socket closed: ${code} ${reason}`);
    },
    async message(socket, raw) {
      if (socket.data.role === "notifier") return;
      try {
        await dispatch(socket, JSON.parse(String(raw)) as ClientMessage);
      } catch (error) {
        hub.send(socket, { type: "error", message: errorMessage(error) });
      }
    },
  };

  const options = serveOptions({
    hostname: "127.0.0.1",
    port: config.port,
    // An agent's ask waits here for the user's answer, longer than Bun's default timeout lets a request take. The network
    // listener keeps that default, so a device on the network cannot hold its sockets open by going quiet.
    idleTimeout: 0,
    development: config.developmentMode,
    routes: { ...routesForDevices, ...routesForThisMachine },
    fetch: upgradeSockets,
    websocket,
  });
  const networkOptions =
    network && certificate
      ? serveOptions({
          hostname: "0.0.0.0",
          port: network.port,
          tls: { cert: certificate.chain, key: certificate.key },
          development: config.developmentMode,
          routes: routesForDevices,
          fetch: upgradeSockets,
          websocket,
        })
      : null;
  const server = Bun.serve(options);
  const networkServer = networkOptions && Bun.serve(networkOptions);
  /** The page bundle is built once per set of routes, so setting the same routes again rebuilds it from the current source. */
  const rebuildUi = () => {
    server.reload(options);
    if (networkServer && networkOptions) networkServer.reload(networkOptions);
  };
  const stop = () => {
    server.stop(true);
    networkServer?.stop(true);
  };
  return { stop, rebuildUi };
}

/** Types the options where they are written, so they can be passed to both Bun.serve and server.reload. */
function serveOptions<R extends string>(options: Bun.Serve.Options<SocketData, R>) {
  return options;
}
