import { useState } from "react";
import { addressGoesAway, reachSetByEnvironment } from "../shared/reachability.ts";
import { relativeTimeOf } from "../shared/relative-time.ts";
import type { ListedDevice, ReachabilitySettings } from "../shared/model.ts";
import type { PeerToPeerStatus, ServerMessage } from "../shared/protocol.ts";
import { connection } from "./connection.ts";
import { CopyButton } from "./CopyButton.tsx";
import { hints } from "./hints.ts";
import { locale, t } from "./i18n/index.ts";
import { useExpired } from "./invite-expiry.ts";
import { INVITE_JOINS, inviteLinkFor, type InviteJoins } from "./invite-link.ts";
import { QrCode } from "./QrCode.tsx";
import { EnvironmentSetsReach, peerToPeerProblem, RestartHostButton, saveRoute } from "./Reachability.tsx";
import type { DevicesListed } from "./state.ts";

const words = t.devices.invite;

type Invite = Extract<ServerMessage, { type: "devices.invited" }>;

export interface OpenInvite {
  invite: Invite;
  /** The ids of the devices there already, so one that joins while the invite is open stands out. */
  devicesBefore: string[];
}

/** The invite shown, and making one, which can take a while the first time: peer to peer may have to be downloaded. */
export function useDeviceInvite(listed: DevicesListed | null) {
  const [open, setOpen] = useState<OpenInvite | null>(null);
  const [making, setMaking] = useState(false);
  const make = async () => {
    const devicesBefore = listed?.devices.map(({ id }) => id) ?? [];
    setMaking(true);
    try {
      const invite = await connection.sendAndAwait(
        (requestId) => ({ type: "devices.invite", requestId }),
        (message, requestId) => (message.type === "devices.invited" && message.requestId === requestId ? message : undefined),
      );
      setOpen({ invite, devicesBefore });
    } catch {
      // Disconnected; the page says so, and no code was made
    } finally {
      setMaking(false);
    }
  };
  return { open, making, make, hide: () => setOpen(null) };
}

/** The first device to join since the invite was made, remembered even once it is revoked: the invite stays used up. */
function useJoinedSince(devicesBefore: string[], devices: ListedDevice[]) {
  const [joined, setJoined] = useState<string | null>(null);
  const newcomer = devices.find(({ id }) => !devicesBefore.includes(id));
  if (newcomer && joined === null) setJoined(newcomer.name);
  return joined;
}

function JoinsChoice({ joins, onChange }: { joins: InviteJoins; onChange: (joins: InviteJoins) => void }) {
  return (
    <div className="invite-joins" role="radiogroup" aria-label={words.joinsLabel} data-hint={hints.inviteJoins}>
      {INVITE_JOINS.map((each) => (
        <label key={each} data-chosen={joins === each}>
          <input type="radio" name="invite-joins" checked={joins === each} onChange={() => onChange(each)} />
          {words.joins[each]}
        </label>
      ))}
    </div>
  );
}

function FoldedLink({ link, appOnly }: { link: string; appOnly: boolean }) {
  return (
    <details className="invite-link-details">
      <summary>{words.showLink}</summary>
      {appOnly && words.appOnly} <code className="invite-link">{link}</code>
    </details>
  );
}

/** With nowhere to point, an invite says so plainly and offers the shortest way to fix it. */
function InviteWithoutLink({ settings, peerToPeerReaches, onChooseAddress }: { settings: ReachabilitySettings; peerToPeerReaches: boolean; onChooseAddress: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const useThisNetwork = () => {
    setProblem(null);
    void saveRoute("network", null).then(setProblem);
  };
  const fix = () => {
    if (reachSetByEnvironment(settings)) return <EnvironmentSetsReach />;
    if (settings.restartNeeded)
      return (
        <>
          <p>{words.restartToReach}</p>
          <RestartHostButton />
        </>
      );
    return (
      <>
        <p>{peerToPeerReaches ? words.needsAddress : words.unreachable}</p>
        <div className="invite-ways">
          <button type="button" data-hint={hints.useThisNetwork} onClick={useThisNetwork}>
            {words.useThisNetwork}
          </button>
          <button type="button" className="link" onClick={onChooseAddress}>
            {words.anotherWay}
          </button>
        </div>
      </>
    );
  };
  return (
    <div className="warning invite-without-link" role="alert">
      <strong>{peerToPeerReaches ? words.needsAddressTitle : words.unreachableTitle}</strong>
      {fix()}
      {problem && <p className="setting-problem">{problem}</p>}
    </div>
  );
}

function howToJoin(joins: InviteJoins, appOnly: boolean, host: string) {
  if (joins === "computer") return { title: words.pasteInMachines, about: appOnly ? words.computerThroughTunnel : words.computerAtAddress(host) };
  if (joins === "browser") return { title: words.openLink, about: words.browserAtAddress(host) };
  return { title: words.scan, about: appOnly ? words.throughTunnel : words.phoneAtAddress(host) };
}

function WaitingInvite({
  invite,
  settings,
  peerToPeer,
  joins,
  onChooseAddress,
}: {
  invite: Invite;
  settings: ReachabilitySettings;
  peerToPeer: PeerToPeerStatus | null;
  joins: InviteJoins;
  onChooseAddress: () => void;
}) {
  const reached = inviteLinkFor(joins, invite, settings);
  const noPeerToPeer = joins !== "browser" && !invite.tunnel && peerToPeerProblem(peerToPeer);
  const atAddress = reached !== null && !reached.appOnly;
  const { title, about } = howToJoin(joins, reached?.appOnly ?? false, settings.publicAddress ? new URL(settings.publicAddress.origin).host : "");
  return (
    <div className="invite-body">
      {reached && joins !== "computer" && <QrCode text={reached.link} label={words.qrLabel} />}
      <div className="invite-how">
        {reached ? (
          <>
            <strong>{title}</strong>
            <span className="hint">{about}</span>
          </>
        ) : (
          <InviteWithoutLink settings={settings} peerToPeerReaches={invite.tunnel !== null} onChooseAddress={onChooseAddress} />
        )}
        {noPeerToPeer && <p className="warning">{noPeerToPeer}</p>}
        {atAddress && addressGoesAway(settings) && <p className="warning invite-address-goes">{words.addressGoesAway}</p>}
        {reached && joins !== "phone" && <code className="invite-link">{reached.link}</code>}
        {!reached?.appOnly && (
          <span>
            {words.code} <code className="invite-code">{invite.code}</code>
          </span>
        )}
        {reached && (
          <div className="invite-ways">
            <CopyButton key={reached.link} text={reached.link} label={words.copyLink} />
            {joins === "phone" && <FoldedLink {...reached} />}
          </div>
        )}
        <span className="hint invite-waiting" role="status">
          {words.waiting(relativeTimeOf(invite.expiresAt, locale))}
        </span>
      </div>
    </div>
  );
}

/** One invite from its making until its device joined or its code expired. */
export function DeviceInviteCard({
  open: { invite, devicesBefore },
  listed,
  ownerId,
  joins,
  onJoins,
  onAnother,
  onChooseAddress,
  onHide,
}: {
  open: OpenInvite;
  listed: DevicesListed;
  ownerId: string | null;
  joins: InviteJoins;
  onJoins: (joins: InviteJoins) => void;
  onAnother: () => void;
  onChooseAddress: () => void;
  onHide: () => void;
}) {
  const expired = useExpired(invite.expiresAt);
  const joined = useJoinedSince(
    devicesBefore,
    listed.devices.filter(({ personId }) => personId === ownerId),
  );
  if (joined !== null)
    return (
      <section className="invite invite-over joined" aria-label={words.label}>
        <strong role="status">{words.joined(joined)}</strong>
        <button type="button" onClick={onHide}>
          {words.done}
        </button>
      </section>
    );
  if (expired)
    return (
      <section className="invite invite-over" aria-label={words.label}>
        <span role="status">{words.expired}</span>
        <button type="button" onClick={onAnother}>
          {words.another}
        </button>
        <button type="button" onClick={onHide}>
          {words.done}
        </button>
      </section>
    );
  return (
    <section className="invite" aria-label={words.label}>
      <div className="invite-head">
        <JoinsChoice joins={joins} onChange={onJoins} />
        <button type="button" className="icon" title={words.hide} aria-label={words.hide} onClick={onHide}>
          ×
        </button>
      </div>
      <WaitingInvite invite={invite} settings={listed.reachability} peerToPeer={listed.peerToPeer} joins={joins} onChooseAddress={onChooseAddress} />
    </section>
  );
}

export function InviteBeingMade() {
  return (
    <section className="invite" aria-label={words.label}>
      <span className="hint" role="status">
        {words.making}
      </span>
    </section>
  );
}
