import { statuslineChipLevels, type StatuslineChip } from "../../shared/canvas-plugins.ts";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isCost = (value: unknown): value is NonNullable<StatuslineChip["cost"]> =>
  isObject(value) && typeof value.amount === "number" && Number.isFinite(value.amount) && typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency);

function chipOf(value: unknown): StatuslineChip | null {
  if (!isObject(value) || typeof value.text !== "string" || !value.text.trim()) return null;
  const { text, hint, level, stale, cost, opensWindow } = value;
  return {
    text,
    ...(typeof hint === "string" && hint && { hint }),
    ...(statuslineChipLevels.includes(level as never) && { level: level as StatuslineChip["level"] }),
    ...(stale === true && { stale: true }),
    ...(isCost(cost) && { cost: { amount: cost.amount, currency: cost.currency } }),
    ...(opensWindow === true && { opensWindow: true as const }),
    ...(isObject(opensWindow) && "action" in opensWindow && { opensWindow: { action: opensWindow.action } }),
  };
}

/** The chips a plugin's statusline hook gave that Mirador can draw, with only what it draws of them; a chip without text is left out. */
export function validStatuslineChips(given: unknown): StatuslineChip[] {
  if (!Array.isArray(given)) throw new Error("statusline() must return an array of chips, each with its text.");
  return given.flatMap((each) => chipOf(each) ?? []);
}
