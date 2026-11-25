import type { AskPage } from "../../shared/ask.ts";

const keyOf = ({ question, option }: AskPage) => `${question}-${option}`;

/** Puts together what the pages a question opens with report as they render, each on its own. */
export class OpeningPages {
  readonly errors: string[] = [];
  private readonly unreported: Set<string>;

  constructor(
    pages: AskPage[],
    private readonly allReported: (errors: string[]) => void,
  ) {
    this.unreported = new Set(pages.map(keyOf));
  }

  /** Whether the report was one still to come. */
  take(page: AskPage, errors: string[]) {
    if (!this.unreported.delete(keyOf(page))) return false;
    this.errors.push(...errors);
    if (this.unreported.size === 0) this.allReported(this.errors);
    return true;
  }
}
