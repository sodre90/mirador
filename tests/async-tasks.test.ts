import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { asyncTaskUpdateOf, AsyncTasks, tailTaskOutput, type AsyncTaskUpdate } from "../host/async-tasks.ts";

const spawned = (asyncTaskId: string, over: Partial<Extract<AsyncTaskUpdate, { sessionUpdate: "async_task_spawned" }>> = {}): AsyncTaskUpdate => ({
  sessionUpdate: "async_task_spawned",
  asyncTaskId,
  name: asyncTaskId,
  taskType: "shell",
  description: `sleep ${asyncTaskId}`,
  showInTranscript: false,
  canStop: true,
  ...over,
});

const tasksOf = (tasks: AsyncTasks) => tasks.in("c1");

describe("asyncTaskUpdateOf", () => {
  test("reads the three async task updates and no others", () => {
    for (const sessionUpdate of ["async_task_spawned", "async_task_progress", "async_task_state_update"] as const) {
      expect(asyncTaskUpdateOf({ sessionUpdate, asyncTaskId: "t1" })).toMatchObject({ sessionUpdate, asyncTaskId: "t1" });
    }
    expect(asyncTaskUpdateOf({ sessionUpdate: "agent_message_chunk" })).toBeNull();
    expect(asyncTaskUpdateOf({ sessionUpdate: "notice" })).toBeNull();
    expect(asyncTaskUpdateOf({})).toBeNull();
  });
});

describe("AsyncTasks", () => {
  test("a spawn starts a running task the panel can stop", () => {
    const tasks = new AsyncTasks();
    expect(tasks.apply("c1", spawned("t1", { outputFilePath: "/tmp/t1.log" }), 1000)).toBe(true);
    expect(tasksOf(tasks)).toEqual([
      { id: "t1", taskType: "shell", description: "sleep t1", state: "running", canStop: true, summary: null, outputFilePath: "/tmp/t1.log", since: 1000 },
    ]);
  });

  test("a spawn for another conversation stays with its own", () => {
    const tasks = new AsyncTasks();
    tasks.apply("c1", spawned("t1"));
    expect(tasks.in("c2")).toEqual([]);
  });

  test("progress changes only what it carries", () => {
    const tasks = new AsyncTasks();
    tasks.apply("c1", spawned("t1", { outputFilePath: "/tmp/t1.log" }));
    tasks.apply("c1", { sessionUpdate: "async_task_progress", asyncTaskId: "t1", summary: "Still running after 10s" });
    const [task] = tasksOf(tasks);
    expect(task.summary).toBe("Still running after 10s");
    expect(task.description).toBe("sleep t1");
    expect(task.outputFilePath).toBe("/tmp/t1.log");
    expect(tasks.apply("c1", { sessionUpdate: "async_task_progress", asyncTaskId: "t1", description: "sleep 30", outputFilePath: "/tmp/other.log" })).toBe(true);
    expect(tasksOf(tasks)[0]).toMatchObject({ description: "sleep 30", outputFilePath: "/tmp/other.log" });
  });

  test("a state update ends a task and takes its Stop away", () => {
    const tasks = new AsyncTasks();
    tasks.apply("c1", spawned("t1"));
    tasks.apply("c1", { sessionUpdate: "async_task_state_update", asyncTaskId: "t1", state: "completed", summary: "Task completed" });
    expect(tasksOf(tasks)[0]).toMatchObject({ state: "completed", canStop: false, summary: "Task completed" });
    tasks.apply("c1", spawned("t2"));
    tasks.apply("c1", { sessionUpdate: "async_task_state_update", asyncTaskId: "t2", state: "paused" });
    expect(tasksOf(tasks).find(({ id }) => id === "t2")).toMatchObject({ state: "paused", canStop: true });
  });

  test("updates for a task never spawned change nothing", () => {
    const tasks = new AsyncTasks();
    expect(tasks.apply("c1", { sessionUpdate: "async_task_progress", asyncTaskId: "gone", summary: "x" })).toBe(false);
    expect(tasks.apply("c1", { sessionUpdate: "async_task_state_update", asyncTaskId: "gone", state: "completed" })).toBe(false);
    expect(tasksOf(tasks)).toEqual([]);
  });

  test("a re-spawn keeps the time the task was first seen and an ended state", () => {
    const tasks = new AsyncTasks();
    tasks.apply("c1", spawned("t1"), 1000);
    tasks.apply("c1", { sessionUpdate: "async_task_state_update", asyncTaskId: "t1", state: "stopped" });
    tasks.apply("c1", spawned("t1", { description: "sleep again", canStop: true }), 9000);
    expect(tasksOf(tasks)).toEqual([
      { id: "t1", taskType: "shell", description: "sleep again", state: "stopped", canStop: false, summary: null, outputFilePath: null, since: 1000 },
    ]);
  });

  test("a stop the agent answers with nothing to stop leaves no Stop behind", () => {
    const tasks = new AsyncTasks();
    tasks.apply("c1", spawned("t1"));
    expect(tasks.markUnstoppable("c1", "t1")).toBe(true);
    expect(tasksOf(tasks)[0]).toMatchObject({ state: "running", canStop: false });
    expect(tasks.markUnstoppable("c1", "t1")).toBe(false);
    tasks.apply("c1", spawned("t2"));
    tasks.apply("c1", { sessionUpdate: "async_task_state_update", asyncTaskId: "t2", state: "failed" });
    expect(tasks.markUnstoppable("c1", "t2")).toBe(false);
    expect(tasks.markUnstoppable("c1", "unknown")).toBe(false);
  });

  test("the output file follows the latest update naming one", () => {
    const tasks = new AsyncTasks();
    expect(tasks.outputFileOf("c1", "t1")).toBeNull();
    tasks.apply("c1", spawned("t1", { outputFilePath: "/tmp/t1.log" }));
    expect(tasks.outputFileOf("c1", "t1")).toBe("/tmp/t1.log");
    tasks.apply("c1", { sessionUpdate: "async_task_state_update", asyncTaskId: "t1", state: "completed", outputFilePath: "/tmp/final.log" });
    expect(tasks.outputFileOf("c1", "t1")).toBe("/tmp/final.log");
  });

  test("ended tasks are kept until there are too many, running ones dropped last", () => {
    const tasks = new AsyncTasks();
    for (let i = 0; i < 15; i++) {
      tasks.apply("c1", spawned(`ended-${i}`));
      tasks.apply("c1", { sessionUpdate: "async_task_state_update", asyncTaskId: `ended-${i}`, state: "completed" });
    }
    for (let i = 0; i < 10; i++) tasks.apply("c1", spawned(`running-${i}`));
    const ids = tasksOf(tasks).map(({ id }) => id);
    expect(ids).toHaveLength(20);
    expect(ids.filter((id) => id.startsWith("running"))).toHaveLength(10);
    // Each running task past the cap made one ended task, oldest first, make way.
    expect(ids.filter((id) => id.startsWith("ended"))).toEqual(["ended-5", "ended-6", "ended-7", "ended-8", "ended-9", "ended-10", "ended-11", "ended-12", "ended-13", "ended-14"]);
  });

  test("dismiss removes a completed task and returns true", () => {
    const tasks = new AsyncTasks();
    tasks.apply("c1", spawned("t1"));
    tasks.apply("c1", { sessionUpdate: "async_task_state_update", asyncTaskId: "t1", state: "completed" });
    tasks.apply("c1", spawned("t2"));

    expect(tasks.dismiss("c1", "t1")).toBe(true);
    expect(tasksOf(tasks).map(({ id }) => id)).toEqual(["t2"]);
  });

  test("a running task cannot be dismissed", () => {
    const tasks = new AsyncTasks();
    tasks.apply("c1", spawned("t1"));
    expect(tasks.dismiss("c1", "t1")).toBe(false);
    expect(tasksOf(tasks).map(({ id }) => id)).toEqual(["t1"]);
  });

  test("dismissing a non-existent task returns false", () => {
    const tasks = new AsyncTasks();
    expect(tasks.dismiss("c1", "non-existent")).toBe(false);
    tasks.apply("c1", spawned("t1"));
    expect(tasks.dismiss("c1", "non-existent")).toBe(false);
  });

  test("dismiss removes a stopped or failed task or an unstoppable one", () => {
    const tasks = new AsyncTasks();
    tasks.apply("c1", spawned("t1"));
    tasks.apply("c1", { sessionUpdate: "async_task_state_update", asyncTaskId: "t1", state: "stopped" });
    expect(tasks.dismiss("c1", "t1")).toBe(true);

    tasks.apply("c1", spawned("t2"));
    tasks.apply("c1", { sessionUpdate: "async_task_state_update", asyncTaskId: "t2", state: "failed" });
    expect(tasks.dismiss("c1", "t2")).toBe(true);

    tasks.apply("c1", spawned("t3"));
    tasks.markUnstoppable("c1", "t3");
    expect(tasks.dismiss("c1", "t3")).toBe(true);
    expect(tasksOf(tasks)).toEqual([]);
  });

  test("clearFinished removes all finished tasks and keeps running ones", () => {
    const tasks = new AsyncTasks();
    tasks.apply("c1", spawned("t1"));
    tasks.apply("c1", { sessionUpdate: "async_task_state_update", asyncTaskId: "t1", state: "completed" });
    tasks.apply("c1", spawned("t2"));
    tasks.apply("c1", { sessionUpdate: "async_task_state_update", asyncTaskId: "t2", state: "failed" });
    tasks.apply("c1", spawned("t3")); // running

    expect(tasks.clearFinished("c1")).toBe(true);
    expect(tasksOf(tasks).map(({ id }) => id)).toEqual(["t3"]);
    expect(tasks.clearFinished("c1")).toBe(false);
    expect(tasks.clearFinished("c2")).toBe(false);
  });

  test("forget takes a conversation's tasks with it", () => {
    const tasks = new AsyncTasks();
    tasks.apply("c1", spawned("t1"));
    tasks.apply("c2", spawned("t2"));
    tasks.forget("c1");
    expect(tasksOf(tasks)).toEqual([]);
    expect(tasks.in("c2").map(({ id }) => id)).toEqual(["t2"]);
  });
});

describe("tailTaskOutput", () => {
  const dir = mkdtempSync(join(tmpdir(), "async-task-output-"));

  test("a small file comes whole", () => {
    const path = join(dir, "small.log");
    writeFileSync(path, "one\ntwo\n");
    expect(tailTaskOutput(path)).toBe("one\ntwo\n");
  });

  test("a missing file or a directory reads as nothing yet", () => {
    expect(tailTaskOutput(join(dir, "missing.log"))).toBeNull();
    expect(tailTaskOutput(dir)).toBeNull();
  });

  test("a long file is cut to its last bytes on a whole line", () => {
    const path = join(dir, "long.log");
    writeFileSync(path, "first line".padEnd(70 * 1024, "-") + "\nlast line\n");
    expect(tailTaskOutput(path)).toBe("…\nlast line\n");
  });

  test("a long file whose tail holds several lines keeps them all", () => {
    const path = join(dir, "longer.log");
    writeFileSync(path, `${"x".repeat(70 * 1024)}\none\ntwo\n`);
    expect(tailTaskOutput(path)).toBe("…\none\ntwo\n");
  });
});
