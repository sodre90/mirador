import { useSyncExternalStore } from "react";
import { storedChoice } from "./stored-choice.ts";

/**
 * Whether this browser loads images that agents' Markdown links from other sites. Loading one sends its address to that
 * site, and an agent misled by what it read can put what it read into that address.
 */
export const externalImages = storedChoice("mirador-external-images", ["blocked", "shown"] as const, "blocked");

const policyListeners = new Set<() => void>();
let strictImagePolicyInForce = false;

/**
 * The page's own policy lets images come from any site, so they can be shown when asked for. Blocking them adds a
 * stricter policy, which the browser keeps until the page reloads: no policy can be taken back.
 */
export function blockExternalImages() {
  if (strictImagePolicyInForce) return;
  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "img-src 'self' data: blob:";
  document.head.append(policy);
  strictImagePolicyInForce = true;
  policyListeners.forEach((listener) => listener());
}

export type ExternalImages = ReturnType<typeof externalImages.get>;

export function applyExternalImages(choice: ExternalImages) {
  if (choice === "blocked") blockExternalImages();
}

export function setExternalImages(choice: ExternalImages) {
  externalImages.set(choice);
  applyExternalImages(choice);
}

const subscribeToPolicy = (listener: () => void) => {
  policyListeners.add(listener);
  return () => void policyListeners.delete(listener);
};

/** Follows the policy in force rather than the setting: after Settings stops blocking, images stay refused until a reload. */
export const useExternalImagesBlocked = () => useSyncExternalStore(subscribeToPolicy, () => strictImagePolicyInForce);

export function isFromAnotherSite(source: string, pageOrigin: string) {
  try {
    const url = new URL(source, pageOrigin);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin !== pageOrigin;
  } catch {
    return false;
  }
}

export const siteOf = (source: string, pageOrigin: string) => new URL(source, pageOrigin).hostname;
