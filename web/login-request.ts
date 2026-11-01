import type { SlashCommand } from "../shared/slash-commands.ts";
import { requestProgram } from "./program-request.ts";

/** Mirador's own /login, since the agents leave theirs out of the commands they offer over ACP. */
export const loginSlashCommand: SlashCommand = { name: "login", description: "Sign the agent in again, in a terminal tab", hint: null };

export const isLoginCommand = (message: string) => message.trim() === `/${loginSlashCommand.name}`;

export const requestLogin = (conversationId: string) => requestProgram({ type: "terminal.open-login", conversationId });
