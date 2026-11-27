import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { REACH_ROUTES, reachSetByEnvironment, routeAfterRestart, type ReachRoute } from "../shared/reachability.ts";
import { ROOM_INVITE_CONNECTS, type RoomInviteConnect } from "../shared/machines.ts";
import type { PublicAddress, ReachabilitySettings } from "../shared/model.ts";
import type { PeerToPeerStatus, ServerMessage } from "../shared/protocol.ts";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { describedText } from "./host-error.ts";
import { t } from "./i18n/index.ts";
import { ControlRow, SettingRow } from "./RoomSection.tsx";
import { saveSetting } from "./saved-setting.ts";
import { SettingsSection } from "./SettingsSection.tsx";
import { useSentChoice } from "./sent-choice.ts";
import type { DevicesListed } from "./state.ts";

const words = t.devices;

/**
 * The two settings are one choice, so they are saved together: the address first, as it is the one that can be wrong.
 * A proxy on another machine reaches the host through its network listener, so that route keeps both.
 */
export async function saveRoute(route: ReachRoute, address: PublicAddress | null, proxyElsewhere = false) {
  const problem = await saveSetting((requestId) => ({ type: "settings.set-public-address", requestId, address: route === "address" ? address : null }));
  if (problem) return problem;
  return await saveSetting((requestId) => ({ type: "settings.set-network", requestId, on: route === "network" || (route === "address" && address !== null && proxyElsewhere) }));
}

/** Says why peer to peer can't work, when it is on; null while it works or isn't needed yet. */
export function peerToPeerProblem(status: PeerToPeerStatus | null) {
  if (status === "broker-unreachable") return words.invite.peerToPeerUnreachable;
  if (status === "sidecar-unavailable") return words.invite.peerToPeerUnavailable;
  return null;
}

export function RestartHostButton() {
  return (
    <button type="button" data-hint={hints.restartHost} onClick={() => connection.send({ type: "host.restart" })}>
      {words.reach.restartHost}
    </button>
  );
}

export function EnvironmentSetsReach() {
  return (
    <p className="hint">
      {words.reach.lockedBefore}
      <code>MIRADOR_PUBLIC_ORIGIN</code>, <code>MIRADOR_PUBLIC_CANVAS_ORIGIN</code> {words.reach.or} <code>MIRADOR_NETWORK</code>
      {words.reach.lockedAfter}
    </p>
  );
}

function PeerToPeerRow({ status }: { status: PeerToPeerStatus | null }) {
  const problem = peerToPeerProblem(status);
  const about = status === null ? t.rooms.peerToPeerOff : words.reach.peerToPeerAbout;
  return (
    <SettingRow title={words.reach.peerToPeer} about={<span className={problem ? "peer-to-peer-problem" : "hint"}>{problem ?? about}</span>}>
      <span className="peer-to-peer-status" data-status={status ?? "off"}>
        {words.reach.peerToPeerStatus[status ?? "off"]}
      </span>
    </SettingRow>
  );
}

const hostOf = ({ origin }: PublicAddress) => new URL(origin).host;

/** The host's own certificate, which devices trust for good once they install the authority it is from. */
function OwnCertificate({ port }: { port: number }) {
  return (
    <span className="hint">
      {words.reach.certificateBefore} <code>{port}</code>
      {words.reach.certificateMiddle}
      <a href="/mirador-ca.pem">{words.reach.certificateAuthority}</a>
      {words.reach.certificateAfter}
    </span>
  );
}

function AddressRow({ settings, peerToPeerOn, onChange }: { settings: ReachabilitySettings; peerToPeerOn: boolean; onChange: () => void }) {
  const { publicAddress, network, networkPort, authorityFingerprint } = settings;
  const noAddressAbout = peerToPeerOn ? words.reach.noAddressAbout : words.reach.noneReaches;
  const locked = reachSetByEnvironment(settings);
  return (
    <SettingRow
      title={publicAddress ? words.reach.at(hostOf(publicAddress)) : words.reach.routes.none}
      about={
        <>
          <span className="hint">{publicAddress ? words.reach.addressAbout : noAddressAbout}</span>
          {network && authorityFingerprint && <OwnCertificate port={networkPort} />}
          {locked && <EnvironmentSetsReach />}
        </>
      }
    >
      {!locked && (
        <button type="button" onClick={onChange}>
          {words.reach.change}
        </button>
      )}
    </SettingRow>
  );
}

function RestartRow({ settings }: { settings: ReachabilitySettings }) {
  const route = routeAfterRestart(settings);
  const next = route === "address" && settings.savedPublicAddress ? hostOf(settings.savedPublicAddress) : words.reach.next[route];
  return (
    <li className="restart-needed">
      <span className="room-row-words" role="status">
        {words.reach.afterRestart(next)}
      </span>
      <RestartHostButton />
    </li>
  );
}

/** The way a room invite connects unless its maker picks the other as they make it. */
function RoomInvitesRow({ connect: kept }: { connect: RoomInviteConnect }) {
  const [connect, choose] = useSentChoice(kept, (connect) => connection.send({ type: "settings.set-room-invites-connect", connect }));
  const labels: Record<RoomInviteConnect, string> = { "peer-to-peer": words.roomInvites.peerToPeer, address: words.roomInvites.address };
  return (
    <ControlRow
      title={words.roomInvites.title}
      note={words.roomInvites.about}
      control={(id) => (
        <select id={id} value={connect} onChange={(event) => choose(event.target.value as RoomInviteConnect)}>
          {ROOM_INVITE_CONNECTS.map((each) => (
            <option key={each} value={each}>
              {labels[each]}
            </option>
          ))}
        </select>
      )}
    />
  );
}

/**
 * One way browsers and other computers reach this host. Only the chosen one shows its controls; the others keep theirs
 * hidden, so what was typed there is still there on coming back.
 */
function RouteOption({
  route,
  description,
  hint,
  chosen,
  onChoose,
  children,
}: {
  route: ReachRoute;
  description: ReactNode;
  hint?: string;
  chosen: boolean;
  onChoose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="route-option" data-chosen={chosen} data-hint={hint}>
      <label className="route-choice">
        <input type="radio" name="reach-route" checked={chosen} onChange={onChoose} />
        {words.reach.routes[route]}
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

interface AddressDraft extends PublicAddress {
  proxyElsewhere: boolean;
}

const savedDraft = ({ savedPublicAddress, savedNetwork }: ReachabilitySettings): AddressDraft => ({
  origin: savedPublicAddress?.origin ?? "",
  canvasOrigin: savedPublicAddress?.canvasOrigin ?? "",
  proxyElsewhere: savedPublicAddress !== null && savedNetwork,
});

const sameDraft = (one: AddressDraft, other: AddressDraft) =>
  one.origin.trim() === other.origin.trim() && one.canvasOrigin.trim() === other.canvasOrigin.trim() && one.proxyElsewhere === other.proxyElsewhere;

const isBlank = ({ origin, canvasOrigin }: AddressDraft) => !origin.trim() && !canvasOrigin.trim();

/** Another way to reach the host only shows on being picked; Save applies it, and takes the one before back. */
function AddressEditor({ settings, peerToPeerOn, onClose }: { settings: ReachabilitySettings; peerToPeerOn: boolean; onClose: () => void }) {
  const savedRoute = routeAfterRestart(settings);
  const [route, setRoute] = useState(savedRoute);
  const [draft, setDraft] = useState(() => savedDraft(settings));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editor = useRef<HTMLFormElement>(null);
  useEffect(() => {
    editor.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const save = async (address: AddressDraft) => {
    setSaving(true);
    setProblem(null);
    const refused = await saveRoute(route, { origin: address.origin, canvasOrigin: address.canvasOrigin }, address.proxyElsewhere);
    setSaving(false);
    if (refused) setProblem(refused);
    else onClose();
  };
  const useFound = ({ origin, canvasOrigin }: PublicAddress) => {
    const found = { ...draft, origin, canvasOrigin };
    setDraft(found);
    void save(found);
  };
  const choose = (wanted: ReachRoute) => {
    setRoute(wanted);
    setProblem(null);
  };
  const changed = route !== savedRoute || (route === "address" && !sameDraft(draft, savedDraft(settings)));
  const savable = changed && !(route === "address" && isBlank(draft));

  const descriptions: Record<ReachRoute, ReactNode> = {
    none: peerToPeerOn ? words.reach.noneDescription : words.reach.noneReaches,
    network: (
      <>
        {words.reach.networkBefore} <code>{settings.networkPort}</code>
        {words.reach.networkAfter}
      </>
    ),
    address: words.reach.addressDescription,
  };

  return (
    <li>
      <form
        ref={editor}
        className="address-editor"
        aria-label={words.reach.label}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void save(draft);
        }}
      >
        <p className="hint" data-hint={hints.reachRoute}>
          {words.reach.intro}
        </p>
        <div className="routes" role="radiogroup" aria-label={words.reach.label}>
          {REACH_ROUTES.map((each) => (
            <RouteOption
              key={each}
              route={each}
              description={descriptions[each]}
              hint={each === "network" ? hints.networkReachability : undefined}
              chosen={route === each}
              onChoose={() => choose(each)}
            >
              {each === "address" && <AddressFields settings={settings} draft={draft} onEdit={setDraft} onUseFound={useFound} onProblem={setProblem} />}
            </RouteOption>
          ))}
        </div>
        {problem && <p className="setting-problem">{problem}</p>}
        <div className="address-editor-actions">
          <button type="submit" className="primary" disabled={saving || !savable}>
            {words.reach.save}
          </button>
          <button type="button" onClick={onClose}>
            {words.reach.cancel}
          </button>
        </div>
      </form>
    </li>
  );
}

function AddressFields({
  settings,
  draft,
  onEdit,
  onUseFound,
  onProblem,
}: {
  settings: ReachabilitySettings;
  draft: AddressDraft;
  onEdit: (draft: AddressDraft) => void;
  onUseFound: (address: PublicAddress) => void;
  onProblem: (problem: string) => void;
}) {
  return (
    <div className="public-address" role="group" aria-label={words.address.formLabel}>
      <p className="hint">
        {draft.proxyElsewhere ? (
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
      <label className="proxy-elsewhere" data-hint={hints.proxyElsewhere}>
        <input type="checkbox" checked={draft.proxyElsewhere} onChange={(event) => onEdit({ ...draft, proxyElsewhere: event.target.checked })} />
        {words.address.proxyElsewhere}
      </label>
      <AddressFinder onUse={onUseFound} onProblem={onProblem} />
      <div className="address-fields">
        <label data-hint={hints.address}>
          {words.address.address}
          <input
            value={draft.origin}
            onChange={(event) => onEdit({ ...draft, origin: event.target.value })}
            placeholder="https://box.example.ts.net"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label data-hint={hints.canvasAddress}>
          {words.address.canvasAddress}
          <input
            value={draft.canvasOrigin}
            onChange={(event) => onEdit({ ...draft, canvasOrigin: event.target.value })}
            placeholder="https://box.example.ts.net:8443"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>
    </div>
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

/** How other devices reach this Mirador: peer to peer, and at the address it has, with what Change… opens in its place. */
export function ConnectionSettings({
  listed: { reachability, peerToPeer, roomInvitesConnect },
  changingAddress,
  onChangeAddress,
}: {
  listed: DevicesListed;
  changingAddress: boolean;
  onChangeAddress: (changing: boolean) => void;
}) {
  const peerToPeerOn = peerToPeer !== null;
  return (
    <SettingsSection
      className="connection-settings"
      aria-label={words.reach.title}
      title={words.reach.title}
      foundAlsoBy={[words.reach.peerToPeer, words.reach.peerToPeerAbout, words.reach.addressAbout, words.roomInvites.title, words.roomInvites.about]}
    >
      <ul className="settings-rows">
        <PeerToPeerRow status={peerToPeer} />
        {changingAddress ? (
          <AddressEditor settings={reachability} peerToPeerOn={peerToPeerOn} onClose={() => onChangeAddress(false)} />
        ) : (
          <AddressRow settings={reachability} peerToPeerOn={peerToPeerOn} onChange={() => onChangeAddress(true)} />
        )}
        {reachability.restartNeeded && <RestartRow settings={reachability} />}
        <RoomInvitesRow connect={roomInvitesConnect} />
      </ul>
    </SettingsSection>
  );
}
