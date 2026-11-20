/**
 * The Windows workflow's first step before its suite: a spec that waits for a real reply hangs for minutes when the
 * owner's model server doesn't answer, so the run ends here, early and saying why, instead of in those specs' timeouts.
 */
import { answerSeconds } from "./model-server.ts";

const WAIT_SECONDS = 60;

const seconds = await answerSeconds(WAIT_SECONDS * 1000);
if (seconds === null) {
  console.error(`The model server did not answer a completion within ${WAIT_SECONDS} s: the specs that wait for a real reply can't run, so this run ends here.`);
  process.exit(1);
}
console.log(`The model server answered a completion in ${seconds.toFixed(1)} s.`);
