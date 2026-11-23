import { useEffect, useState, type FormEvent } from "react";
import { connectedFirst, joinedOn } from "../shared/devices.ts";
import { askToJoin, spacedNumber } from "../shared/join-requests.ts";
import { isRoomInviteLink, joinCodeIn } from "../shared/machines.ts";
import { personGoesBy } from "../shared/people.ts";
import { relativeTimeOf } from "../shared/relative-time.ts";
import type { DeviceConnection, ListedDevice, Person } from "../shared/model.ts";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { setConnectedDevicesInSidebar, useConnectedDevicesInSidebar } from "./connected-devices.ts";
import { connection } from "./connection.ts";
import { inDesktopApp } from "./desktop-bridge.ts";
import { DeviceInviteCard, InviteBeingMade, useDeviceInvite } from "./DeviceInvite.tsx";
import { hints } from "./hints.ts";
import { refusalText } from "./host-error.ts";
import { locale, t } from "./i18n/index.ts";
import type { InviteJoins } from "./invite-link.ts";
import { ConnectionSettings } from "./Reachability.tsx";
import { SettingsSection, useSettingRow } from "./SettingsSection.tsx";
import type { DevicesListed } from "./state.ts";

const words = t.devices;

/** Read before the app first draws: it then replaces the address's #part with the open conversation's. */
const joinCodeInLink = joinCodeIn(location.hash);
const openedFromRoomInvite = isRoomInviteLink(location.hash);

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
      {openedFromRoomInvite ? (
        <p className="join-room-invite">{words.joinMachine.roomInviteHere}</p>
      ) : askedNumber ? (
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
              <>
                <button type="button" className="primary" disabled={joining || !name.trim()} onClick={() => void ask()}>
                  {words.joinMachine.askToJoin}
                </button>
                <p className="hint join-full-control">{words.joinMachine.askToJoinIsFullControl}</p>
              </>
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

export const timeOf = (at: number) => new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

const connectionStatus = ({ pages }: DeviceConnection) => (pages === 0 ? words.list.connectedInBackground : words.list.connectedWithPages(pages));

const deviceStatus = ({ connection, lastSeenAt }: ListedDevice) =>
  connection ? connectionStatus(connection) : words.list.lastSeen(relativeTimeOf(lastSeenAt, locale));

const connectedFrom = ({ fromAddress, tailscaleUser }: DeviceConnection) => words.list.from(tailscaleUser ? `${fromAddress} (${tailscaleUser})` : fromAddress);

function DeviceRow({ device, isThisDevice, whose }: { device: ListedDevice; isThisDevice: boolean; whose: string | null }) {
  return (
    <li className={device.connection ? "connected" : undefined}>
      <span className="device-dot" aria-hidden="true" />
      <span className="device-name">{device.name}</span>
      {isThisDevice && <span className="device-this">{words.list.thisDevice}</span>}
      {whose && <span className="device-person">{whose}</span>}
      <span className="device-seen">
        {deviceStatus(device)}
        {device.connection && ` · ${connectedFrom(device.connection)}`}
        {words.list.joined(joinedOn(device.joinedAt, locale))}
      </span>
      <ConfirmButton
        className="device-revoke"
        label={words.list.revokeLabel(device.name)}
        armedText={words.list.revokeArmed}
        armedHint={hints.revokeDeviceArmed}
        onConfirm={() => connection.send({ type: "device.revoke", deviceId: device.id })}
      >
        {words.list.revoke}
      </ConfirmButton>
    </li>
  );
}

/** The devices that joined this machine, a person's other than the owner's saying whose, which reach only that person's rooms. */
export function DeviceSettings({ listed, people, ownerId }: { listed: DevicesListed | null; people: Person[]; ownerId: string | null }) {
  const { open, making, make, hide } = useDeviceInvite(listed);
  const [joins, setJoins] = useState<InviteJoins>("phone");
  const [changingAddress, setChangingAddress] = useState(false);
  const shownInSidebar = useConnectedDevicesInSidebar();
  const row = useSettingRow();
  const whose = ({ personId }: ListedDevice) =>
    personId === ownerId ? null : words.list.personsDevice(personGoesBy(people.find(({ id }) => id === personId), t.rooms.nameless));

  return (
    <>
      <SettingsSection
        title={words.list.title}
        hint={words.list.intro}
        foundAlsoBy={[words.invite.button, hints.inviteDevice]}
        heading={
          <div className="devices-heading">
            <h3>{words.list.title}</h3>
            <button type="button" className="primary" disabled={!listed || making} onClick={() => void make()} data-hint={hints.inviteDevice}>
              {words.invite.button}
            </button>
          </div>
        }
      >
        {listed && open && (
          <DeviceInviteCard
            key={open.invite.code}
            open={open}
            listed={listed}
            ownerId={ownerId}
            joins={joins}
            onJoins={setJoins}
            onAnother={() => void make()}
            onChooseAddress={() => setChangingAddress(true)}
            onHide={hide}
          />
        )}
        {making && !open && <InviteBeingMade />}
        <ul className="settings-rows device-list" aria-label={words.list.title}>
          {listed && connectedFirst(listed.devices).map((device) => <DeviceRow key={device.id} device={device} isThisDevice={device.id === listed.thisDeviceId} whose={whose(device)} />)}
          {listed?.devices.length === 0 && <li className="device-none">{words.list.none}</li>}
        </ul>
        <label className="connected-devices-switch" {...row(words.list.showInSidebar, hints.connectedDevicesInSidebar)}>
          <input type="checkbox" checked={shownInSidebar} onChange={(event) => setConnectedDevicesInSidebar(event.target.checked)} />
          {words.list.showInSidebar}
        </label>
      </SettingsSection>
      {listed && <ConnectionSettings listed={listed} changingAddress={changingAddress} onChangeAddress={setChangingAddress} />}
    </>
  );
}
