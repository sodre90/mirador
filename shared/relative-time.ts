/** "5 minutes ago", "yesterday": minutes within the hour, hours within two days, days after that. */
export function relativeTimeOf(at: number, locale?: string) {
  const relativeTime = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minutes = Math.round((at - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  if (Math.abs(minutes) < 48 * 60) return relativeTime.format(Math.round(minutes / 60), "hour");
  return relativeTime.format(Math.round(minutes / (24 * 60)), "day");
}
