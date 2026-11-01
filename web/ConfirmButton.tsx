import { useEffect, useRef, useState, type ReactNode } from "react";
import { useClosesWhileFocused } from "./desktop-close.ts";

const DISARM_AFTER_MS = 4_000;

type ArmedBy = "click" | "request";

/**
 * A destructive button that asks again in place: the first click arms it, a second click within a few
 * seconds acts. Used instead of confirm(), which the desktop app's web view does not reliably show.
 * While it asks with the focus, ⌘W in the desktop app stays with it rather than closing the window.
 */
export function ConfirmButton({
  className,
  label,
  hint,
  armedText,
  armedHint,
  onConfirm,
  armRequest,
  confirmsOnCloseKey = false,
  onArmedChange,
  children,
}: {
  className: string;
  label: string;
  hint?: string;
  armedText: string;
  armedHint: string;
  onConfirm: () => void;
  /**
   * Each new request arms it and gives it the focus, so Enter confirms, e.g. after ⌘W met a terminal running a command.
   * Esc, or waiting, gives the focus back.
   */
  armRequest?: object | null;
  /** ⌘W raised the request, so ⌘W again confirms it, as a second click does. */
  confirmsOnCloseKey?: boolean;
  onArmedChange?: (armed: boolean) => void;
  children: ReactNode;
}) {
  const [armedBy, setArmedByState] = useState<ArmedBy | null>(null);
  const armed = armedBy !== null;
  const setArmedBy = (next: ArmedBy | null) => {
    setArmedByState(next);
    onArmedChange?.(next !== null);
  };
  const button = useRef<HTMLButtonElement>(null);
  const focusBeforeRequest = useRef<HTMLElement | null>(null);
  const hasFocus = () => document.activeElement === button.current;

  const confirm = () => {
    setArmedBy(null);
    onConfirm();
  };
  const cancel = () => {
    const givesFocusBack = armedBy === "request" && hasFocus();
    setArmedBy(null);
    if (givesFocusBack && focusBeforeRequest.current?.isConnected) focusBeforeRequest.current.focus();
  };

  useEffect(() => {
    if (!armRequest) return;
    if (!hasFocus()) focusBeforeRequest.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setArmedBy("request");
    button.current?.focus();
  }, [armRequest]);

  useEffect(() => {
    if (!armed) return;
    const disarm = setTimeout(cancel, DISARM_AFTER_MS);
    return () => clearTimeout(disarm);
  }, [armedBy]);

  useClosesWhileFocused(() => {
    if (!armed || !hasFocus()) return false;
    if (armedBy === "request" && confirmsOnCloseKey) confirm();
    return true;
  });

  return (
    <button
      ref={button}
      type="button"
      className={armed ? `${className} armed` : className}
      aria-label={armed ? `Confirm: ${label}` : label}
      data-hint={armed ? armedHint : hint}
      onClick={(event) => {
        event.stopPropagation();
        if (armed) confirm();
        else setArmedBy("click");
      }}
      onBlur={() => setArmedBy(null)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !armed) return;
        event.preventDefault();
        cancel();
      }}
    >
      {armed ? armedText : children}
    </button>
  );
}
