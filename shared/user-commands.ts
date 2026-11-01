import type { CommandStream, ConversationEvent, StoredEvent } from "./model.ts";

/** A command the user ran with `!` in the message box, and whether its output has gone to the agent yet. */
export interface UserCommand {
  commandId: string;
  command: string;
  chunks: { stream: CommandStream; text: string }[];
  ended: boolean;
  /** null when it was stopped, or ended without an exit code. */
  exitCode: number | null;
  delivery: "pending" | "sent" | "dropped";
}

const AGENT_HEAD_CHARACTERS = 10_000;
const AGENT_TAIL_CHARACTERS = 20_000;

/** The events `UserCommandLog` folds; it ignores any other. */
export const USER_COMMAND_EVENT_TYPES = [
  "user-command",
  "user-command-output",
  "user-command-ended",
  "user-command-dropped",
  "user-message",
  "steered-messages-returned",
] as const satisfies readonly ConversationEvent["type"][];

/** Folds the command events of a conversation into its commands, in the order they were run. */
export class UserCommandLog {
  private readonly commands = new Map<string, UserCommand>();

  apply(event: ConversationEvent) {
    switch (event.type) {
      case "user-command":
        this.commands.set(event.commandId, { commandId: event.commandId, command: event.command, chunks: [], ended: false, exitCode: null, delivery: "pending" });
        return;
      case "user-command-output":
        this.commands.get(event.commandId)?.chunks.push({ stream: event.stream, text: event.text });
        return;
      case "user-command-ended": {
        const command = this.commands.get(event.commandId);
        if (command) Object.assign(command, { ended: true, exitCode: event.exitCode });
        return;
      }
      case "user-command-dropped":
        return this.mark(event.commandIds, "dropped");
      case "user-message":
        return this.mark(event.attachedCommandIds ?? [], "sent");
      case "steered-messages-returned":
        return this.mark(event.commandIds ?? [], "pending");
    }
  }

  get(commandId: string) {
    return this.commands.get(commandId);
  }

  get all() {
    return [...this.commands.values()];
  }

  private mark(commandIds: string[], delivery: UserCommand["delivery"]) {
    commandIds.forEach((commandId) => {
      const command = this.commands.get(commandId);
      if (command) command.delivery = delivery;
    });
  }
}

export function userCommandsIn(events: StoredEvent[]): UserCommand[] {
  const log = new UserCommandLog();
  events.forEach(({ event }) => log.apply(event));
  return log.all;
}

/** Finished commands whose output goes with the next message; a command still running waits for the message after it ends. */
export const awaitingDelivery = (commands: UserCommand[]) => commands.filter(({ ended, delivery }) => ended && delivery === "pending");

export const outputOf = ({ chunks }: UserCommand, stream?: CommandStream) =>
  chunks
    .filter((chunk) => !stream || chunk.stream === stream)
    .map(({ text }) => text)
    .join("");

function shortenedForAgent(text: string) {
  const cut = text.length - AGENT_HEAD_CHARACTERS - AGENT_TAIL_CHARACTERS;
  if (cut <= 0) return text;
  return `${text.slice(0, AGENT_HEAD_CHARACTERS)}\n… ${cut} characters cut …\n${text.slice(-AGENT_TAIL_CHARACTERS)}`;
}

/** The commands as Claude Code itself hands `!` commands to its model, ahead of the user's message. */
export function withCommandOutputs(commands: UserCommand[], message: string) {
  if (commands.length === 0) return message;
  const context = commands.map(
    (command) =>
      `<bash-input>${command.command}</bash-input>\n` +
      `<bash-stdout>${shortenedForAgent(outputOf(command, "stdout"))}</bash-stdout>` +
      `<bash-stderr>${shortenedForAgent(outputOf(command, "stderr"))}</bash-stderr>`,
  );
  return `${context.join("\n\n")}\n\n${message}`;
}
