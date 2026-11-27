import type { SandboxBlocker } from "../../shared/sandbox.ts";
import { protects, type GuardPlan } from "./guarded-workspace.ts";
import type { LookedAt } from "./looked-at.ts";

/** What of a plan its watch goes by: what the guard protects, and what that was made from. */
type WatchedPlan = Pick<GuardPlan, "parts" | "lookedAt">;

/** The plan as it would be made now, or why none would be. */
type PlanNow = WatchedPlan | { refused: SandboxBlocker };

/**
 * Looks every so often, until stopped, whether git reads or runs more of a folder than the plan its guards go by protects,
 * as once the owner set a hooks folder, included a file or added a submodule, and says so each time it does. Less to
 * protect, or a look that fails, is nothing to say.
 */
export class PlanWatch {
  private lookedAt: LookedAt;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private failing = false;

  constructor(
    private readonly plan: WatchedPlan,
    private readonly planNow: () => Promise<PlanNow>,
    private readonly outgrown: () => Promise<void>,
    private readonly everyMs: number,
  ) {
    this.lookedAt = plan.lookedAt;
    this.lookLater();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private lookLater() {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.look().finally(() => this.lookLater()), this.everyMs);
    this.timer.unref();
  }

  private async look() {
    try {
      if ((await this.isOutgrownForGood()) && !this.stopped) await this.outgrown();
      this.failing = false;
    } catch (error) {
      if (!this.failing) console.error("looking at what a sandbox's guard protects failed:", error);
      this.failing = true;
    }
  }

  /** A second look confirms the first, as a file that git or an editor replaces is missing for a moment. */
  private async isOutgrownForGood() {
    return (await this.isOutgrown()) && (await this.isOutgrown());
  }

  private async isOutgrown() {
    if (!(await this.lookedAt.changed())) return false;
    const now = await this.planNow();
    if ("refused" in now || !protects(this.plan.parts, now.parts)) return true;
    this.lookedAt = now.lookedAt;
    return false;
  }
}
