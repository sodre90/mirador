import { expect, test } from "bun:test";
import { join } from "node:path";

test("the e2e desktop notifier ends once its stdin does, so a spec that times out before stopping it leaves none running", async () => {
  const unreachableHost = "http://127.0.0.1:9";
  const notifier = Bun.spawn(["bun", join(import.meta.dir, "../e2e/desktop-notifier.ts"), unreachableHost, "token"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
  try {
    await Bun.sleep(1_000);
    expect(notifier.exitCode).toBeNull();
    notifier.stdin.end();
    const outcome = await Promise.race([notifier.exited.then(() => "ended"), Bun.sleep(5_000).then(() => "still running")]);
    expect(outcome).toBe("ended");
  } finally {
    notifier.kill();
  }
});
