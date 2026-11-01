import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { HarnessId, StoredEvent } from "../shared/model.ts";
import { panelSlashCommands } from "../shared/panel-commands.ts";
import { clearSlashCommand, latestSlashCommands, matchingCommands, slashQuery, type SlashCommand } from "../shared/slash-commands.ts";
import { connection } from "./connection.ts";
import { loginSlashCommand } from "./login-request.ts";
import { SuggestionList, suggestionAttributes, suggestionKey, usePickedSuggestion } from "./SuggestionList.tsx";
import { t } from "./i18n/index.ts";

const LIST_ID = "slash-commands";

/**
 * The commands the agent last listed in this conversation's events; until it has (its session starts with the first
 * message), the host's best guess from other conversations with the same agent. Looked up only once wanted.
 */
function useSlashCommands(conversationId: string, events: StoredEvent[], wanted: boolean) {
  const listed = useMemo(() => (wanted ? latestSlashCommands(events) : null), [wanted, events]);
  const [guessed, setGuessed] = useState<{ conversationId: string; commands: SlashCommand[] } | null>(null);
  const hasGuess = guessed?.conversationId === conversationId;

  useEffect(() => {
    if (!wanted || listed || hasGuess) return;
    const requestId = crypto.randomUUID();
    const unsubscribe = connection.onMessage((message) => {
      if (message.type === "slash-commands.listed" && message.requestId === requestId) setGuessed({ conversationId, commands: message.commands });
    });
    connection.send({ type: "slash-commands.list", requestId, conversationId });
    return unsubscribe;
  }, [wanted, listed, hasGuess, conversationId]);

  return listed ?? (hasGuess ? guessed.commands : []);
}

const inPageLanguage = (command: SlashCommand) => ({ ...command, description: t.chat.slashCommandDescriptions[command.name] ?? command.description });

const miradorCommands = [clearSlashCommand, loginSlashCommand].map(inPageLanguage);

/** The commands Mirador runs itself, so they stand even where the agent does not list them. */
const miradorCommandsFor = (harness: HarnessId) => (harness === "claude" ? [...miradorCommands, ...panelSlashCommands.map(inPageLanguage)] : miradorCommands);

const withMiradorCommands = (commands: SlashCommand[], own: SlashCommand[]) => [
  ...commands.filter(({ name }) => !own.some((same) => same.name === name)),
  ...own,
];

/**
 * Suggests the agent's slash commands while the message is a / and the start of a name, as Claude Code does: ↑/↓
 * pick, Tab writes the command out, Enter runs it (or writes it out to type its arguments after), Esc puts it away.
 */
export function useSlashCommandMenu({
  conversationId,
  harness,
  events,
  text,
  setText,
  run,
}: {
  conversationId: string;
  harness: HarnessId;
  events: StoredEvent[];
  text: string;
  setText: (text: string) => void;
  run: (message: string, event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const query = slashQuery(text);
  const commands = useSlashCommands(conversationId, events, query !== null);
  const matches = useMemo(
    () => (query === null ? [] : matchingCommands(withMiradorCommands(commands, miradorCommandsFor(harness)), query)),
    [commands, harness, query],
  );
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const { pickedIndex, move } = usePickedSuggestion(matches.length, query);
  const open = matches.length > 0 && dismissedAt !== text;

  const writeOut = (command: SlashCommand) => setText(`/${command.name} `);

  /** Handles the key if the menu is open and the key is one of its own; returns whether it did. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const key = open ? suggestionKey(event) : null;
    if (!key) return false;
    const command = matches[pickedIndex]!;
    if (key === "next") move(1);
    else if (key === "previous") move(-1);
    else if (key === "complete") writeOut(command);
    else if (key === "choose") {
      if (command.hint) writeOut(command);
      else run(`/${command.name}`, event);
    } else setDismissedAt(text);
    event.preventDefault();
    return true;
  };

  const menu = open ? (
    <SuggestionList id={LIST_ID} label={t.chat.menus.slashCommands} className="slash-commands" items={matches} keyOf={({ name }) => name} pickedIndex={pickedIndex} onPick={writeOut}>
      {(command) => (
        <>
          <span className="slash-command-name">/{command.name}</span>
          <span className="slash-command-description" title={command.description}>
            {command.description}
          </span>
          {command.hint && <span className="slash-command-hint">{command.hint}</span>}
        </>
      )}
    </SuggestionList>
  ) : null;
  return { onKeyDown, textareaAttributes: suggestionAttributes(LIST_ID, open, pickedIndex), menu };
}
