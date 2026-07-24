import type { PreparedIndexBuild } from "./index-build-plan";

export type FullIndexBuildOutcome = "cancelled" | "executed";

export interface ConfirmedIndexBuildActions {
  prepare(): Promise<PreparedIndexBuild>;
  confirm(plan: PreparedIndexBuild): Promise<boolean>;
  execute(plan: PreparedIndexBuild): Promise<void>;
}

/**
 * The shared prepare → confirm → execute path. Errors intentionally propagate
 * so the production adapter can present cancellation, stale, and Ollama errors.
 */
export async function runConfirmedIndexBuild(actions: ConfirmedIndexBuildActions): Promise<FullIndexBuildOutcome> {
  const plan = await actions.prepare();
  if (!await actions.confirm(plan)) return "cancelled";
  await actions.execute(plan);
  return "executed";
}

/** Coalesces overlapping UI requests, including the time a confirmation Modal is open. */
export class FullIndexBuildRequestGate {
  private active: Promise<void> | undefined;

  get isActive(): boolean { return this.active !== undefined; }

  request(run: () => Promise<void>): Promise<void> {
    if (this.active) return this.active;
    const request = Promise.resolve().then(run);
    this.active = request;
    const finish = () => {
      if (this.active === request) this.active = undefined;
    };
    request.then(finish, finish);
    return request;
  }
}
