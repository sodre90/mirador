import { waitingRequest } from "./waiting-request.ts";

/** A program the terminal pane opens in a tab of its own: the agent's sign-in, a waited-for job followed, or a command of the agent's own terminal. */
export type ProgramRequest =
  | { type: "terminal.open-login"; conversationId: string }
  | { type: "terminal.follow-job"; conversationId: string; waitId: string }
  | { type: "terminal.open-panel-command"; conversationId: string; line: string };

const programs = waitingRequest<ProgramRequest>();

export const requestProgram = programs.request;
export const takeProgramRequest = programs.take;
export const useProgramRequest = programs.useWaiting;
