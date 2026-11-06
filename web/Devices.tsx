import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { joinedOn } from "../shared/devices.ts";
import { askToJoin, spacedNumber } from "../shared/join-requests.ts";
import { inviteLink, joinCodeIn } from "../shared/machines.ts";
import { relativeTimeOf } from "../shared/relative-time.ts";
import { tunnelOrigin } from "../shared/tunnel.ts";
import type { DeviceConnection, ListedDevice, PublicAddress, ReachabilitySettings } from "../shared/model.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { setConnectedDevicesInSidebar, useConnectedDevicesInSidebar } from "./connected-devices.ts";
import { connection } from "./connection.ts";
import { inDesktopApp } from "./desktop-bridge.ts";
import { hints } from "./hints.ts";
import { describedText, refusalText } from "./host-error.ts";
import { locale, t } from "./i18n/index.ts";
import { QrCode } from "./QrCode.tsx";
import { saveSetting } from "./saved-setting.ts";
import type { DevicesListed } from "./state.ts";

const words = t.devices;

/** Read before the app first draws: it then replaces the address's #part with the open conversation's. */
const joinCodeInLink = joinCodeIn(location.hash);

function browserName(userAgent: string) {
  if (inDesktopApp()) return words.guessedName.desktopApp;
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/Firefox\/|FxiOS/.test(userAgent)) return "Firefox";
  if (/Chrome\/|CriOS/.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return words.guessedName.browser;
}

function systemName(userAgent: string) {
  if (/iPhone|iPad/.test(userAgent)) return "iOS";
  if (/Android/.test(userAgent)) return "Android";
  if (/Mac OS X/.test(userAgent)) return "macOS";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Linux/.test(userAgent)) return "Linux";
  return null;
}

function guessedDeviceName() {
  const system = systemName(navigator.userAgent);
  return system ? words.guessedName.browserOn(browserName(navigator.userAgent), system) : browserName(navigator.userAgent);
}

const isThisMachine = () => ["127.0.0.1", "localhost"].includes(location.hostname);
/** In the rail of another computer's Mirador, which joins its machines itself. */
const shownInAnotherMirador = () => window.self !== window.top;

const postToThisMachine = (path: string, body: object) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);

/** Shown instead of the app until this browser has signed in, with the host's own link or by joining with an invite code. */
export function JoinMachine() {
  const [code, setCode] = useState(joinCodeInLink ?? "");
  const [name, setName] = useState(guessedDeviceName);
  const [problem, setProblem] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [askedNumber, setAskedNumber] = useState<string | null>(null);

  const ask = async () => {
    setJoining(true);
    setProblem(null);
    try {
      await askToJoin(postToThisMachine, { name, authorityFingerprint: null, machineName: location.hostname }, setAskedNumber);
      location.replace("/");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setAskedNumber(null);
      setJoining(false);
    }
  };

  const join = async (codeToUse: string) => {
    setJoining(true);
    const response = await fetch("/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: codeToUse, name }),
    }).catch(() => null);
    if (response?.ok) return location.replace("/");
    setProblem(response ? await refusalText(response, String(response.status)) : words.joinMachine.noAnswer);
    setJoining(false);
  };

  const joinWithLink = (linkCode: string | null) => {
    if (!linkCode) return;
    setCode(linkCode);
    void join(linkCode);
  };
  useEffect(() => {
    joinWithLink(joinCodeInLink);
  }, []);
  useEffect(() => {
    const joinWithPastedLink = () => joinWithLink(joinCodeIn(location.hash));
    window.addEventListener("hashchange", joinWithPastedLink);
    return () => window.removeEventListener("hashchange", joinWithPastedLink);
  });

  return (
    <div className="gate join-machine">
      <h1>{words.joinMachine.title}</h1>
      {askedNumber ? (
        <div className="join-asked" role="status" aria-label={words.joinMachine.waitingForApproval}>
          <p>
            {words.joinMachine.waitingOn} <strong>{location.hostname}</strong>
            {words.joinMachine.typeNumberThere}
          </p>
          <p className="join-number">{spacedNumber(askedNumber)}</p>
          <p className="hint">
            {words.joinMachine.requestShowsBefore} <code>mirador approve</code>
            {words.joinMachine.requestShowsAfter}
          </p>
        </div>
      ) : (
        <>
          <p>
            {words.joinMachine.introBefore} <strong>{location.host}</strong>
            {words.joinMachine.introMiddle} <code>mirador invite</code>
            {words.joinMachine.introAfter}
          </p>
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void join(code);
            }}
          >
            <label>
              {words.joinMachine.name}
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            {!shownInAnotherMirador() && (
              <button type="button" className="primary" disabled={joining || !name.trim()} onClick={() => void ask()}>
                {words.joinMachine.askToJoin}
              </button>
            )}
            <label>
              {words.joinMachine.inviteCode}
              <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="ABCD-EFGH-JKLM" autoFocus autoComplete="off" spellCheck={false} />
            </label>
            <button type="submit" className="primary" disabled={joining || !code.trim()}>
              {joining ? words.joinMachine.joining : words.joinMachine.join}
            </button>
          </form>
        </>
      )}
      {problem && <p className="join-problem">{problem}</p>}
      {isThisMachine() && (
        <p className="hint">
          {words.joinMachine.signInLinkBefore} <code>mirador sign-in</code>
          {words.joinMachine.signInLinkAfter}
        </p>
      )}
    </div>
  );
}

type Invite = Extract<ServerMessage, { type: "devices.invited" }>;

const timeOf = (at: number) => new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
/** How other devices reach this host: at an address a proxy gives it, over the network itself, or nowhere. */
type ReachRoute = "address" | "network" | "none";

const routeOf = (settings: ReachabilitySettings): ReachRoute => {
  if (settings.publicAddressSetByEnvironment || settings.savedPublicAddress) return "address";
  const listening = settings.networkSetByEnvironment ? settings.network : settings.savedNetwork;
  return listening ? "network" : "none";
};

/**
 * The two settings are one choice, so they are saved together: the address first, as it is the one that can be wrong.
 * A proxy on another machine reaches the host through its network listener, so that route keeps both.
 */
async function saveRoute(route: ReachRoute, address: PublicAddress | null, proxyElsewhere = false) {
  const problem = await saveSetting((requestId) => ({ type: "settings.set-public-address", requestId, address: route === "address" ? address : null }));
  if (problem) return problem;
  return await saveSetting((requestId) => ({ type: "settings.set-network", requestId, on: route === "network" || (route === "address" && address !== null && proxyElsewhere) }));
}

/**
 * One way other devices reach this host. Only the chosen one shows its controls, so no setting looks like it applies
 * when it does not; the others keep theirs hidden, so what was typed there is still there on coming back.
 */
function RouteOption({
  title,
  description,
  hint,
  chosen,
  locked,
  onChoose,
  children,
}: {
  title: string;
  description: ReactNode;
  hint?: string;
  chosen: boolean;
  locked: boolean;
  onChoose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="route-card" data-chosen={chosen} data-hint={hint}>
      <label className="route-choice">
        <input type="radio" name="reach-route" checked={chosen} disabled={locked} onChange={onChoose} />
        {title}
      </label>
      <p className="hint">{description}</p>
      {children && (
        <div className="route-controls" hidden={!chosen}>
          {children}
        </div>
      )}
    </div>
  );
}

function AddressRoute({
  settings,
  onSave,
  onProblem,
}: {
  settings: ReachabilitySettings;
  onSave: (address: PublicAddress | null, proxyElsewhere: boolean) => void;
  onProblem: (problem: string) => void;
}) {
  const { publicAddress, savedPublicAddress, publicAddressSetByEnvironment: setByEnvironment } = settings;
  const shown = setByEnvironment ? publicAddress : savedPublicAddress;
  const savedProxyElsewhere = savedPublicAddress !== null && settings.savedNetwork;
  const [origin, setOrigin] = useState(shown?.origin ?? "");
  const [canvasOrigin, setCanvasOrigin] = useState(shown?.canvasOrigin ?? "");
  const [proxyElsewhere, setProxyElsewhere] = useState(savedProxyElsewhere);
  useEffect(() => {
    setOrigin(shown?.origin ?? "");
    setCanvasOrigin(shown?.canvasOrigin ?? "");
  }, [shown?.origin, shown?.canvasOrigin]);
  useEffect(() => setProxyElsewhere(savedProxyElsewhere), [savedProxyElsewhere]);

  const edited = origin.trim() !== (shown?.origin ?? "") || canvasOrigin.trim() !== (shown?.canvasOrigin ?? "") || proxyElsewhere !== savedProxyElsewhere;
  const save = (event: FormEvent) => {
    event.preventDefault();
    onSave(origin.trim() || canvasOrigin.trim() ? { origin, canvasOrigin } : null, proxyElsewhere);
  };
  const useFound = (address: PublicAddress) => {
    setOrigin(address.origin);
    setCanvasOrigin(address.canvasOrigin);
    onSave(address, proxyElsewhere);
  };

  return (
    <form className="public-address" aria-label={words.address.formLabel} onSubmit={save}>
      <p className="hint">
        {setByEnvironment ? (
          <>
            {words.address.setByEnvironmentBefore}
            <code>MIRADOR_PUBLIC_ORIGIN</code> {words.address.and} <code>MIRADOR_PUBLIC_CANVAS_ORIGIN</code>
            {words.address.setByEnvironmentAfter}
          </>
        ) : proxyElsewhere ? (
          <>
            {words.address.proxyElsewhereBefore} <code>{settings.networkPort}</code>
            {words.address.proxyElsewhereMiddle} <code>{settings.networkCanvasPort}</code>
            {words.address.proxyElsewhereAfter}
          </>
        ) : (
          <>
            {words.address.ownPortBefore} <code>{settings.port}</code>
            {words.address.ownPortMiddle} <code>{settings.canvasAssetsPort}</code>
            {words.address.ownPortAfter}
          </>
        )}
      </p>
      {!setByEnvironment && (
        <label className="proxy-elsewhere" data-hint={hints.proxyElsewhere}>
          <input type="checkbox" checked={proxyElsewhere} onChange={(event) => setProxyElsewhere(event.target.checked)} />
          {words.address.proxyElsewhere}
        </label>
      )}
      {!setByEnvironment && <AddressFinder onUse={useFound} onProblem={onProblem} />}
      <div className="address-fields">
        <label data-hint={hints.address}>
          {words.address.address}
          <input
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
            placeholder="https://box.example.ts.net"
            disabled={setByEnvironment}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label data-hint={hints.canvasAddress}>
          {words.address.canvasAddress}
          <input
            value={canvasOrigin}
            onChange={(event) => setCanvasOrigin(event.target.value)}
            placeholder="https://box.example.ts.net:8443"
            disabled={setByEnvironment}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" disabled={setByEnvironment || !edited}>
          {words.address.save}
        </button>
      </div>
    </form>
  );
}

type AddressSearch = Extract<ServerMessage, { type: "address.found" }>;

/** Finds the address other devices reach this host at, so the two fields need no proxy knowledge typed by hand. */
function AddressFinder({ onUse, onProblem }: { onUse: (address: PublicAddress) => void; onProblem: (problem: string) => void }) {
  const [looking, setLooking] = useState<"find" | "serve" | null>(null);
  const [search, setSearch] = useState<AddressSearch | null>(null);

  const look = async (serving: boolean) => {
    setLooking(serving ? "serve" : "find");
    try {
      const found = await connection.sendAndAwait(
        (requestId) => ({ type: serving ? "address.serve" : "address.find", requestId }),
        (message, requestId) => (message.type === "address.found" && message.requestId === requestId ? message : undefined),
      );
      setSearch(found);
      if (found.problem) onProblem(describedText(found.problem, found.problemAbout));
    } catch (error) {
      onProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setLooking(null);
    }
  };

  return (
    <div className="address-finder">
      <button type="button" data-hint={hints.findAddress} disabled={looking !== null} onClick={() => void look(false)}>
        {looking === "find" ? words.address.looking : words.address.find}
      </button>
      {search && <AddressOutcome search={search} looking={looking} onServe={() => void look(true)} onUse={onUse} />}
    </div>
  );
}

function AddressOutcome({
  search,
  looking,
  onServe,
  onUse,
}: {
  search: AddressSearch;
  looking: "find" | "serve" | null;
  onServe: () => void;
  onUse: (address: PublicAddress) => void;
}) {
  if (search.addresses.length > 0) {
    return (
      <ul className="addresses-found" aria-label={words.address.found}>
        {search.addresses.map((address) => (
          <li key={address.origin}>
            <span>
              <code>{address.origin}</code> {words.address.and} <code>{address.canvasOrigin}</code>{" "}
              <span className="address-how">{address.how === "tailnet" ? words.address.foundTailnet : words.address.foundUsed}</span>
            </span>
            <button type="button" onClick={() => onUse(address)}>
              {words.address.useThese}
            </button>
          </li>
        ))}
      </ul>
    );
  }
  if (search.tailscale === "present") {
    return (
      <p className="hint">
        {words.address.nothingYetWithTailscale}
        <button type="button" data-hint={hints.exposeOnTailscale} disabled={looking !== null} onClick={onServe}>
          {looking === "serve" ? words.address.exposing : words.address.expose}
        </button>
      </p>
    );
  }
  return (
    <p className="hint">
      {words.address.nothingAnswered}
    </p>
  );
}

function ReachabilitySettingsSection({ settings }: { settings: ReachabilitySettings }) {
  const savedChoice = routeOf(settings);
  const locked = settings.publicAddressSetByEnvironment || settings.networkSetByEnvironment;
  const [route, setRoute] = useState(savedChoice);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setRoute(savedChoice), [savedChoice]);

  /** Picking a way only brings out what it needs, so looking at one loses nothing; its button applies it. */
  const reveal = (wanted: ReachRoute) => {
    setRoute(wanted);
    setProblem(null);
  };

  const apply = (wanted: ReachRoute, address: PublicAddress | null = null, proxyElsewhere = false) => {
    setRoute(wanted);
    setProblem(null);
    void saveRoute(wanted, address, proxyElsewhere).then(setProblem);
  };

  const proxyGivesTheAddress = settings.savedPublicAddress !== null || settings.publicAddressSetByEnvironment;

  const useThis = (wanted: ReachRoute) =>
    savedChoice !== wanted && (
      <button type="button" onClick={() => apply(wanted)}>
        {words.reach.useThis}
      </button>
    );

  return (
    <section className="reachability" aria-label={words.reach.label}>
      <h3>{words.reach.title}</h3>
      <p className="hint" data-hint={hints.reachRoute}>
        {words.reach.intro}
      </p>
      <div className="routes" role="radiogroup" aria-label={words.reach.label}>
        <RouteOption
          title={words.reach.noneTitle}
          chosen={route === "none"}
          locked={locked}
          onChoose={() => reveal("none")}
          description={words.reach.noneDescription}
        >
          {useThis("none")}
        </RouteOption>
        <RouteOption
          title={words.reach.addressTitle}
          chosen={route === "address"}
          locked={locked}
          onChoose={() => reveal("address")}
          description={words.reach.addressDescription}
        >
          <AddressRoute settings={settings} onSave={(address, proxyElsewhere) => apply("address", address, proxyElsewhere)} onProblem={setProblem} />
        </RouteOption>
        <RouteOption
          title={words.reach.networkTitle}
          hint={hints.networkReachability}
          chosen={route === "network"}
          locked={locked}
          onChoose={() => reveal("network")}
          description={
            <>
              {words.reach.networkBefore} <code>{settings.networkPort}</code>
              {words.reach.networkMiddle}
              {settings.network && settings.publicAddress && !proxyGivesTheAddress ? words.reach.networkAt(settings.publicAddress.origin) : ""}
              {words.reach.networkAfter}
              {settings.network && settings.authorityFingerprint ? (
                <>
                  {words.reach.trustBefore}
                  <a href="/mirador-ca.pem">{words.reach.certificateAuthority}</a>
                </>
              ) : null}
              .
            </>
          }
        >
          {useThis("network")}
        </RouteOption>
      </div>
      {locked && (
        <p className="hint">
          {words.reach.lockedBefore}
          <code>MIRADOR_PUBLIC_ORIGIN</code>, <code>MIRADOR_PUBLIC_CANVAS_ORIGIN</code> {words.reach.or} <code>MIRADOR_NETWORK</code>
          {words.reach.lockedAfter}
        </p>
      )}
      {problem && <p className="setting-problem">{problem}</p>}
      {settings.restartNeeded && (
        <p className="restart-needed">
          {words.reach.saved}
          <RestartHostButton />
        </p>
      )}
    </section>
  );
}

function InviteLink({ link, appOnly }: { link: string; appOnly: boolean }) {
  return (
    <>
      <QrCode text={link} label={words.invite.qrLabel} />
      {appOnly ? (
        <div>
          {words.invite.scanWithApp}
          <details className="invite-link-details">
            <summary>{words.invite.showLink}</summary>
            {words.invite.appOnly} <code className="invite-link">{link}</code>
          </details>
        </div>
      ) : (
        <span>
          {words.invite.scanOrOpenBefore} <code className="invite-link">{link}</code>
          {words.invite.scanOrOpenAfter}
        </span>
      )}
    </>
  );
}

type InviteRoute = "address" | "tunnel";

const joinsThroughTunnel = (invite: Invite, route: InviteRoute, publicOrigin: string | null) => Boolean(invite.tunnel) && (route === "tunnel" || !publicOrigin);

/** The link an invite opens: at the address other devices reach this Mirador at, or into its tunnel, which only the Mirador app can join through. */
function inviteLinkThrough(invite: Invite, route: InviteRoute, publicOrigin: string | null, authorityFingerprint: string | null) {
  if (invite.tunnel && joinsThroughTunnel(invite, route, publicOrigin)) return inviteLink(tunnelOrigin(invite.tunnel), invite.code, null, invite.tunnel);
  return publicOrigin && inviteLink(publicOrigin, invite.code, authorityFingerprint);
}

function InviteRouteChoice({ address, route, onChange }: { address: string; route: InviteRoute; onChange: (route: InviteRoute) => void }) {
  return (
    <div className="invite-routes" role="radiogroup" aria-label={words.invite.routeLabel} data-hint={hints.inviteRoute}>
      <label>
        <input type="radio" name="invite-route" checked={route === "tunnel"} onChange={() => onChange("tunnel")} />
        {words.invite.peerToPeer}
      </label>
      <label>
        <input type="radio" name="invite-route" checked={route === "address"} onChange={() => onChange("address")} />
        {words.invite.atHost(new URL(address).host)}
      </label>
    </div>
  );
}

function InviteRouteHint({ throughTunnel, address }: { throughTunnel: boolean; address: string | null }) {
  if (throughTunnel)
    return (
      <span className="hint invite-route-hint">
        {words.invite.throughTunnel}
      </span>
    );
  return (
    address && (
      <span className="hint invite-route-hint">
        {words.invite.atAddress(new URL(address).host)}
      </span>
    )
  );
}

function RestartHostButton() {
  return (
    <button type="button" data-hint={hints.restartHost} onClick={() => connection.send({ type: "host.restart" })}>
      {words.reach.restartHost}
    </button>
  );
}

/** An invite with no link can't reach another device, so it says so plainly and offers the shortest way to fix it. */
function InviteWithoutLink({ settings }: { settings: ReachabilitySettings }) {
  const [problem, setProblem] = useState<string | null>(null);
  const reachesNowhere = routeOf(settings) === "none" && !settings.publicAddressSetByEnvironment && !settings.networkSetByEnvironment;
  const useThisNetwork = () => {
    setProblem(null);
    void saveRoute("network", null).then(setProblem);
  };
  return (
    <div className="warning invite-without-link" role="alert">
      <strong>{words.invite.unreachableTitle}</strong>
      {settings.restartNeeded ? (
        <>
          <p>{words.invite.restartToReach}</p>
          <RestartHostButton />
        </>
      ) : (
        <>
          <p>{reachesNowhere ? words.invite.unreachable : words.invite.withoutLink}</p>
          {reachesNowhere && (
            <button type="button" data-hint={hints.useThisNetwork} onClick={useThisNetwork}>
              {words.invite.useThisNetwork}
            </button>
          )}
        </>
      )}
      {problem && <p className="setting-problem">{problem}</p>}
    </div>
  );
}

const connectionStatus = ({ pages }: DeviceConnection) => (pages === 0 ? words.list.connectedInBackground : words.list.connectedWithPages(pages));

const deviceStatus = ({ connection, lastSeenAt }: ListedDevice) =>
  connection ? connectionStatus(connection) : words.list.lastSeen(relativeTimeOf(lastSeenAt, locale));

const connectedFrom = ({ fromAddress, tailscaleUser }: DeviceConnection) => words.list.from(tailscaleUser ? `${fromAddress} (${tailscaleUser})` : fromAddress);

export function DeviceSettings({ listed }: { listed: DevicesListed | null }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [inviteRoute, setInviteRoute] = useState<InviteRoute>("tunnel");
  const shownInSidebar = useConnectedDevicesInSidebar();

  const createInvite = async () => {
    try {
      const invited = await connection.sendAndAwait(
        (requestId) => ({ type: "devices.invite", requestId }),
        (message, requestId) => (message.type === "devices.invited" && message.requestId === requestId ? message : undefined),
      );
      setInvite(invited);
    } catch {
      // Disconnected or failed; nothing to set
    }
  };

  const publicOrigin = listed?.reachability.publicAddress?.origin ?? null;
  const link = invite && inviteLinkThrough(invite, inviteRoute, publicOrigin, listed?.reachability.authorityFingerprint ?? null);
  return (
    <>
      <h3>{words.list.title}</h3>
      <p className="hint">
        {words.list.intro}
      </p>
      <label className="connected-devices-switch" data-hint={hints.connectedDevicesInSidebar}>
        <input type="checkbox" checked={shownInSidebar} onChange={(event) => setConnectedDevicesInSidebar(event.target.checked)} />
        {words.list.showInSidebar}
      </label>
      <ul className="device-list" aria-label={words.list.title}>
        {listed?.devices.map((device) => (
          <li key={device.id} className={device.connection ? "connected" : undefined}>
            <span className="device-dot" aria-hidden="true" />
            <span className="device-name">{device.name}</span>
            {device.id === listed.thisDeviceId && <span className="device-this">{words.list.thisDevice}</span>}
            <span className="device-seen">
              {deviceStatus(device)}
              {device.connection && ` · ${connectedFrom(device.connection)}`}
              {words.list.joined(joinedOn(device.joinedAt, locale))}
            </span>
            <ConfirmButton
              className="danger"
              label={words.list.revokeLabel(device.name)}
              armedText={words.list.revokeArmed}
              armedHint={hints.revokeDeviceArmed}
              onConfirm={() => connection.send({ type: "device.revoke", deviceId: device.id })}
            >
              {words.list.revoke}
            </ConfirmButton>
          </li>
        ))}
        {listed?.devices.length === 0 && <li className="device-none">{words.list.none}</li>}
      </ul>
      <div className="device-invite">
        <button type="button" onClick={createInvite} data-hint={hints.inviteDevice}>
          {words.invite.button}
        </button>
        {invite && (
          <div className="invite" aria-label={words.invite.label}>
            <span>
              {words.invite.code} <code className="invite-code">{invite.code}</code>
              {words.invite.worksUntil(timeOf(invite.expiresAt))}
            </span>
            {publicOrigin && invite.tunnel && <InviteRouteChoice address={publicOrigin} route={inviteRoute} onChange={setInviteRoute} />}
            {invite.tunnel && <InviteRouteHint throughTunnel={joinsThroughTunnel(invite, inviteRoute, publicOrigin)} address={publicOrigin} />}
            {link ? (
              <InviteLink link={link} appOnly={joinsThroughTunnel(invite, inviteRoute, publicOrigin)} />
            ) : (
              listed && <InviteWithoutLink settings={listed.reachability} />
            )}
          </div>
        )}
      </div>
      {listed && <ReachabilitySettingsSection settings={listed.reachability} />}
    </>
  );
}
