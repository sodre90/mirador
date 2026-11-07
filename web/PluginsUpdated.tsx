import { useState } from "react";
import type { AppliedPluginUpdate } from "../shared/apps.ts";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { replyProblemText } from "./host-error.ts";
import { t } from "./i18n/index.ts";

const DISMISSED_KEY = "mirador-plugins-updated-dismissed";

const words = t.plugins;

function storedDismissal() {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

async function undoUpdate(folder: string): Promise<string | null> {
  try {
    return await connection.sendAndAwait(
      (requestId) => ({ type: "plugins.undo-update", requestId, folder }),
      (message, requestId) => (message.type === "plugins.changed" && message.requestId === requestId ? replyProblemText(message) : undefined),
    );
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function AppliedUpdate({ update }: { update: AppliedPluginUpdate }) {
  const [undone, setUndone] = useState(update.undone === true);
  const [undoing, setUndoing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const undo = async () => {
    setUndoing(true);
    const failed = await undoUpdate(update.folder);
    setUndoing(false);
    setProblem(failed);
    if (!failed) setUndone(true);
  };
  if (update.restoredBecause) return <li>{words.restoredAtStart(update.title, update.to, update.restoredBecause)}</li>;
  if (undone) {
    return (
      <li>
        {words.undoneAtStart(update.title, update.from)}{" "}
        <button type="button" data-hint={hints.restartHost} onClick={() => connection.send({ type: "host.restart" })}>
          {t.shell.app.restartHost}
        </button>
      </li>
    );
  }
  return (
    <li>
      {words.updatedAtStart(update.title, update.from, update.to)}{" "}
      <button type="button" aria-label={words.undoLabel(update.title)} data-hint={hints.undoPluginUpdate} disabled={undoing} onClick={undo}>
        {words.undo}
      </button>
      {problem && <span className="plugin-undo-problem">{problem}</span>}
    </li>
  );
}

/** What the host put in, or took back out, as it started: once per start of the host, until dismissed. */
export function PluginsUpdatedBanner({ hostRunId, updates }: { hostRunId: string | null; updates: AppliedPluginUpdate[] }) {
  const [dismissed, setDismissed] = useState(storedDismissal);
  if (updates.length === 0 || !hostRunId || dismissed === hostRunId) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, hostRunId);
    } catch {}
    setDismissed(hostRunId);
  };
  return (
    <div className="banner plugins-updated" role="status" aria-label={words.updatedAtStartLabel}>
      <ul>
        {updates.map((update) => (
          <AppliedUpdate key={update.folder} update={update} />
        ))}
      </ul>
      <button type="button" onClick={dismiss}>
        {words.dismiss}
      </button>
    </div>
  );
}
