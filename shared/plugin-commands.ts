import type { InstalledApp } from "./apps.ts";
import type { SlashCommand } from "./slash-commands.ts";

/** The command that opens an installed app on a file: /<app>:open <file>. */
export const appOpenCommandName = (app: Pick<InstalledApp, "name">) => `${app.name}:open`;

/** The file what follows /<app>:open names: the rest of the line, an @ from the path menu before it too; empty for none. */
export const fileToOpen = (writtenArguments: string) => writtenArguments.trim().replace(/^@/, "");

/**
 * What the user runs from the slash menu without the agent: each installed app's open, described in the page's words,
 * then the plugins' tools as the host lists them; an app's open wins a tool of the same name.
 */
export function pluginSlashCommands(apps: InstalledApp[], toolCommands: SlashCommand[], words: { openApp: (title: string) => string; fileHint: string }): SlashCommand[] {
  const opening = apps.map((app) => ({ name: appOpenCommandName(app), description: words.openApp(app.title), hint: words.fileHint }));
  return [...opening, ...toolCommands.filter(({ name }) => !opening.some((open) => open.name === name))];
}
