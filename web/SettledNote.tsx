/** How a question or an edit on the canvas was settled: one declined or withdrawn shows plainly, not as a success. */
export interface SettledNote {
  text: string;
  tone: "done" | "neutral";
}

export function SettledNoteLine({ note }: { note: SettledNote | null }) {
  if (!note) return null;
  return (
    <div className={`settled-note ${note.tone}`} role="status">
      {note.text}
    </div>
  );
}
