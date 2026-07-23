export class IndexBuildCancelled extends Error {
  constructor() { super("索引任务已取消"); }
}

/** A token belongs to exactly one full-index build and is never reused. */
export class BuildCancellationToken {
  private cancelled = false;

  cancel(): void { this.cancelled = true; }
  get isCancelled(): boolean { return this.cancelled; }
}

/**
 * Separates short-lived full-build cancellation from plugin lifetime. Incremental
 * writes have no build token, so a completed/cancelled rebuild cannot reject
 * them; every write still checks the permanent unload barrier.
 */
export class BuildCancellationController {
  private currentBuild: BuildCancellationToken | undefined;
  private unloaded = false;

  startBuild(): BuildCancellationToken {
    const token = new BuildCancellationToken();
    this.currentBuild = token;
    return token;
  }

  cancelCurrentBuild(): void {
    this.currentBuild?.cancel();
  }

  finishBuild(token: BuildCancellationToken): void {
    if (this.currentBuild === token) this.currentBuild = undefined;
  }

  unload(): void {
    this.unloaded = true;
    this.cancelCurrentBuild();
  }

  isBuildCancelled(token: BuildCancellationToken): boolean {
    return this.unloaded || token.isCancelled;
  }

  assertPluginActive(): void {
    if (this.unloaded) throw new IndexBuildCancelled();
  }

  assertBuildCanContinue(token: BuildCancellationToken): void {
    if (this.isBuildCancelled(token)) throw new IndexBuildCancelled();
  }

  /** Pass a build token only for the full-build atomic commit. */
  assertCommitCanProceed(buildToken?: BuildCancellationToken): void {
    if (buildToken?.isCancelled) throw new IndexBuildCancelled();
    this.assertPluginActive();
  }
}
