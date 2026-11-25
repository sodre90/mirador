import { useId } from "react";
import type { PermissionPreset } from "../shared/room-permissions.ts";
import { t } from "./i18n/index.ts";

const words = t.rooms;

/** One of the presets to choose what a room's agents may do without asking, with what it lets them reach beside the files it names. */
export function PresetChoice({
  className,
  preset,
  sandboxed,
  checked,
  onChoose,
}: {
  className: string;
  preset: PermissionPreset;
  sandboxed: boolean;
  checked: boolean;
  onChoose: () => void;
}) {
  const id = useId();
  const [titleId, noteId] = [`${id}-title`, `${id}-note`];
  const reachesMore = preset === "work-freely" && !sandboxed;
  return (
    <label className={className}>
      <input type="radio" name="room-permissions" aria-labelledby={titleId} aria-describedby={reachesMore ? noteId : undefined} checked={checked} onChange={onChoose} />
      <span className="room-row-words">
        <span id={titleId}>{words.presets[preset]}</span>
        {reachesMore && (
          <span className="hint" id={noteId}>
            {words.workFreelyUnsandboxed}
          </span>
        )}
      </span>
    </label>
  );
}
