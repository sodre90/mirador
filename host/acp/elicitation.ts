import type * as acp from "@agentclientprotocol/sdk/unstable";
import type { AskAnswerEntry, AskQuestion, CanvasAnswer } from "../../shared/model.ts";
import type { AskRequest, CanvasService } from "../canvas/service.ts";

interface FieldChoice {
  const: string;
  title?: string;
  description?: string;
}

interface FieldSchema {
  type?: string;
  title?: string;
  description?: string;
  oneOf?: FieldChoice[];
  enum?: string[];
  _meta?: { codex?: { role?: string; questionId?: string; isSecret?: boolean } };
}

/** A form question as the canvas asks it, with the form fields its answer and note go back in. */
interface AskedField {
  question: AskQuestion;
  answerField: string;
  noteField?: string;
}

export interface ElicitationAsk {
  ask: AskRequest;
  fields: AskedField[];
}

const isNoteField = (schema: FieldSchema) => schema._meta?.codex?.role === "user_note";

function choicesOf(schema: FieldSchema) {
  if (schema.oneOf) return schema.oneOf.map(({ const: label, description }) => ({ label, ...(description && { description }) }));
  return (schema.enum ?? []).map((label) => ({ label }));
}

/**
 * A form the canvas can ask: text fields, each with choices or free text. A Codex question that takes an answer of the
 * user's own comes with a note field beside it, which the canvas offers as "something else" rather than as a question.
 * A form with a secret field is declined on purpose, as a canvas answer is kept and shown in the conversation.
 */
export function askOfElicitation(request: acp.CreateElicitationRequest): ElicitationAsk | null {
  if (request.mode !== "form") return null;
  const { requestedSchema } = request as { requestedSchema?: { properties?: Record<string, FieldSchema> } };
  const properties = Object.entries(requestedSchema?.properties ?? {});
  if (properties.length === 0 || properties.some(([, schema]) => schema.type !== "string" || schema._meta?.codex?.isSecret)) return null;
  const noteFieldOf = (fieldId: string) => properties.find(([, schema]) => isNoteField(schema) && schema._meta?.codex?.questionId === fieldId)?.[0];
  const fields = properties
    .filter(([, schema]) => !isNoteField(schema))
    .map(([fieldId, schema]): AskedField => {
      const options = choicesOf(schema);
      const noteField = noteFieldOf(fieldId);
      const question = { question: schema.title || schema.description || fieldId, options, ...((noteField || options.length === 0) && { allowOther: true }) };
      return { question, answerField: fieldId, ...(noteField && { noteField }) };
    });
  const questions = fields.map(({ question }) => question);
  return { ask: questions.length === 1 ? questions[0]! : { questions }, fields };
}

/** The form's content for the user's answer: a typed answer goes in the answer's own field, which Codex reads as "Other". */
export function elicitationContent({ fields }: ElicitationAsk, { label, note, answers }: Pick<CanvasAnswer, "label" | "note" | "answers">): Record<string, string> {
  const given = answers ? withNoteOnAllAnswers(answers, note) : [{ label, note }];
  return Object.fromEntries(
    fields.flatMap(({ answerField, noteField }, index) => {
      const answer = given[index];
      if (!answer) return [];
      return [[answerField, answer.label], ...(noteField && answer.note ? [[noteField, answer.note]] : [])];
    }),
  );
}

/** A form has no note on all its answers, so the user's goes with the last answer's. */
function withNoteOnAllAnswers(answers: AskAnswerEntry[], note: string | undefined): AskAnswerEntry[] {
  if (!note) return answers;
  const last = answers.at(-1)!;
  return [...answers.slice(0, -1), { ...last, note: [last.note, note].filter(Boolean).join("\n") }];
}

/** The agent's form as a canvas question; a question the agent stops waiting for, or the user withdraws, is cancelled. */
export async function askFormOnCanvas(
  canvas: Pick<CanvasService, "openAsk" | "waitForAnswer" | "cancelAsk">,
  conversationId: string,
  request: acp.CreateElicitationRequest,
  signal: AbortSignal,
): Promise<acp.CreateElicitationResponse> {
  const asked = askOfElicitation(request);
  if (!asked) return { action: "decline" };
  const item = canvas.openAsk(conversationId, asked.ask);
  try {
    return { action: "accept", content: elicitationContent(asked, await canvas.waitForAnswer(item, signal)) };
  } catch {
    canvas.cancelAsk(item.id);
    return { action: "cancel" };
  }
}
