import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { offerRuns, offerSource, type PluginOffer } from "../../shared/apps.ts";
import { englishProblem, type HostProblem } from "../../shared/host-problems.ts";
import type { PluginToInstall, SettingsFile, SettingsImportReport, SettingsItem, SettingsItemKind, SettingsPlan } from "../../shared/settings-file.ts";
import type { HostConfig } from "../config.ts";
import { Store } from "../store.ts";
import { exportedSettings, pluginsOnDisk, settingsFileText } from "./export-settings.ts";

/** A problem the command ends on, for the user to read. */
export class SettingsCommandFailed extends Error {}

/** Reads the database and the plugins folder directly, so it works with Mirador stopped too. */
export async function exportSettings(config: HostConfig, options: { out: string | undefined; includeSecrets: boolean }) {
  const store = new Store(config.databasePath);
  const file = exportedSettings(store, await pluginsOnDisk(join(config.dataDir, "plugins")), options);
  store.close();
  if (options.out === undefined) process.stdout.write(settingsFileText(file));
  else writeForThisUserAlone(options.out, settingsFileText(file));
  const written = options.out === undefined ? "" : `${summaryOf(file)} written to ${options.out}.\n`;
  process.stderr.write(`${written}${whatItHolds(file, options.includeSecrets).join("\n")}\n`);
}

function writeForThisUserAlone(path: string, text: string) {
  if (existsSync(path)) chmodSync(path, 0o600);
  writeFileSync(path, text, { mode: 0o600 });
}

const counted = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function summaryOf({ profiles = [], promptTemplates = [], workspaces = [], plugins = [] }: SettingsFile) {
  const workspaceCount = workspaces.reduce((sum, entry) => sum + ("group" in entry ? entry.workspaces.length : 1), 0);
  return [counted(profiles.length, "profile"), counted(promptTemplates.length, "prompt template"), counted(workspaceCount, "workspace"), counted(plugins.length, "plugin")].join(", ");
}

const whatItHolds = ({ profiles = [] }: SettingsFile, includeSecrets: boolean) => [
  includeSecrets
    ? "It holds your secrets: every value of the profiles' environments, plugins' secret settings and voice API keys. Keep it safe."
    : "The values of the profiles' environments, plugins' secret settings and voice API keys are left out; --include-secrets puts them in.",
  ...(profiles.some(({ prelaunch }) => prelaunch?.trim()) ? ["Pre-launch commands are in it as written, with any secret typed into them."] : []),
];

type Ask = (question: string) => string | null;

/** Leaves the saving to the running Mirador, which checks it as it checks Settings and shows it on every page. */
export class SettingsImportCommand {
  constructor(
    private readonly config: HostConfig,
    private readonly ask: Ask,
  ) {}

  async run(path: string, options: { overwrite: boolean; dryRun: boolean }) {
    const text = fileText(path);
    const plan = await this.post<SettingsPlan>("/settings-import/plan", text);
    printProblems(plan.problems);
    const newItems = plan.items.filter(({ state }) => state === "new");
    const differing = plan.items.filter(({ state }) => state === "different");
    if (options.dryRun) return printPlan(newItems, differing, plan);
    const overwritten = options.overwrite ? differing : this.chosenToOverwrite(differing);
    const chosen = [...newItems, ...overwritten];
    if (chosen.length > 0) {
      const items = chosen.map(({ id }) => id);
      const report = await this.post<SettingsImportReport>("/settings-import", JSON.stringify({ text, items }));
      printReport(report, plan);
    } else console.log(plan.items.length === 0 ? "The file has nothing to bring in." : "Nothing to bring in.");
    for (const plugin of plan.plugins) await this.offer(plugin);
  }

  private chosenToOverwrite(differing: SettingsItem[]): SettingsItem[] {
    let answerToAll = false;
    return differing.filter((item) => {
      if (answerToAll) return true;
      const answer = (this.ask(`Overwrite ${describedWithChanges(item)} here with the file's? [y]es, [N]o, [a]ll:`) ?? "").trim().toLowerCase();
      answerToAll = answer === "a" || answer === "all";
      return answerToAll || answer === "y" || answer === "yes";
    });
  }

  private agrees = (question: string) => ["y", "yes"].includes((this.ask(question) ?? "").trim().toLowerCase());

  /** Cloned only once the user says so, and nothing of it runs until they have seen what it runs. */
  private async offer({ name, repository, branch, commit }: PluginToInstall) {
    if (!this.agrees(`Plugin ${name} isn't installed here. Fetch it from ${repository} to see what it runs? [y/N]:`)) return console.log(`Plugin ${name} was left out.`);
    try {
      const offer = await this.post<PluginOffer>("/settings-import/plugins", JSON.stringify({ repository, branch }));
      console.log([`${offer.title} ${offer.version}`, offerSource(offer), ...offerRuns(offer)].join("\n  "));
      if (commit && !offer.commit.startsWith(commit)) console.log(`  The exported one was at commit ${commit}, so this is not the same code.`);
      if (!this.agrees(`Install plugin ${name}? [y/N]:`)) {
        await this.post(`/settings-import/plugins/${offer.id}`, "", "DELETE");
        return console.log(`Plugin ${name} was left out.`);
      }
      await this.post(`/settings-import/plugins/${offer.id}`, "");
      console.log(`Plugin ${name} is installed. It starts with Mirador's next start.`);
    } catch (error) {
      if (!(error instanceof SettingsCommandFailed)) throw error;
      console.log(`Plugin ${name} could not be installed: ${error.message}`);
    }
  }

  private async post<Answer>(path: string, body: string, method = "POST"): Promise<Answer> {
    const { appOrigin, browserToken } = this.config;
    const response = await fetch(`${appOrigin}${path}`, { method, body, headers: { Authorization: `Bearer ${browserToken}` } }).catch(() => null);
    if (!response) throw new SettingsCommandFailed(`Mirador is not running at ${appOrigin}. Start it, then import again.`);
    if (!response.ok) throw new SettingsCommandFailed(response.status === 404 ? `Mirador at ${appOrigin} is older than this command. Restart it, then import again.` : await response.text());
    return (await response.json()) as Answer;
  }
}

function fileText(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new SettingsCommandFailed((error as Error).message);
  }
}

const kindNames: Record<SettingsItemKind, string> = {
  profile: "profile",
  "prompt-template": "prompt template",
  group: "group",
  workspace: "workspace",
  "sidebar-order": "the sidebar's order",
  preference: "preference",
  "plugin-settings": "the settings of plugin",
};

const described = ({ kind, name }: SettingsItem) => [kindNames[kind], ...(name ? [name] : [])].join(" ");
const describedWithChanges = (item: SettingsItem) => (item.differs.length > 0 ? `${described(item)} (${item.differs.join(", ")})` : described(item));

function printItems(heading: string, items: string[]) {
  if (items.length > 0) console.log([`${heading}:`, ...items].join("\n  "));
}

const printProblems = (problems: HostProblem[]) => problems.forEach((problem) => console.log(englishProblem(problem)));

const printNeeds = (items: SettingsItem[]) =>
  printItems(
    "Values the file leaves out, for you to fill in",
    items.filter(({ needs }) => needs.length > 0).map((item) => `${described(item)}: ${item.needs.join(", ")}`),
  );

function printPlan(newItems: SettingsItem[], differing: SettingsItem[], { items, plugins }: SettingsPlan) {
  printItems("New here", newItems.map(described));
  printItems("Different here", differing.map(describedWithChanges));
  printItems("Plugins to install", plugins.map(({ name, repository }) => `${name} from ${repository}`));
  printNeeds([...newItems, ...differing]);
  const same = items.length - newItems.length - differing.length;
  if (same > 0) console.log(`${same} already as in the file.`);
}

function printReport({ added, overwritten, problems }: SettingsImportReport, plan: SettingsPlan) {
  printItems("Added", added.map(described));
  printItems("Overwritten", overwritten.map(describedWithChanges));
  const broughtIn = new Set([...added, ...overwritten].map(({ id }) => id));
  printItems("Kept as here", plan.items.filter(({ id, state }) => state === "different" && !broughtIn.has(id)).map(describedWithChanges));
  printNeeds([...added, ...overwritten]);
  const seen = new Set(plan.problems.map(englishProblem));
  printProblems(problems.filter((problem) => !seen.has(englishProblem(problem))));
}
