import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { basename } from "node:path";
import { APP_MEDIA_PATH, type AppMediaGrant } from "../../shared/apps.ts";

interface Grant {
  key: string;
  file: string;
}

/**
 * Addresses on the canvas assets that stream one file each, for an app's view, whose sandboxed page has no network of
 * its own. Anyone holding one can read that file, so it is unguessable and ends when the app closes.
 */
export class AppMediaGrants {
  private readonly grants = new Map<string, Grant>();

  /** The same file keeps its address while the app stays open; its version changes when the file is written again, as after a render. */
  grant(key: string, file: string): AppMediaGrant {
    const token = [...this.grants].find(([, grant]) => grant.key === key && grant.file === file)?.[0] ?? this.granted({ key, file });
    return { path: `${APP_MEDIA_PATH}${token}/${encodeURIComponent(basename(file))}?v=${Math.round(statSync(file).mtimeMs)}` };
  }

  /** The file a path on the canvas assets streams, or null when no open app was granted it. */
  fileAt(pathname: string): string | null {
    if (!pathname.startsWith(APP_MEDIA_PATH)) return null;
    const token = pathname.slice(APP_MEDIA_PATH.length).split("/")[0]!;
    return this.grants.get(token)?.file ?? null;
  }

  revoke(key: string) {
    for (const [token, grant] of this.grants) if (grant.key === key) this.grants.delete(token);
  }

  private granted(grant: Grant) {
    const token = randomBytes(24).toString("base64url");
    this.grants.set(token, grant);
    return token;
  }
}
