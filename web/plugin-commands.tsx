import { useEffect, useState } from "react";
import { commandNamedIn, type SlashCommand } from "../shared/slash-commands.ts";
import { connection } from "./connection.ts";
import { replyProblemText } from "./host-error.ts";
import { t } from "./i18n/index.ts";

let commands: SlashCommand[] = [];

connection.onMessage((message) => {
  if (message.type === "snapshot") commands = message.pluginCommands ?? [];
});

/** The plugins' tools the user runs from the slash menu, as the host last said; plugins change only with a restart, which sends a new snapshot. */
export const pluginCommands = () => commands;

async function runPluginCommand(conversationId: string, command: string): Promise<string> {
  const ran = await connection.sendAndAwait(
    (requestId) => ({ type: "canvas.run-command", requestId, conversationId, command }),
    (message, requestId) => (message.type === "canvas.command-ran" && message.requestId === requestId ? message : undefined),
  );
  const problem = replyProblemText(ran);
  if (problem !== null) throw new Error(problem);
  return ran.reply ?? "";
}

type Outcome = { reply: string } | { problem: string };

const REPLY_SHOWN_MS = 6000;

/**
 * Runs a message that names a plugin's command on the host, never sending it to the agent; `run` says whether the
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
    const named = commandNamedIn(message, commands);
    if (!named) {
      setOutcome(null);
      return false;
    }
    const name = named.command.name;
    if (named.withArguments) {
      setOutcome({ problem: t.chat.pluginCommand.takesNoArguments(name) });
      return true;
    }
    setOutcome(null);
    sent();
    runPluginCommand(conversationId, name).then(
      (reply) => setOutcome(reply.trim() ? { reply } : null),
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
