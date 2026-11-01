import { notificationBody, type NotificationAbout, type NotificationReason, type SystemNotification } from "../shared/system-notifications.ts";
import type { desktop } from "./i18n/en/desktop.ts";

type Words = Pick<typeof desktop, "untitled" | "notifications">;

function reasonText(reason: NotificationReason, { notifications: words }: Words) {
  switch (reason.kind) {
    case "question":
      return words.asks(reason.question);
    case "permission":
      return words.wantsPermission(reason.tool || words.aTool);
    case "finished":
      return words.finished;
    case "error":
      return words.stoppedWithError(reason.message);
    case "job-ended":
      return reason.message;
  }
}

function translated(notification: SystemNotification, about: NotificationAbout, words: Words): Pick<SystemNotification, "title" | "body"> {
  if (about.kind === "join-request") {
    const { name, fromAddress, tailscaleUser } = about.request;
    return { title: words.notifications.joinRequest(name), body: words.notifications.joinRequestBody(fromAddress, tailscaleUser) };
  }
  return { title: about.untitled ? words.untitled : notification.title, body: notificationBody(reasonText(about.reason, words)) };
}

/** The notification in the language of these words; one from a host that doesn't say what it is about stays in English. */
export const inLanguage = (notification: SystemNotification, words: Words): SystemNotification =>
  notification.about ? { ...notification, ...translated(notification, notification.about, words) } : notification;
