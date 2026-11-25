import { useState } from "react";
import { t } from "./i18n/index.ts";

/** Copies the text, and says in its label whether it did. */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [outcome, setOutcome] = useState<"copied" | "failed" | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setOutcome("copied");
    } catch {
      setOutcome("failed");
    }
  };
  const shown = outcome === "copied" ? t.chat.entry.copied : outcome === "failed" ? t.chat.entry.copyFailed : label;
  return (
    <button type="button" className={className} onClick={() => void copy()}>
      {shown}
    </button>
  );
}
