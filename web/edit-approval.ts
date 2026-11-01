import type { PermissionOption } from "@agentclientprotocol/sdk";
import type { StoredEvent } from "../shared/model.ts";
import type { EditDiff } from "../shared/review.ts";
import type { SettledNote } from "./SettledNote.tsx";
import { t } from "./i18n/index.ts";

/** A permission request to change files, and what the user answered. */
export interface EditRequest {
  permissionId: string;
  title: string;
  options: PermissionOption[];
  edits: EditDiff[];
  resolved: boolean;
  chosenOptionId: string | null;
}

/** The edits the agent asked permission for, oldest first. */
export function editRequestsIn(events: StoredEvent[]): EditRequest[] {
  const requests = new Map<string, EditRequest>();
  events.forEach(({ event }) => {
    if (event.type === "permission" && event.edits?.length) {
      const { permissionId, toolCall, options, edits } = event;
      requests.set(permissionId, { permissionId, title: toolCall.title ?? "Edit", options, edits, resolved: false, chosenOptionId: null });
    } else if (event.type === "permission-resolved") {
      const request = requests.get(event.permissionId);
      if (request) Object.assign(request, { resolved: true, chosenOptionId: event.optionId });
    }
  });
  return [...requests.values()];
}

const outcomeLabels: Record<PermissionOption["kind"], string> = t.canvas.edits.outcome;

/** What the user answered to an edit, for the note left on the canvas. */
export function settledEditNote(request: EditRequest): SettledNote {
  const kind = request.options.find(({ optionId }) => optionId === request.chosenOptionId)?.kind;
  const files = request.edits.map(({ path }) => path).join(", ");
  if (!kind) return { text: t.canvas.edits.noLongerWaits(files), tone: "neutral" };
  return { text: t.canvas.edits.answered(outcomeLabels[kind], files), tone: kind.startsWith("allow") ? "done" : "neutral" };
}

/** A row of a side-by-side diff: the index of the old version's row on the left and of the new version's on the right. */
export interface SplitRow {
  left: number | null;
  right: number | null;
}

/** Lays rows out side by side: each run of removed lines faces the run of added lines after it, line by line. */
export function splitRows(rows: { kind: string }[]): SplitRow[] {
  const split: SplitRow[] = [];
  let removed: number[] = [];
  let added: number[] = [];
  const faceRuns = () => {
    const facing = Array.from({ length: Math.max(removed.length, added.length) }, (_, line) => ({ left: removed[line] ?? null, right: added[line] ?? null }));
    split.push(...facing);
    [removed, added] = [[], []];
  };
  rows.forEach((row, index) => {
    if (row.kind === "removed" && added.length > 0) faceRuns();
    if (row.kind === "removed") removed.push(index);
    else if (row.kind === "added") added.push(index);
    else {
      faceRuns();
      split.push({ left: index, right: index });
    }
  });
  faceRuns();
  return split;
}
