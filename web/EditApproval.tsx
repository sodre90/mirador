import { Fragment, useMemo } from "react";
import type { PermissionOption } from "@agentclientprotocol/sdk/unstable";
import type { DiffRow, EditDiff } from "../shared/review.ts";
import { connection } from "./connection.ts";
import { splitRows, type EditRequest } from "./edit-approval.ts";
import { highlightRows, type CodeSpan } from "./highlight.ts";
import { hints } from "./hints.ts";
import { describedText } from "./host-error.ts";
import { t } from "./i18n/index.ts";
import { CodeText } from "./CodeText.tsx";
import { gapsOf, type Gap } from "./review-context.ts";
import { SettledNoteLine, type SettledNote } from "./SettledNote.tsx";
import { storedChoice } from "./stored-choice.ts";
import { rowWordChanges, type TextRange } from "./word-diff.ts";

const diffStyles = ["unified", "split"] as const;
type DiffStyle = (typeof diffStyles)[number];
const diffStyleLabels: Record<DiffStyle, string> = { unified: t.chat.edits.unified, split: t.chat.edits.split };
export const diffStyle = storedChoice<DiffStyle>("mirador-edit-diff-style", diffStyles, "unified");

const marker = (row: DiffRow) => (row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " ");

export function answerPermission(conversationId: string, permissionId: string, optionId: string | null) {
  connection.send({ type: "permission.respond", conversationId, permissionId, optionId });
}

/** The agent's own answers to its request, Allow first as it orders them. */
export function PermissionOptions({ options, onChoose }: { options: PermissionOption[]; onChoose: (optionId: string) => void }) {
  return (
    <div className="permission-options">
      {options.map((option) => (
        <button key={option.optionId} type="button" className={`option-${option.kind}`} onClick={() => onChoose(option.optionId)}>
          {option.name}
        </button>
      ))}
    </div>
  );
}

export function EditCounts({ edits }: { edits: EditDiff[] }) {
  const added = edits.reduce((sum, edit) => sum + edit.added, 0);
  const removed = edits.reduce((sum, edit) => sum + edit.removed, 0);
  return (
    <span className="edit-counts">
      <span className="added-count">+{added}</span> <span className="removed-count">−{removed}</span>
    </span>
  );
}

function GapLine({ gap, lineCount }: { gap: Gap | undefined; lineCount: number | null }) {
  const end = gap && (gap.end ?? lineCount);
  if (!gap || end === null || end === undefined || end < gap.start) return null;
  return <div className="edit-gap">⋯ {end === gap.start ? t.chat.edits.line(end) : t.chat.edits.lines(gap.start, end)}</div>;
}

interface RowsProps {
  rows: DiffRow[];
  highlighted: CodeSpan[][] | null;
  wordChanges: (TextRange[] | null)[];
}

function UnifiedRows({ rows, highlighted, wordChanges }: RowsProps) {
  return (
    <div className="edit-code-block">
      {rows.map((row, index) => (
        <div key={index} className={`code-row ${row.kind}`}>
          <span className="line-number">{row.newLine ?? row.oldLine}</span>
          <span className="diff-marker">{marker(row)}</span>
          <CodeText text={row.text} spans={highlighted?.[index]} changes={wordChanges[index]} />
        </div>
      ))}
    </div>
  );
}

function SplitRows({ rows, highlighted, wordChanges }: RowsProps) {
  const sides = useMemo(() => splitRows(rows), [rows]);
  const side = (index: number | null, lineOf: (row: DiffRow) => number | null) => {
    const row = index === null ? undefined : rows[index];
    return (
      <div className={`split-side ${row?.kind ?? "blank"}`}>
        <span className="line-number">{row && lineOf(row)}</span>
        {row && index !== null ? <CodeText text={row.text} spans={highlighted?.[index]} changes={wordChanges[index]} /> : <span />}
      </div>
    );
  };
  return (
    <div className="edit-code-block split">
      {sides.map(({ left, right }, index) => (
        <div key={index} className="split-row">
          {side(left, (row) => row.oldLine)}
          {side(right, (row) => row.newLine)}
        </div>
      ))}
    </div>
  );
}

function EditedRows({ path, rows, style }: { path: string; rows: DiffRow[]; style: DiffStyle }) {
  const highlighted = useMemo(() => highlightRows(path, rows), [path, rows]);
  const wordChanges = useMemo(() => rowWordChanges(rows), [rows]);
  return style === "split" ? (
    <SplitRows rows={rows} highlighted={highlighted} wordChanges={wordChanges} />
  ) : (
    <UnifiedRows rows={rows} highlighted={highlighted} wordChanges={wordChanges} />
  );
}

const UNLOCATED_EDIT = t.chat.edits.unlocated;

export function EditedFile({ edit, style, unlocatedHint = UNLOCATED_EDIT }: { edit: EditDiff; style: DiffStyle; unlocatedHint?: string | null }) {
  const gaps = edit.located ? gapsOf(edit) : [];
  return (
    <section className="edited-file" aria-label={edit.path}>
      <header className="file-header">
        <h3>{edit.path}</h3>
        {edit.change === "added" && <span className="edit-new-file">{t.chat.edits.newFile}</span>}
        {edit.change === "deleted" && <span className="edit-new-file">{t.chat.edits.deleted}</span>}
        <EditCounts edits={[edit]} />
      </header>
      {!edit.located && unlocatedHint && <p className="hint">{unlocatedHint}</p>}
      {edit.hiddenBecause && <p className="review-empty">{t.chat.edits.notShown(describedText(edit.hiddenBecause, edit.hiddenBecauseAbout))}</p>}
      {!edit.hiddenBecause && edit.hunks.length === 0 && <p className="review-empty">{t.chat.edits.noLines}</p>}
      {edit.hunks.map((hunk, index) => (
        <Fragment key={index}>
          <GapLine gap={gaps[index]} lineCount={edit.lineCount} />
          <EditedRows path={edit.path} rows={hunk.rows} style={style} />
        </Fragment>
      ))}
      <GapLine gap={gaps[edit.hunks.length]} lineCount={edit.lineCount} />
    </section>
  );
}

export function DiffStyleChoice({ style }: { style: DiffStyle }) {
  return (
    <div className="diff-style" role="group" aria-label={t.chat.edits.diffStyle} data-hint={hints.editDiffStyle}>
      {diffStyles.map((each) => (
        <button key={each} type="button" className={style === each ? "on" : ""} aria-pressed={style === each} onClick={() => diffStyle.set(each)}>
          {diffStyleLabels[each]}
        </button>
      ))}
    </div>
  );
}

/** An edit the agent waits for permission to make, shown on the canvas with the agent's own answers to it. */
export function EditApproval({ request, moreWaiting, note, conversationId }: { request: EditRequest; moreWaiting: number; note: SettledNote | null; conversationId: string }) {
  const style = diffStyle.use();
  return (
    <div className="edit-approval">
      <SettledNoteLine note={note} />
      <div className="edit-approval-bar">
        {moreWaiting > 0 && <span className="edits-more">{t.chat.edits.moreWaiting(moreWaiting)}</span>}
        <span className="spacer" />
        <DiffStyleChoice style={style} />
      </div>
      {request.edits.map((edit, index) => (
        <EditedFile key={index} edit={edit} style={style} />
      ))}
      <PermissionOptions options={request.options} onChoose={(optionId) => answerPermission(conversationId, request.permissionId, optionId)} />
    </div>
  );
}
