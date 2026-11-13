import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";

export function UnsavedMark({ id }: { id?: string }) {
  return <span id={id} className="unsaved-mark" role="img" aria-label={t.profiles.unsaved} data-hint={hints.unsavedProfileEdits} />;
}
