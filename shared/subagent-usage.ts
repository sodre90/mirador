import { isRealModel } from "./claude-models.ts";

/** What a subagent has spent so far, and the model it runs on. */
export interface SubagentUsage {
  model: string | null;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

interface Answer {
  id: string;
  model?: unknown;
  usage: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number };
}

const parsed = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

const answerIn = (record: unknown): Answer | null => {
  const { type, message } = (record ?? {}) as { type?: unknown; message?: Partial<Answer> };
  return type === "assistant" && typeof message?.id === "string" && typeof message.usage === "object" && message.usage !== null ? (message as Answer) : null;
};

/** Claude Code writes an answer in several records as it streams, each with the usage so far, so only the last one counts. */
const lastRecordOfEachAnswer = (transcript: string) => [
  ...new Map(
    transcript
      .split("\n")
      .map((line) => answerIn(parsed(line)))
      .filter((answer) => answer !== null)
      .map((answer) => [answer.id, answer]),
  ).values(),
];

/** What a subagent spent, from Claude Code's transcript of it; nothing before its first answer. */
export function subagentUsageFrom(transcript: string): SubagentUsage | null {
  const answers = lastRecordOfEachAnswer(transcript);
  if (answers.length === 0) return null;
  return answers.reduce<SubagentUsage>(
    (total, { model, usage }) => ({
      model: isRealModel(model) ? model : total.model,
      inputTokens: total.inputTokens + (usage.input_tokens ?? 0),
      cacheReadTokens: total.cacheReadTokens + (usage.cache_read_input_tokens ?? 0),
      cacheWriteTokens: total.cacheWriteTokens + (usage.cache_creation_input_tokens ?? 0),
      outputTokens: total.outputTokens + (usage.output_tokens ?? 0),
    }),
    { model: null, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
  );
}

export const allInputTokens = ({ inputTokens, cacheReadTokens, cacheWriteTokens }: SubagentUsage) => inputTokens + cacheReadTokens + cacheWriteTokens;

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumSignificantDigits: 3 });

export const formatTokens = (count: number) => compact.format(count).replace("K", "k");

export const tokensSpent = (usage: SubagentUsage) => `${formatTokens(allInputTokens(usage))} in · ${formatTokens(usage.outputTokens)} out`;
