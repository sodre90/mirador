import type { RoomAlert } from "../shared/room-reading.ts";
import { notificationBody, type NotificationAbout, type NotificationReason, type SystemNotification } from "../shared/system-notifications.ts";
import type { desktop } from "./i18n/en/desktop.ts";
import { errorText, type ProblemWords } from "./problem-text.ts";

/** The words of a language a notification needs, from the page's dictionaries or the desktop app's. */
export interface NotificationWords {
  desktop: Pick<typeof desktop, "untitled" | "notifications">;
  problems: ProblemWords;
}

function reasonText(reason: NotificationReason, { desktop: { notifications: words }, problems }: NotificationWords) {
  switch (reason.kind) {
    case "question":
      return words.asks(reason.question);
    case "permission":
      return words.wantsPermission(reason.tool || words.aTool);
    case "finished":
      return words.finished;
    case "error":
      return words.stoppedWithError(errorText(reason, problems));
    case "job-ended":
      return reason.message;
    case "reminder":
      return reason.note ? words.reminderWithNote(reason.note) : words.reminder;
  }
}

function roomAlertText(alert: RoomAlert, { desktop: { notifications: words } }: NotificationWords) {
  switch (alert.about) {
    case "mention":
      return words.tagged(alert.by, alert.text);
    case "confirm":
      return words.waitsToConfirm(alert.question);
    case "knock":
      return alert.by ? words.waitsToBeLetIn(alert.by) : words.someoneWaitsToBeLetIn;
  }
}

function translated(notification: SystemNotification, about: NotificationAbout, words: NotificationWords): Pick<SystemNotification, "title" | "body"> {
  if (about.kind === "join-request") {
    const { name, fromAddress, tailscaleUser } = about.request;
    return { title: words.desktop.notifications.joinRequest(name), body: words.desktop.notifications.joinRequestBody(fromAddress, tailscaleUser) };
  }
  if (about.kind === "room") return { title: notification.title, body: notificationBody(roomAlertText(about.alert, words)) };
  return { title: about.untitled ? words.desktop.untitled : notification.title, body: notificationBody(reasonText(about.reason, words)) };
}

/** The notification in the language of these words; one from a host that doesn't say what it is about stays in English. */
export const inLanguage = (notification: SystemNotification, words: NotificationWords): SystemNotification =>
  notification.about ? { ...notification, ...translated(notification, notification.about, words) } : notification;
