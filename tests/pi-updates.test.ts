import { afterAll, describe, expect, test } from "bun:test";
import { newerPiThan } from "../host/pi-updates.ts";

/** `bun --version` prints a release version as `pi --version` does, on every system the tests run on. */
const program = process.execPath;
const installed = Bun.version;

let announced: unknown = { version: "999.0.0" };
const releases = Bun.serve({ port: 0, fetch: () => Response.json(announced) });
const releaseUrl = `http://127.0.0.1:${releases.port}/api/latest-version`;
afterAll(() => releases.stop(true));

const announcing = (body: unknown) => {
  announced = body;
  return releaseUrl;
};

describe("a newer pi", () => {
  test("is the release announced when it is newer than the one the program says it is", async () => {
    expect(await newerPiThan(program, {}, announcing({ version: "999.0.0" }))).toEqual({ installed, latest: "999.0.0" });
    expect(await newerPiThan(program, {}, announcing({ version: "v999.1.0", packageName: "@earendil-works/pi-coding-agent" }))).toEqual({ installed, latest: "999.1.0" });
  });

  test("is none when the program is as new or newer", async () => {
    expect(await newerPiThan(program, {}, announcing({ version: installed }))).toBeNull();
    expect(await newerPiThan(program, {}, announcing({ version: "0.0.1" }))).toBeNull();
  });

  test("is none when either version can't be told", async () => {
    expect(await newerPiThan(program, {}, announcing({ note: "no version" }))).toBeNull();
    expect(await newerPiThan(program, {}, announcing({ version: "soon" }))).toBeNull();
    expect(await newerPiThan(program, {}, "http://127.0.0.1:9/api/latest-version")).toBeNull();
    expect(await newerPiThan("/no/such/pi", {}, announcing({ version: "999.0.0" }))).toBeNull();
  });

  test("is not asked for where pi itself stays offline", async () => {
    expect(await newerPiThan(program, { PI_OFFLINE: "1" }, announcing({ version: "999.0.0" }))).toBeNull();
    expect(await newerPiThan(program, { PI_SKIP_VERSION_CHECK: "1" }, announcing({ version: "999.0.0" }))).toBeNull();
  });
});
