import type { CodeSpan } from "./highlight.ts";
import { markChanged, type TextRange } from "./word-diff.ts";

const tokenClass = (type: string | null, changed: boolean) => [type && `token ${type}`, changed && "word-changed"].filter(Boolean).join(" ");

export function CodeText({ text, spans, changes }: { text: string; spans: CodeSpan[] | undefined; changes?: TextRange[] | null }) {
  if (!spans && !changes?.length) return <code className="code-text">{text || " "}</code>;
  const pieces = spans ?? [{ text, type: null }];
  if (pieces.length === 0) return <code className="code-text"> </code>;
  return (
    <code className="code-text">
      {markChanged(pieces, changes ?? []).map(({ text: piece, type, changed }, index) =>
        type || changed ? (
          <span key={index} className={tokenClass(type, changed)}>
            {piece}
          </span>
        ) : (
          piece
        ),
      )}
    </code>
  );
}
