import { describe, expect, test } from "bun:test";
import { awakeCommand, KeepAwakeHold, wantsAwake, type HoldAwake } from "../host/keep-awake.ts";

function recordedHolds() {
  const events: string[] = [];
  const holdAwake: HoldAwake = () => {
    events.push("held");
    return { release: () => events.push("released") };
  };
  return { events, holdAwake };
}

describe("keeping the computer awake", () => {
  test("wants it awake always, or while agents work only while a turn runs", () => {
    expect(wantsAwake("never", 3)).toBe(false);
    expect(wantsAwake("while-working", 0)).toBe(false);
    expect(wantsAwake("while-working", 1)).toBe(true);
    expect(wantsAwake("always", 0)).toBe(true);
  });

  test("while agents work, holds from the first running turn until the last one ends, once", () => {
    const { events, holdAwake } = recordedHolds();
    const hold = new KeepAwakeHold("while-working", holdAwake);
    hold.setRunningTurns(1);
    hold.setRunningTurns(2);
    hold.setRunningTurns(0);
    expect(events).toEqual(["held", "released"]);
  });

  test("follows a change of the setting, and lets go when the host stops", () => {
    const { events, holdAwake } = recordedHolds();
    const hold = new KeepAwakeHold("never", holdAwake);
    hold.setKeepAwake("always");
    hold.setKeepAwake("while-working");
    hold.setKeepAwake("always");
    hold.stop();
    expect(events).toEqual(["held", "released", "held", "released"]);
  });

  test("tries again on the next change when the platform could not hold it", () => {
    let tries = 0;
    const hold = new KeepAwakeHold("always", () => {
      tries++;
      return null;
    });
    hold.setRunningTurns(1);
    expect(tries).toBe(2);
  });

  test("holds idle sleep off for as long as the host's process lives", () => {
    expect(awakeCommand("darwin", 42)).toEqual(["caffeinate", "-i", "-w", "42"]);
    expect(awakeCommand("linux", 42)).toEqual(expect.arrayContaining(["systemd-inhibit", "--what=idle", "tail", "--pid=42"]));
    expect(awakeCommand("win32", 42)).toBeNull();
  });
});
