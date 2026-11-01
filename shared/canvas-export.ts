import { fenced } from "./fenced.ts";

/** Where a page saved or copied out of the canvas loads its libraries (D3, Mermaid, three.js) from. */
export type PageLibraries = "cdn" | "inline";

export const pageLibrariesLabels: Record<PageLibraries, string> = {
  cdn: "From a public CDN: small files that need a network connection to draw",
  inline: "Inside the file: works offline, but Mermaid adds about 3 MB",
};

const LONGEST_NAME = 60;

function pageName(title: string) {
  const name = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, LONGEST_NAME)
    .replace(/^-+|-+$/g, "");
  return name || "canvas-page";
}

/** A file name for a page, after its title. */
export const pageFileName = (title: string) => `${pageName(title)}.html`;

/** Where Save to project offers to put a page. */
export const suggestedPagePath = (title: string) => `docs/${pageFileName(title)}`;

/** Where Save image to project offers to put the page drawn as a PNG. */
export const suggestedImagePagePath = (title: string) => `docs/${pageName(title)}.png`;

/** Where the agent is asked to save a page as Markdown: beside where Save to project offers its HTML. */
export const markdownPagePath = (title: string) => `docs/${pageName(title)}.md`;

/** Whether the agent only replies with the Markdown, or also saves it into the project. */
export type MarkdownDelivery = "reply" | "file";

const MARKDOWN_SHAPE = "keep its headings, lists, tables and code, and put what a chart or diagram shows into a sentence or a table";
/** A page with code samples has fences of its own, which would end a block fenced with as few backticks. */
const COPYABLE_BLOCK = "in one code block, fenced with more backticks than any fence inside it, so it can be copied";

/** The message that asks the agent for a page as Markdown. It carries the page's HTML, which the agent may no longer have after its context was compacted. */
export function markdownRequest(page: { title: string; html: string }, delivery: MarkdownDelivery) {
  const where =
    delivery === "file"
      ? `Save it as ${markdownPagePath(page.title)} in the project, but if a file is there already, ask me before replacing it. Reply with the same Markdown ${COPYABLE_BLOCK}.`
      : `Reply with the Markdown ${COPYABLE_BLOCK}, and write no file.`;
  return `Write the canvas page "${page.title}" as Markdown: ${MARKDOWN_SHAPE}. ${where}\n\nThe page's HTML:\n\n${fenced(page.html, "html")}`;
}
