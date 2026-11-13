import { useEffect, useState } from "react";
import type { InstalledApp } from "../shared/apps.ts";
import { appOpenCommandName, fileToOpen, pluginSlashCommands } from "../shared/plugin-commands.ts";
import { commandNamedIn, type PluginCommand } from "../shared/slash-commands.ts";
import { connection } from "./connection.ts";
import { replyProblemText } from "./host-error.ts";
import { t } from "./i18n/index.ts";

let toolCommands: PluginCommand[] = [];
let installedApps: InstalledApp[] = [];

connection.onMessage((message) => {
  if (message.type === "snapshot") {
    toolCommands = message.pluginCommands ?? [];
    installedApps = message.installedApps;
  }
  if (message.type === "plugins.views") installedApps = message.installedApps;
});

/**
 * What the user runs from the slash menu without the agent, as the host last said, but those of plugins `pluginsOff`
 * names; plugins change only with a restart, which sends a new snapshot.
 */
export const pluginCommands = (pluginsOff: string[] = []) =>
  pluginSlashCommands(
    installedApps,
    toolCommands.filter(({ plugin }) => !pluginsOff.includes(plugin)),
    t.chat.pluginCommand,
  );

/** The commands followed by a path, for the path menu to suggest one without an @. */
export const pathCommands = () => installedApps.map(appOpenCommandName);

async function runPluginCommand(conversationId: string, command: string, writtenArguments: string): Promise<string> {
  const ran = await connection.sendAndAwait(
    (requestId) => ({ type: "canvas.run-command", requestId, conversationId, command, arguments: writtenArguments }),
    (message, requestId) => (message.type === "canvas.command-ran" && message.requestId === requestId ? message : undefined),
  );
  const problem = replyProblemText(ran);
  if (problem !== null) throw new Error(problem);
  return ran.reply ?? "";
}

async function openApp(conversationId: string, app: string, file: string): Promise<string> {
  const opened = await connection.sendAndAwait(
    (requestId) => ({ type: "app.open-file", requestId, conversationId, app, file }),
    (message, requestId) => (message.type === "app.file-opened" && message.requestId === requestId ? message : undefined),
  );
  const problem = replyProblemText(opened);
  if (problem !== null) throw new Error(problem);
  return "";
}

/** What the command does on the host, resolving to what it says; an app's open takes the rest of the line as the file, an @ before it too. */
function commandRun(conversationId: string, command: string, writtenArguments: string): Promise<string> {
  const app = installedApps.find((installed) => appOpenCommandName(installed) === command);
  if (!app) return runPluginCommand(conversationId, command, writtenArguments);
  const file = fileToOpen(writtenArguments);
  return file ? openApp(conversationId, app.name, file) : Promise.reject(new Error(t.chat.pluginCommand.needsFile(command)));
}

type Outcome = { reply: string } | { problem: string };

const REPLY_SHOWN_MS = 6000;

/**
 * Runs a message that names a plugin's command or an app's open on the host, never sending it to the agent; `run` says whether the
 * message was one. What the command's tool says shows above the composer for a few seconds, and why it failed until
 * dismissed; either goes when the next message is sent.
 */
export function usePluginCommands(conversationId: string) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    if (!outcome || !("reply" in outcome)) return;
    const hide = setTimeout(() => setOutcome(null), REPLY_SHOWN_MS);
    return () => clearTimeout(hide);
  }, [outcome]);

  const run = (message: string, sent: () => void) => {
    const named = commandNamedIn(message, pluginCommands());
    if (!named) {
      setOutcome(null);
      return false;
    }
    setOutcome(null);
    commandRun(conversationId, named.command.name, named.writtenArguments).then(
      (reply) => {
        sent();
        setOutcome(reply.trim() ? { reply } : null);
      },
      (error: unknown) => setOutcome({ problem: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  };

  const shown = outcome && (
    <div className={"reply" in outcome ? "plugin-command-reply" : "composer-problem"} role={"reply" in outcome ? "status" : "alert"}>
      <span>{"reply" in outcome ? outcome.reply : outcome.problem}</span>
      <button type="button" className="link" onClick={() => setOutcome(null)}>
        {t.chat.pluginCommand.dismiss}
      </button>
    </div>
  );
  return { run, shown };
}
