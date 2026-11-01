import { bodyWithWorkspace, type SystemNotification } from "../shared/system-notifications.ts";

const OPEN_ACTION = "open";

/** --wait keeps notify-send running until the notification closes, and it then prints the action the user chose. */
export const notifySendArguments = (notification: SystemNotification) => [
  "--app-name=Mirador",
  `--action=${OPEN_ACTION}=Open Mirador`,
  "--wait",
  "--",
  notification.title,
  bodyWithWorkspace(notification),
];

export const choseOpen = (output: string) => output.split("\n").some((line) => line.trim() === OPEN_ACTION);

/**
 * For a machine with no Mirador page or app open on its own screen, such as a server that runs only the host: where
 * notify-send is installed (libnotify), the host shows the notification itself, until `until`. Its Open button opens
 * `signInLink()` in the machine's browser.
 */
export async function showWithNotifySend(notification: SystemNotification, until: number, signInLink: () => string) {
  const notifySend = Bun.which("notify-send");
  if (!notifySend) return;
  const shown = Bun.spawn([notifySend, ...notifySendArguments(notification)], { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: Math.max(1, until - Date.now()) });
  const [output, problem, exitCode] = await Promise.all([new Response(shown.stdout).text(), new Response(shown.stderr).text(), shown.exited]);
  if (exitCode !== 0 && shown.signalCode === null) console.error(`notify-send failed: ${problem.trim()}`);
  const browser = Bun.which("xdg-open");
  if (browser && choseOpen(output)) Bun.spawn([browser, signInLink()], { stdio: ["ignore", "ignore", "ignore"] });
}
