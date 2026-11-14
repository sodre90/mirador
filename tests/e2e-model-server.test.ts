import { describe, expect, test } from "bun:test";
import { answersWithin, modelServerEnvironment, NO_MODEL_SERVER, settingsIn } from "../e2e/model-server.ts";

const SAVED = "# the owner's model server\nLLM_SERVER_URL=https://models.example:8443\nexport LLM_SERVER_KEY='saved-key'\n";

describe("modelServerEnvironment", () => {
  test("sends Claude Code to the saved model server, on its one model and without tool search", () => {
    expect(modelServerEnvironment({}, SAVED)).toEqual({
      ANTHROPIC_BASE_URL: "https://models.example:8443",
      ANTHROPIC_AUTH_TOKEN: "saved-key",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "radiance-qwen3.8-flash-next",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "radiance-qwen3.8-flash-next",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "radiance-qwen3.8-flash-next",
      ANTHROPIC_SMALL_FAST_MODEL: "radiance-qwen3.8-flash-next",
      ENABLE_TOOL_SEARCH: "false",
    });
  });

  test("takes the run's own LLM_SERVER_URL and LLM_SERVER_KEY over the saved ones, as a container gets them", () => {
    const environment = modelServerEnvironment({ LLM_SERVER_URL: "http://passed.example", LLM_SERVER_KEY: "passed-key" }, SAVED);
    expect(environment.ANTHROPIC_BASE_URL).toBe("http://passed.example");
    expect(environment.ANTHROPIC_AUTH_TOKEN).toBe("passed-key");
  });

  test("with no model server, points Claude Code where nothing answers, at once, never at the owner's login", () => {
    const unanswered = { ANTHROPIC_BASE_URL: NO_MODEL_SERVER, ANTHROPIC_AUTH_TOKEN: "no-e2e-model-server", CLAUDE_CODE_MAX_RETRIES: "0" };
    expect(modelServerEnvironment({}, null)).toEqual(unanswered);
    expect(modelServerEnvironment({ ANTHROPIC_API_KEY: "a-key-that-would-spend" }, "LLM_SERVER_URL=https://models.example\n")).toEqual(unanswered);
  });

  test("leaves a run already pointed at a server, as the Windows workflow points its own, as it is when no model server is named", () => {
    expect(modelServerEnvironment({ ANTHROPIC_BASE_URL: "https://set.by.the.workflow" }, null)).toEqual({});
  });

  test("takes the named model server over one the run inherited, such as the paid gateway of the agent running the specs", () => {
    const environment = modelServerEnvironment({ ANTHROPIC_BASE_URL: "https://paid.gateway.example", ANTHROPIC_AUTH_TOKEN: "paid-token" }, SAVED);
    expect(environment.ANTHROPIC_BASE_URL).toBe("https://models.example:8443");
    expect(environment.ANTHROPIC_AUTH_TOKEN).toBe("saved-key");
  });
});

test("settingsIn reads NAME=value lines, quoted or not, and skips comments and blank lines", () => {
  expect(settingsIn('A=1\n\n# B=2\nexport C="three four"\r\nD=\n')).toEqual({ A: "1", C: "three four", D: "" });
});

describe("answersWithin", () => {
  /** A server that gives these statuses in turn, and the last one from then on. */
  const statuses = (...answers: number[]) => {
    const asked: number[] = [];
    const status = async () => {
      const answer = answers[Math.min(asked.length, answers.length - 1)]!;
      asked.push(answer);
      return answer;
    };
    return { asked, status };
  };

  test("asks again until the server answers 200", async () => {
    const server = statuses(0, 502, 200);
    expect(await answersWithin(server.status, 1_000, 1)).toBe(true);
    expect(server.asked).toEqual([0, 502, 200]);
  });

  test("gives up once the time is up", async () => {
    const server = statuses(0);
    expect(await answersWithin(server.status, 30, 10)).toBe(false);
    expect(server.asked.length).toBeGreaterThan(1);
    expect(server.asked.length).toBeLessThan(5);
  });
});
