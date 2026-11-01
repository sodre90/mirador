import { useState } from "react";
import { locale, t } from "./i18n/index.ts";

const STORAGE_KEY = "mirador-timestamps";

export function storedTimestampsShown(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "shown";
  } catch {
    return false;
  }
}

/** The stylesheet shows every line's time when set, and otherwise only the time of the line under the pointer. */
export function applyTimestampsShown(shown: boolean) {
  document.documentElement.dataset.timestamps = shown ? "shown" : "on-hover";
}

export function useTimestampsShown() {
  const [shown, setShown] = useState(storedTimestampsShown);
  const choose = (next: boolean) => {
    applyTimestampsShown(next);
    setShown(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "shown" : "on-hover");
    } catch {}
  };
  return [shown, choose] as const;
}

const clockTime = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fullTime = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "medium" });

export const formatClockTime = (at: number) => clockTime.format(at);

export function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return t.chat.duration.seconds(seconds);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t.chat.duration.minutes(minutes);
  return t.chat.duration.hours(Math.floor(minutes / 60), minutes % 60);
}
export const formatFullTime = (at: number) => fullTime.format(at);
