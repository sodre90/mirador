import type { PromptTemplate } from "../shared/model.ts";
import { promptTemplateProblem } from "../shared/prompt-templates.ts";
import type { Hub } from "./hub.ts";
import type { Store } from "./store.ts";

/** Saves the template, new or changed, and shows it on every page; throws what is wrong with it. */
export function savePromptTemplate(store: Store, hub: Hub, draft: Pick<PromptTemplate, "id" | "name" | "text">) {
  const problem = promptTemplateProblem(draft);
  if (problem) throw new Error(problem);
  const { id, name, text } = draft;
  store.savePromptTemplate({ id, name: name.trim(), text, createdAt: Date.now() });
  hub.broadcast({ type: "prompt-template.upserted", template: store.findPromptTemplate(id)! });
}
