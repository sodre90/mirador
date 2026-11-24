import type { PromptTemplate } from "../../shared/model.ts";
import type { FilePromptTemplate } from "../../shared/settings-file.ts";
import type { ImportContext, ImportStep } from "./import-step.ts";

export function templateSteps(entries: FilePromptTemplate[], { store }: ImportContext, save: (draft: Pick<PromptTemplate, "id" | "name" | "text">) => void): ImportStep[] {
  const here = store.listPromptTemplates();
  return entries.map(({ name, text }) => {
    const existing = here.find((template) => template.name === name);
    return {
      item: {
        id: `prompt-template ${name}`,
        kind: "prompt-template",
        name,
        state: !existing ? "new" : existing.text === text ? "same" : "different",
        differs: existing && existing.text !== text ? ["text"] : [],
        needs: [],
      },
      bringIn: () => save({ id: existing?.id ?? crypto.randomUUID(), name, text }),
    };
  });
}
