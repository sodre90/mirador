import { expect, test } from "bun:test";
import { Lookout } from "../host/lookout.ts";

test("each look is given the last answer, and says only a changed one; a look that fails leaves the last answer standing", async () => {
  const given: (string[] | null)[] = [];
  const said: (string[] | null)[] = [];
  const answers = [["a"], ["a"], ["a", "b"]];
  let failing = false;
  const lookout = new Lookout<string[]>(
    async (_, last) => {
      given.push(last);
      if (failing) throw new Error("offline");
      return answers.shift() ?? null;
    },
    (found) => said.push(found),
  );
  await lookout.look(true);
  await lookout.look(true);
  await lookout.look(true);
  failing = true;
  await lookout.look(true);
  expect(given).toEqual([null, ["a"], ["a"], ["a", "b"]]);
  expect(said).toEqual([["a"], ["a", "b"]]);
  expect(lookout.current).toEqual(["a", "b"]);
});
