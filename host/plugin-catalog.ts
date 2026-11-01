import { catalogPluginsOf, type CatalogPlugin } from "../shared/apps.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { withoutCredentials, type InstalledPlugins } from "./apps/installed-plugins.ts";
import { messageOf } from "./apps/plugins.ts";
import { MAX_IMAGE_BYTES } from "./images.ts";
import { imageTypeOf } from "./local-images.ts";
import type { PluginInstaller } from "./canvas/service.ts";
import type { Store } from "./store.ts";

const GIVE_UP_AFTER_MILLISECONDS = 20_000;

export interface PluginScreenshotImage {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: string;
}

/** The official plugins, as the catalog lists them; the last one fetched stands while Mirador can't fetch it. */
export class PluginCatalog {
  private plugins: CatalogPlugin[];
  /** Pictures fetched once and kept while the host runs, so the page loads them from the host however it blocks other sites' images. */
  private readonly screenshots = new Map<string, Promise<PluginScreenshotImage | null>>();

  constructor(
    private readonly store: Store,
    private readonly url: string | null,
    private readonly isInstalled: (name: string) => boolean,
  ) {
    this.plugins = catalogPluginsOf(store.pluginCatalog()) ?? [];
  }

  get all(): CatalogPlugin[] {
    return this.plugins;
  }

  /** The ones the user could install: not in the plugins folder yet. */
  notInstalled(): CatalogPlugin[] {
    return this.plugins.filter(({ name }) => !this.isInstalled(name));
  }

  /** Throws why the plugin can't be installed from the catalog. */
  installable(name: string): CatalogPlugin {
    const plugin = this.plugins.find((listed) => listed.name === name);
    if (!plugin) throw new Error(`${name} is not an official plugin; they are ${this.plugins.map((listed) => listed.name).join(", ") || "not known yet"}.`);
    if (this.isInstalled(name)) throw new Error(`${plugin.title} is installed already.`);
    return plugin;
  }

  /** A picture the catalog lists, fetched for the page; null for a URL it doesn't list, or one that isn't an image. */
  screenshot(url: string): Promise<PluginScreenshotImage | null> {
    if (!this.plugins.some(({ screenshots }) => screenshots?.some((listed) => listed.url === url))) return Promise.resolve(null);
    const known = this.screenshots.get(url);
    if (known) return known;
    const fetched = fetchImage(url);
    this.screenshots.set(url, fetched);
    fetched.then((image) => image ?? this.screenshots.delete(url));
    return fetched;
  }

  /** Fetches the catalog; a failure keeps the last one and is only logged. */
  async refresh() {
    if (!this.url) return;
    try {
      const response = await fetch(this.url, { signal: AbortSignal.timeout(GIVE_UP_AFTER_MILLISECONDS) });
      if (!response.ok) throw new Error(`it answered ${response.status}`);
      const catalog: unknown = await response.json();
      const plugins = catalogPluginsOf(catalog);
      if (!plugins) throw new Error("it lists no plugins");
      this.plugins = plugins;
      this.store.savePluginCatalog(catalog);
    } catch (error) {
      console.warn(`the catalog of official plugins at ${this.url} couldn't be fetched: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function fetchImage(url: string): Promise<PluginScreenshotImage | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(GIVE_UP_AFTER_MILLISECONDS) });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mimeType = bytes.length <= MAX_IMAGE_BYTES ? imageTypeOf(bytes.slice(0, 12)) : null;
    return mimeType ? { bytes, mimeType } : null;
  } catch (error) {
    console.warn(`the plugin picture at ${url} couldn't be fetched: ${messageOf(error)}`);
    return null;
  }
}

export const pluginsListed = async (plugins: InstalledPlugins, catalog: PluginCatalog): Promise<ServerMessage> => ({
  type: "plugins.listed",
  folder: plugins.folder,
  plugins: await plugins.list(),
  official: catalog.all,
  restartNeeded: plugins.restartNeeded,
});

/** Offers an official plugin for the user to agree to, then installs the offer they said yes to, or discards it. */
export const officialPluginInstaller = (catalog: PluginCatalog, plugins: InstalledPlugins, listed: (message: ServerMessage) => void): PluginInstaller => ({
  offer: async (name) => {
    const plugin = catalog.installable(name);
    return plugins.offer(plugin.repo, plugin.branch ?? null);
  },
  settle: async (offerId, accepted) => {
    if (!accepted) {
      plugins.discard(offerId);
      return "Nothing was installed.";
    }
    try {
      const { title } = await plugins.install(offerId);
      listed(await pluginsListed(plugins, catalog));
      return `Mirador installed the ${title} plugin and uses it from its next restart. Tell the user to restart Mirador to use it: ⌘⇧R, or Restart host in Plugins.`;
    } catch (error) {
      return `Installing the plugin failed: ${withoutCredentials(messageOf(error))}`;
    }
  },
});
