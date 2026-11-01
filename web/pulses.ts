import { useState } from "react";

export type PulseStyle = "smooth" | "stepped" | "off";

const STORAGE_KEY = "mirador-pulses";

export function storedPulsesOn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Linux's WebKitGTK draws every frame of an animation and its window copies each one on the CPU, while macOS and
 * Windows hand an opacity animation to the system compositor. So on Linux the pulses change a few times a cycle.
 */
export function pulseStyleFor(on: boolean, userAgent: string): PulseStyle {
  if (!on) return "off";
  return /Linux/.test(userAgent) && !/Android/.test(userAgent) ? "stepped" : "smooth";
}

/** The stylesheet steps or stops the status pulses by the root element's data-pulses. */
export function applyPulses(on: boolean) {
  document.documentElement.dataset.pulses = pulseStyleFor(on, navigator.userAgent);
}

const PULSE_ANIMATION = "pulse";

const isPulse = (animation: Animation): animation is CSSAnimation =>
  animation instanceof CSSAnimation && animation.animationName === PULSE_ANIMATION;

const pulsesStep = () => document.documentElement.dataset.pulses === ("stepped" satisfies PulseStyle);

/**
 * WebKitGTK paints the changes of every dot that steps at the same moment in one frame, so with all pulses in one
 * phase, many stepped dots cost about what one does. Each stepped pulse counts its cycles from the page's start, not
 * from when its dot appeared.
 */
export function keepPulsesInStep() {
  document.addEventListener("animationstart", ({ animationName }) => {
    if (animationName !== PULSE_ANIMATION || !pulsesStep()) return;
    document
      .getAnimations()
      .filter(isPulse)
      .filter((pulse) => pulse.startTime !== 0)
      .forEach((pulse) => (pulse.startTime = 0));
  });
}

export function usePulsesOn() {
  const [on, setOn] = useState(storedPulsesOn);
  const choose = (next: boolean) => {
    applyPulses(next);
    setOn(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {}
  };
  return [on, choose] as const;
}
