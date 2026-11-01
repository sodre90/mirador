import { Updater } from "electrobun/main";
import { MIRADOR_VERSION } from "../../../shared/version.ts";
import { SelfUpdate, type UpdateOffer } from "../core/self-update.ts";
import { discardDownload, downloadedArchive, followStatuses, repairInstallRecord, replacedFolder, signedBySameTeam, skippedBuilds, teamIdentifierOf, updateBlockedBy } from "../core/update-checks.ts";

const FAILED_INSTALL = /^Update to .+ failed during /;

export interface UpdateEvents {
  offered: (offer: UpdateOffer | null) => void;
  failedToInstall: (message: string) => void;
}

/**
 * Electrobun's updater, for a build that can update itself: a release build, which knows where its releases are, and on
 * macOS one signed with a Developer ID, as only a downloaded app signed by the same team is let in. Null for any other.
 */
export async function selfUpdateFromReleases(appPath: string | null, events: UpdateEvents): Promise<SelfUpdate | null> {
  if (!appPath || !(await Updater.localInfo.baseUrl())) return null;
  if (process.platform === "darwin" && !(await teamIdentifierOf(appPath))) return null;
  const channelFolder = await Updater.appDataFolder();
  if (process.platform === "darwin") await repairInstallRecord(channelFolder, appPath);
  const selfUpdate = new SelfUpdate(
    {
      currentVersion: MIRADOR_VERSION,
      published: async () => {
        const { updateAvailable, version, hash, error } = await Updater.checkForUpdate();
        if (error) throw new Error(error);
        return updateAvailable ? { version, hash } : null;
      },
      blockedBy: () => updateBlockedBy(replacedFolder(appPath, process.platform), process.platform),
      download: async () => {
        await Updater.downloadUpdate();
        const { updateReady, error } = Updater.updateInfo();
        if (!updateReady) throw new Error(error || "The update did not download.");
      },
      /** Only macOS signs apps, so only there is there a signature to hold the download to; on Linux it rests on HTTPS from the release address. */
      trusted: async ({ hash }) => process.platform !== "darwin" || signedBySameTeam(downloadedArchive(channelFolder, hash), appPath),
      discard: (hash) => discardDownload(channelFolder, hash),
      skipped: skippedBuilds(channelFolder),
      install: () => Updater.applyUpdate(),
    },
    events.offered,
  );
  followStatuses(Updater, ({ status, message, details }) => {
    if (status !== "error" || !FAILED_INSTALL.test(message) || typeof details?.latestHash !== "string") return;
    selfUpdate.failedToInstall(details.latestHash);
    events.failedToInstall(message);
  });
  return selfUpdate;
}
