import type { PromptTemplate } from "./model.ts";

const PARAMETER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** The names of the template's {{parameters}}, each once, in the order they first appear. */
export const parametersOf = (text: string) => [...new Set([...text.matchAll(PARAMETER)].map(([, name]) => name!).filter(Boolean))];

export const filledIn = (text: string, values: Record<string, string>) => text.replace(PARAMETER, (placeholder, name: string) => (name ? (values[name] ?? "") : placeholder));

export interface TextRange {
  start: number;
  end: number;
}

/** Where the {{parameters}} still to fill in sit in the message box, each place on its own. */
export const placeholdersIn = (text: string): TextRange[] =>
  [...text.matchAll(PARAMETER)].filter(([, name]) => name).map(({ index, 0: placeholder }) => ({ start: index, end: index + placeholder.length }));

/** Where Tab goes from the selection: the next placeholder after it, or with ⇧Tab the one before it, coming round at the ends. */
export function adjacentPlaceholder(text: string, selection: TextRange, step: 1 | -1): TextRange | null {
  const placeholders = placeholdersIn(text);
  const adjacent = step === 1 ? placeholders.find(({ start }) => start >= selection.end) : placeholders.findLast(({ end }) => end <= selection.start);
  return adjacent ?? (step === 1 ? placeholders[0] : placeholders.at(-1)) ?? null;
}

/** The templates holding every word typed, those whose name does first. */
export function matchingTemplates<Template extends Pick<PromptTemplate, "name" | "text">>(templates: Template[], query: string): Template[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const holdsEvery = (text: string) => words.every((word) => text.toLowerCase().includes(word));
  const found = templates.filter(({ name, text }) => holdsEvery(`${name}\n${text}`));
  return [...found.filter(({ name }) => holdsEvery(name)), ...found.filter(({ name }) => !holdsEvery(name))];
}

/** Each is added once to every host, so one the user deleted stays deleted and one they edited keeps their text. */
export const defaultPromptTemplates: Omit<PromptTemplate, "createdAt">[] = [
  {
    id: "default-deep-pr-review",
    name: "Deep PR review",
    text: [
      "Review {{Pull request}} in depth, and check out the code in a worktree to confirm each concern before you raise it.",
      "Then give me a summary that helps me understand the change fast: walk me through how the code flows, in the order it runs, in plain words.",
      "Keep review comments short. Write prose only where it's needed.",
    ].join("\n\n"),
  },
  {
    id: "default-start-on-a-ticket",
    name: "Start on a ticket",
    text: [
      "Let's start on {{Ticket}}. Read the ticket, its comments and everything it links to, then find the code it touches.",
      [
        "Before you change anything, tell me:",
        "- what the ticket asks for, in a few lines;",
        "- how the code involved works today, in the order it runs;",
        "- what is unclear or missing, as questions for me;",
        "- the approach you suggest, and the others you considered.",
      ].join("\n"),
      "Don't write code until I've answered.",
    ].join("\n\n"),
  },
  {
    id: "default-code-tour",
    name: "Code tour",
    text: [
      "Give me a guided tour of {{What to explain}} as a tour on the canvas. Start where it begins, then follow the code in the order it runs, one step for each place where something important happens.",
      "Keep each step to a few sentences in plain words: what happens there and why it matters. End with where to read next if I want to go deeper.",
    ].join("\n\n"),
  },
];

export const PROMPT_TEMPLATE_NAME_LIMIT = 100;
export const PROMPT_TEMPLATE_TEXT_LIMIT = 20_000;

/** What is wrong with a template the user wants to save, if anything. */
export function promptTemplateProblem({ id, name, text }: Pick<PromptTemplate, "id" | "name" | "text">): string | null {
  if (typeof id !== "string" || !id || id.length > 100) return "A template needs an id.";
  if (typeof name !== "string" || !name.trim()) return "A template needs a name.";
  if (name.length > PROMPT_TEMPLATE_NAME_LIMIT) return `A template's name can be at most ${PROMPT_TEMPLATE_NAME_LIMIT} characters.`;
  if (typeof text !== "string" || !text.trim()) return "A template needs a text.";
  if (text.length > PROMPT_TEMPLATE_TEXT_LIMIT) return `A template's text can be at most ${PROMPT_TEMPLATE_TEXT_LIMIT} characters.`;
  return null;
}
