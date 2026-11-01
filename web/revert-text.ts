import type { CommittedFiles } from "../shared/model.ts";
import { putsAnyFileBack, type UndoPreview } from "../shared/reverts.ts";
import type { Revert } from "../shared/reverts.ts";
import { t } from "./i18n/index.ts";

const words = t.revert;

const whatChanged = ({ restored, removed, committed }: Pick<Revert, "restored" | "removed" | "committed">) => {
  const parts = [restored > 0 && words.restored(restored), removed > 0 && words.removed(removed)].filter((part): part is string => Boolean(part));
  if (parts.length === 2) return words.both(parts[0]!, parts[1]!);
  return parts[0] ?? (committed ? words.noOtherFileDifferent : words.noFileDifferent);
};

function whatCommitsLeft({ files, editedSince, commits }: CommittedFiles) {
  const left = commits === null ? words.headMoved(files) : words.commitsCameIn(commits, files);
  if (editedSince === 0) return left;
  return `${left} ${files === 1 ? words.theFileWasEdited : words.someWereEdited(editedSince)}`;
}

export const whatWasLeft = ({ submodulesLeft = 0, committed }: Pick<Revert, "submodulesLeft" | "committed">) =>
  [committed && whatCommitsLeft(committed), submodulesLeft > 0 && words.submodulesLeft(submodulesLeft)].filter(Boolean).join(" ");

/** What the conversation loses: the turns from this one on, and the agent's own history with them. */
export const whatLeaves = ({ turnsLeaving = 1, keptFrom }: UndoPreview) => (keptFrom ? words.turnsLeave(turnsLeaving, keptFrom) : words.everyTurnLeaves);

/** What the files do: they go back too, or they stay as they are and this says why. */
export function whatFiles(preview: UndoPreview, rewind: boolean, keepFiles: boolean) {
  if (preview.filesNote) return rewind ? words.filesStayBecause(preview.filesNote) : preview.filesNote;
  if (!preview.plan) return "";
  if (keepFiles) return words.filesStayNow;
  const putsBack = putsAnyFileBack(preview.plan);
  const changedFiles = whatChanged(preview.plan);
  const putBack = putsBack
    ? (rewind ? words.filesGoBackToo : words.filesGoBack)(changedFiles)
    : preview.plan.committed
      ? words.noOtherFileChanged
      : words.noFileChanged;
  const changed = [putBack, whatWasLeft(preview.plan)].filter(Boolean).join(" ");
  return rewind || !putsBack ? changed : `${changed} ${words.turnStays}`;
}
