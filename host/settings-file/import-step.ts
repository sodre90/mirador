import type { HostProblem } from "../../shared/host-problems.ts";
import type { Profile } from "../../shared/model.ts";
import type { FileProfileReference, SettingsItem } from "../../shared/settings-file.ts";
import type { Store } from "../store.ts";

/** One thing of the file: what it would change here, and the change itself. */
export interface ImportStep {
  item: SettingsItem;
  bringIn(): void | Promise<void>;
  /** What waits until every profile of the file is here, such as a setting that names one. */
  finish?(): void | Promise<void>;
}

export interface ImportContext {
  store: Store;
  dataDir: string;
  /** What can't be brought in, for whoever imports the file. */
  problems: HostProblem[];
}

export const profileReferredTo = (store: Store, reference: FileProfileReference): Profile | undefined =>
  store.listProfiles().find(({ name, harness }) => (typeof reference === "string" ? name === reference : name === reference.name && harness === reference.harness));

export const referredName = (reference: FileProfileReference) => (typeof reference === "string" ? reference : reference.name);
