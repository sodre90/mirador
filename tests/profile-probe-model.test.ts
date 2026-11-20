import { expect, test } from "bun:test";
import type { NewSessionResponse, SessionConfigOption, SetSessionConfigOptionResponse } from "@agentclientprotocol/sdk/unstable";
import { offeredOnModel } from "../host/conversations.ts";

const efforts = (...levels: string[]): SessionConfigOption => ({
  id: "effort",
  name: "Effort",
  category: "thought_level",
  type: "select",
  currentValue: levels[0]!,
  options: levels.map((level) => ({ value: level, name: level })),
});

const onModel = (model: string, ...levels: string[]): SessionConfigOption[] => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: model,
    options: [
      { value: "sol-6.1", name: "Sol 6.1" },
      { value: "sol-6.2", name: "Sol 6.2" },
    ],
  },
  efforts(...levels),
];

const created: NewSessionResponse = { sessionId: "s1", configOptions: onModel("sol-6.1", "off", "high") };
const switched = onModel("sol-6.2", "low", "max");

/** An agent that answers a model switch as `answer` does, recording what it was asked. */
function agentAnswering(answer: () => Promise<SetSessionConfigOptionResponse>) {
  const asked: string[] = [];
  return {
    asked,
    agent: {
      setConfigOption: (sessionId: string, configId: string, value: unknown) => {
        asked.push(`${sessionId} ${configId} ${value}`);
        return answer();
      },
    },
  };
}

test("a probe reads what the session offers once it is on the profile's model", async () => {
  const { agent, asked } = agentAnswering(async () => ({ configOptions: switched }));
  expect(await offeredOnModel(agent, created, "sol-6.2")).toEqual(switched);
  expect(asked).toEqual(["s1 model sol-6.2"]);
});

test("a probe changes nothing when the profile names no model, the session's own, or one the agent does not offer", async () => {
  const { agent, asked } = agentAnswering(async () => ({ configOptions: switched }));
  expect(await offeredOnModel(agent, created, null)).toEqual(created.configOptions!);
  expect(await offeredOnModel(agent, created, "sol-6.1")).toEqual(created.configOptions!);
  expect(await offeredOnModel(agent, created, "gpt-9")).toEqual(created.configOptions!);
  expect(await offeredOnModel(agent, { sessionId: "s2", configOptions: [efforts("low")] }, "sol-6.2")).toEqual([efforts("low")]);
  expect(asked).toEqual([]);
});

test("a probe keeps what the session started with when the agent refuses the model or is slow to switch", async () => {
  const refusing = agentAnswering(() => Promise.reject(new Error("No API key for sandbox/sol-6.2")));
  expect(await offeredOnModel(refusing.agent, created, "sol-6.2")).toEqual(created.configOptions!);
  const slow = agentAnswering(() => new Promise(() => {}));
  expect(await offeredOnModel(slow.agent, created, "sol-6.2", 20)).toEqual(created.configOptions!);
});
