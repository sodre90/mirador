import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(async () => {
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("the host says it answers pings, and answers one with pong, so a phone can tell a dead socket from a quiet one", async ({ page }) => {
  await signIn(page, host);
  const { answersPings, answer } = await page.evaluate(async () => {
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
    const messages: { type: string; answersPings?: boolean }[] = [];
    const arrived = (type: string) =>
      new Promise<{ type: string; answersPings?: boolean }>((resolve) => {
        const check = () => {
          const found = messages.find((message) => message.type === type);
          if (found) resolve(found);
          else setTimeout(check, 20);
        };
        check();
      });
    socket.onmessage = ({ data }) => messages.push(JSON.parse(data));
    const snapshot = await arrived("snapshot");
    socket.send(JSON.stringify({ type: "ping" }));
    const answer = await arrived("pong");
    socket.close();
    return { answersPings: snapshot.answersPings, answer: answer.type };
  });
  expect(answersPings).toBe(true);
  expect(answer).toBe("pong");
});
