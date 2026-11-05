import { useState } from "react";
import type { DesktopUpdate } from "../shared/desktop-menu.ts";
import { newerVersionKey, type NewerVersion } from "../shared/newer-version.ts";
import { connection } from "./connection.ts";
import { checkForUpdate, restartToUpdate, useDesktopUpdate } from "./desktop-bridge.ts";
import { hints } from "./hints.ts";
import { describedText } from "./host-error.ts";
import { t } from "./i18n/index.ts";

const DISMISSED_KEY = "mirador-newer-version-dismissed";
const READY_UPDATE_DISMISSED_KEY = "mirador-ready-update-dismissed";

function storedDismissal(storageKey: string) {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function useDismissal(storageKey: string) {
  const [dismissed, setDismissed] = useState(() => storedDismissal(storageKey));
  const dismiss = (key: string) => {
    try {
      localStorage.setItem(storageKey, key);
    } catch {}
    setDismissed(key);
  };
  return [dismissed, dismiss] as const;
}

const words = t.shell.newerVersion;

type ReadyUpdate = Extract<DesktopUpdate, { stage: "ready" }>;

const readyIn = (desktopUpdate: DesktopUpdate | null) => (desktopUpdate?.stage === "ready" ? desktopUpdate : null);

/** The desktop app's update ready to install is the release it was downloaded from, so it takes that sign's place. */
const notReadyYet = (newerVersion: NewerVersion | null, desktopUpdate: DesktopUpdate | null) =>
  readyIn(desktopUpdate) && newerVersion?.kind === "release" ? null : newerVersion;

function newerVersionSentence(newerVersion: NewerVersion, desktopUpdate: DesktopUpdate | null) {
  const blockedBy = newerVersion.kind === "release" && desktopUpdate?.stage === "blocked" ? `: ${desktopUpdate.blockedBy}` : "";
  const label = newerVersion.kind === "release" ? words.releaseOut(newerVersion.version) : words.newCommits(newerVersion.commits, newerVersion.upstream);
  return `${label}${blockedBy}.`;
}

/**
 * The desktop app that updates itself downloads a release, and is only asked to look again; until it has said whether it
 * does, there is nothing to offer. A pulled checkout needs no word about restarting: the host offers that itself.
 */
function NextStep({ newerVersion, desktopUpdate }: { newerVersion: NewerVersion; desktopUpdate: DesktopUpdate | null }) {
  if (newerVersion.kind === "checkout") return <span>{words.pullToUpdate}</span>;
  if (!desktopUpdate) return null;
  if (desktopUpdate.stage === "downloading") return <span>{words.downloading}</span>;
  if (desktopUpdate.stage === "idle")
    return (
      <button type="button" onClick={checkForUpdate}>
        {words.download}
      </button>
    );
  return (
    <a href={newerVersion.url} target="_blank" rel="noreferrer">
      {words.download}
    </a>
  );
}

function RestartToUpdate() {
  return (
    <button type="button" onClick={restartToUpdate}>
      {words.restartToUpdate}
    </button>
  );
}

function ReadyUpdateBanner({ readyUpdate }: { readyUpdate: ReadyUpdate }) {
  const [dismissed, dismiss] = useDismissal(READY_UPDATE_DISMISSED_KEY);
  if (dismissed === readyUpdate.version) return null;
  return (
    <div className="banner newer-version">
      <span title={words.ready(readyUpdate.version)}>{words.ready(readyUpdate.version)}</span>
      <RestartToUpdate />
      <button type="button" data-hint={hints.dismissNewerVersion} onClick={() => dismiss(readyUpdate.version)}>
        {words.dismiss}
      </button>
    </div>
  );
}

function NewerVersionSign({ newerVersion, desktopUpdate }: { newerVersion: NewerVersion; desktopUpdate: DesktopUpdate | null }) {
  const [dismissed, dismiss] = useDismissal(DISMISSED_KEY);
  if (dismissed === newerVersionKey(newerVersion)) return null;
  return (
    <div className="banner newer-version">
      <span title={newerVersionSentence(newerVersion, desktopUpdate)}>{newerVersionSentence(newerVersion, desktopUpdate)}</span>
      <NextStep newerVersion={newerVersion} desktopUpdate={desktopUpdate} />
      <button type="button" data-hint={hints.dismissNewerVersion} onClick={() => dismiss(newerVersionKey(newerVersion))}>
        {words.dismiss}
      </button>
    </div>
  );
}

export function NewerVersionBanner({ newerVersion }: { newerVersion: NewerVersion | null }) {
  const desktopUpdate = useDesktopUpdate();
  const readyUpdate = readyIn(desktopUpdate);
  const outThere = notReadyYet(newerVersion, desktopUpdate);
  return (
    <>
      {readyUpdate && <ReadyUpdateBanner readyUpdate={readyUpdate} />}
      {outThere && <NewerVersionSign newerVersion={outThere} desktopUpdate={desktopUpdate} />}
    </>
  );
}

export function NewerVersionNote({ newerVersion }: { newerVersion: NewerVersion | null }) {
  const desktopUpdate = useDesktopUpdate();
  const readyUpdate = readyIn(desktopUpdate);
  const outThere = notReadyYet(newerVersion, desktopUpdate);
  return (
    <>
      {readyUpdate && (
        <p className="hint newer-version">
          {words.ready(readyUpdate.version)} <RestartToUpdate />
        </p>
      )}
      {outThere && (
        <p className="hint newer-version">
          {newerVersionSentence(outThere, desktopUpdate)} <NextStep newerVersion={outThere} desktopUpdate={desktopUpdate} />
        </p>
      )}
    </>
  );
}

type UpdateCheck = { step: "idle" } | { step: "checking" } | { step: "checked"; failure: string | null };

async function checkForNewerVersion(): Promise<string | null> {
  try {
    const { failure, failureAbout } = await connection.sendAndAwait(
      (requestId) => ({ type: "newer-version.check", requestId }),
      (message, requestId) => (message.type === "newer-version.checked" && message.requestId === requestId ? message : undefined),
    );
    return failure && describedText(failure, failureAbout);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function UpdateCheckOutcome({ check, version, newerVersion }: { check: UpdateCheck; version: string; newerVersion: NewerVersion | null }) {
  if (check.step !== "checked") return null;
  if (check.failure) return <span>{check.failure}.</span>;
  return newerVersion ? null : <span>{words.upToDate(version)}</span>;
}

/** The host looks now; the desktop app that updates itself looks too, and downloads what it finds. What is newer shows in NewerVersionNote. */
export function UpdateCheckButton({ version, newerVersion }: { version: string; newerVersion: NewerVersion | null }) {
  const [check, setCheck] = useState<UpdateCheck>({ step: "idle" });
  const checkNow = async () => {
    setCheck({ step: "checking" });
    checkForUpdate();
    setCheck({ step: "checked", failure: await checkForNewerVersion() });
  };
  return (
    <p className="hint update-check" role="status">
      <button type="button" data-hint={hints.checkForUpdates} disabled={check.step === "checking"} onClick={checkNow}>
        {check.step === "checking" ? words.checking : words.checkForUpdates}
      </button>{" "}
      <UpdateCheckOutcome check={check} version={version} newerVersion={newerVersion} />
    </p>
  );
}
