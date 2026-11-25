import type { CatalogPlugin } from "../../shared/apps.ts";
import type { HarnessId } from "../../shared/model.ts";
import { PLUGIN_LOAD_TOOL, TITLE_CONVERSATION_TOOL, USE_TOOL_TOOL } from "./tool-names.ts";

/**
 * What the canvas plugins add to what agents are told and allowed: their tools, and a line each of guidance.
 * `onRequest` holds a line for each plugin that loads on request, "- name: what it does and when to reach for it".
 * `useToolNames` holds the plugin tools that run through use_tool rather than being in the agent's tool list.
 */
export interface CanvasPluginGuidance {
  toolNames: string[];
  instructions: string[];
  often: string[];
  onRequest?: string[];
  useToolNames?: string[];
}

export const NO_CANVAS_PLUGINS: CanvasPluginGuidance = { toolNames: [], instructions: [], often: [] };

/** The tool through which the agent installs an official plugin it recommended, once the user says yes. */
export const PLUGIN_INSTALL_TOOL = "plugin_install";

/** Official plugins not installed yet, for the agent to recommend when one would help. */
export const offeredPluginsGuidance = (offered: CatalogPlugin[]) =>
  offered.length === 0
    ? []
    : [
        `- ${PLUGIN_INSTALL_TOOL}: official Mirador plugins the user hasn't installed. When one would help with what the user is doing, recommend it in a sentence; if they want it, call ${PLUGIN_INSTALL_TOOL}, which asks them before installing anything:`,
        ...offered.map(({ name, title, description, tagline, recommendWhen }) => `  - ${name} (${title}): ${tagline ?? description} Recommend it when ${recommendWhen}.`),
      ];

const linesAfter = (lines: string[]) => lines.map((line) => `\n${line}`).join("");

const useToolSentence = (names: string[] = []) =>
  names.length === 0
    ? ""
    : `${USE_TOOL_TOOL} runs the canvas tools that are not in your tool list (${names.join(", ")}); call it with just tool to read a tool's description and input schema, then with tool and input to run it.`;

const pluginToolLines = (plugins: CanvasPluginGuidance) => {
  const listed = plugins.instructions.length === 0 ? "" : `More canvas tools:${linesAfter(plugins.instructions)}`;
  const parts = [listed, useToolSentence(plugins.useToolNames)].filter(Boolean);
  return parts.length === 0 ? "" : `\n\n${parts.join("\n")}`;
};

const pluginsOnRequest = (lines: string[] = []) =>
  lines.length === 0
    ? ""
    : `\n\nPlugins that load on request. When one fits what you or the user are doing, call ${PLUGIN_LOAD_TOOL} with its name: it answers with the plugin's instructions and the names of its tools, which run through ${USE_TOOL_TOOL}.${linesAfter(lines)}`;

/**
 * Claude Code keeps only the first 4,096 characters of an MCP server's instructions, so its conversations get the plugins'
 * lines in their system prompt, which it doesn't cut, rather than in the canvas server's instructions.
 */
export const getsPluginLinesInSystemPrompt = (harness: HarnessId | undefined) => harness === "claude";

export const withoutPluginLines = (plugins: CanvasPluginGuidance): CanvasPluginGuidance => ({ ...plugins, instructions: [], onRequest: [], useToolNames: [] });

/** The plugins' lines of the canvas server's instructions, for the agents that get them in their system prompt instead. */
export function canvasPluginInstructions(plugins = NO_CANVAS_PLUGINS) {
  const lines = `${pluginsOnRequest(plugins.onRequest)}${pluginToolLines(plugins)}`;
  return lines === "" ? "" : `# Canvas plugins\nMirador's plugins add these to the canvas server, whose tools are named mcp__canvas__<tool>.${lines}`;
}

/**
 * The canvas MCP server's instructions: how its tools are meant to be used, and how pages render. Claude Code keeps only
 * their first 4,096 characters, so the plugins' lines come last, where a long list of them can't push out how pages render,
 * and the short lines of the plugins that load on request come before the longer ones of those sent up front.
 */
export function canvasInstructions(assetsOrigin: string, plugins = NO_CANVAS_PLUGINS) {
  return `The canvas is a browser panel next to this conversation. The user finds long terminal text and ASCII diagrams hard to read, so prefer the canvas for anything visual.

- show: render an HTML page: architecture or flow diagrams, UI mockups, side-by-side comparisons, charts, 3D scenes, visual explanations.
- ask: whenever you need the user to decide between options (design choices, approaches, trade-offs), ask here instead of in plain text. Give each option a short label and, when it helps, an HTML preview; mark what you recommend with recommended: true, not in its label. A question takes the canvas's place of what you showed before, so to ask about a page, pass it as the question's html rather than calling show first. Ask all you have to ask in one call.

Rendering environment: every page renders in a sandboxed iframe with NO network access (no fetch, no external CDNs, fonts or images), shown light or dark as the panel's theme is. Write self-contained HTML with inline CSS and JS. Draw diagrams as real graphics: HTML boxes laid out with CSS grid or flexbox, inline SVG, or Mermaid. Never draw them with ASCII or box-drawing characters (│ ┌ ─ ▼) in a <pre> or monospace block; keep <pre> for code. Pick every colour (background, text, cards, code, borders, lines) with light-dark() so the page follows that theme, e.g. <style>html { background: light-dark(#ffffff, #111214); color: light-dark(#1c1c1e, #ececee); }</style>. Don't use @media (prefers-color-scheme): it follows the system, not the panel. A script that draws in colour reads the theme as getComputedStyle(document.documentElement).colorScheme, "light" or "dark". Available libraries:
- three.js (ES modules): <script type="module">import * as THREE from "three"; import { OrbitControls } from "three/addons/controls/OrbitControls.js";</script>
- D3 v7: <script src="${assetsOrigin}/d3.min.js"></script> (global d3)
- Mermaid: <script src="${assetsOrigin}/mermaid.min.js"></script><script>mermaid.initialize({ startOnLoad: true, theme: getComputedStyle(document.documentElement).colorScheme === "dark" ? "dark" : "default" })</script> with <pre class="mermaid">...</pre>
When someone is viewing the conversation, show reports back script errors from the page so you can fix them.${pluginsOnRequest(plugins.onRequest)}${pluginToolLines(plugins)}`;
}

/** Claude Code and Codex publish a title after their first turn; the others are asked to name their conversation instead. */
export const namesItsOwnConversation = (harness: HarnessId | undefined) => harness === "claude" || harness === "codex";

/**
 * For the agents that publish no title of their own, so a conversation reads as what it is about rather than as the
 * first line of the user's message.
 */
export const titleGuidance = () => `# Conversation title
Mirador names this conversation after the first line of the user's first message. Once the first turn's work is done and you know what the conversation is about, call ${TITLE_CONVERSATION_TOOL} with a short title of a few words, in the language the user writes in, before your reply. Call it once; a name the user gives the conversation always stays.`;

/** Appended to Claude Code's and pi's system prompt when Settings ask for the canvas often; the canvas server's own instructions stay the reference for how pages render. */
export const canvasUseGuidance = (plugins = NO_CANVAS_PLUGINS) => `# Canvas
This conversation runs in Mirador, where the user reads a canvas panel next to the chat. Two rules come first, however long the turn and however close to its end:
- If your reply would hold a question for the user (anything ending in "?", or asking them to pick or confirm), call ask instead. That includes a quick clarification asked while you end your turn to wait for a job.
- After you show a page in a turn, the chat reply is at most 3 lines: the conclusion in one sentence and a pointer to the page. Never repeat the page's tables, lists or caveats in chat.

Pages are much easier for the user to read than long terminal text, so reach for the canvas server's tools whenever a page would be clearer:
- show: explaining how a system works (architecture, sequences); comparing two or more options; results that are tables, timelines or before/after; and the summary at the end of a substantial piece of work that is not a code change. Keep the chat reply to a few lines that point at the page.
- ask: every choice you would otherwise put to the user in text, including "which approach?", "help me decide" and "should I go ahead?". Give the options, mark what you recommend with recommended: true, and add a preview when it helps.${linesAfter(plugins.often)}
- Keep pages lean: plain semantic HTML and a little CSS, no decoration for its own sake.
- Plain text stays right for short answers, single facts and code the user will copy.`;
