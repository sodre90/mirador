import type { ClientMessage } from "../shared/protocol.ts";
import { connection } from "./connection.ts";

type PageErrorMessage = Extract<ClientMessage, { type: "page.error" }>;

export function pageErrorMessage(error: unknown, componentStack = ""): PageErrorMessage {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = [error instanceof Error ? (error.stack ?? "") : "", componentStack.trim() && `component stack:${componentStack}`].filter(Boolean).join("\n");
  return { type: "page.error", message, stack };
}

/** Each distinct error goes to the host once per page load, so one that repeats on every frame doesn't flood its log. */
export function pageErrorReporter(send: (message: PageErrorMessage) => void) {
  const reported = new Set<string>();
  return (error: unknown, componentStack?: string) => {
    const message = pageErrorMessage(error, componentStack);
    if (reported.has(message.message)) return;
    reported.add(message.message);
    send(message);
  };
}

export const reportPageError = pageErrorReporter((message) => connection.send(message));

export function reportUncaughtPageErrors() {
  window.addEventListener("error", (event) => reportPageError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => reportPageError(event.reason));
}
