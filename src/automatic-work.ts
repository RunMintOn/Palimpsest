export interface AutomaticWorkActions {
  /** Invalidate timers/in-flight query presentation; never cancels a manual build. */
  suspend(): void;
  needsReconciliation(): boolean;
  reconcile(): Promise<void>;
  hasPendingChanges(): boolean;
  isIndexUpdateActive(): boolean;
  flush(): Promise<void>;
  query(): void;
}

export type AutomaticWorkTransition = "none" | "suspend" | "resume";

/** Tells the caller whether a waiting resume flow now owns the next query. */
export interface IndexUpdateCompletion {
  recoveryOwnsQuery: boolean;
}

/**
 * Visibility gate and ordered automatic-work runner. The host supplies actual
 * vault/index/query effects, while this class owns deduplication and the
 * reconciliation → flush → query ordering.
 */
export class AutomaticWorkCoordinator<View> {
  private readonly visibleViews = new Set<View>();
  private resumePromise: Promise<void> | undefined;
  /** A completion arrived while the active-check resume was still settling. */
  private deferredResume: Promise<void> | undefined;
  private resumeAfterIndexUpdate = false;
  /** A resume-started flush will complete through indexUpdateCompleted itself. */
  private resumeOwnsFlushCompletion = false;

  get allowed(): boolean { return this.visibleViews.size > 0; }

  visibilityChanged(view: View, visible: boolean, actions: AutomaticWorkActions): AutomaticWorkTransition {
    const wasAllowed = this.allowed;
    if (visible) this.visibleViews.add(view);
    else this.visibleViews.delete(view);
    if (wasAllowed === this.allowed) return "none";
    if (!this.allowed) {
      actions.suspend();
      return "suspend";
    }
    void this.resume(actions);
    return "resume";
  }

  /** Starts at most one resume flow; a hidden transition stops later stages. */
  resume(actions: AutomaticWorkActions): Promise<void> {
    if (!this.allowed) return Promise.resolve();
    if (this.resumePromise) return this.resumePromise;
    if (this.deferredResume) return this.deferredResume;
    return this.startResume(actions);
  }

  private startResume(actions: AutomaticWorkActions): Promise<void> {
    this.resumePromise = this.runResume(actions).finally(() => { this.resumePromise = undefined; });
    return this.resumePromise;
  }

  /**
   * An active update blocked a prior resume. Its completion transfers query
   * ownership to that resume flow, so callers must not also do a normal
   * refresh. This applies equally to incremental and user-started full builds.
   */
  indexUpdateCompleted(actions: AutomaticWorkActions): IndexUpdateCompletion {
    // flushFileUpdates reports its own completion before the resume awaits its
    // return. That completion belongs to this resume's eventual query, not to
    // an ordinary refresh or a second deferred recovery.
    if (this.resumeOwnsFlushCompletion) return { recoveryOwnsQuery: true };
    if (!this.resumeAfterIndexUpdate) return { recoveryOwnsQuery: false };
    this.resumeAfterIndexUpdate = false;
    // The active-check resume may still be in its final Promise microtask.
    // Waiting for it prevents this completion from being swallowed by the
    // already-ending flow and guarantees a fresh recovery pass.
    const currentResume = this.resumePromise;
    if (currentResume) {
      const deferred = currentResume.then(() => this.allowed ? this.startResume(actions) : undefined);
      this.deferredResume = deferred;
      void deferred.finally(() => {
        if (this.deferredResume === deferred) this.deferredResume = undefined;
      });
    } else {
      void this.resume(actions);
    }
    return { recoveryOwnsQuery: true };
  }

  /** Full builds use the same handoff, but keeping this named boundary makes every terminal path explicit. */
  fullBuildCompleted(actions: AutomaticWorkActions): IndexUpdateCompletion {
    return this.indexUpdateCompleted(actions);
  }

  private async runResume(actions: AutomaticWorkActions): Promise<void> {
    if (actions.isIndexUpdateActive()) {
      this.resumeAfterIndexUpdate = true;
      return;
    }
    if (actions.needsReconciliation()) {
      await actions.reconcile();
      if (!this.allowed) return;
    }
    if (actions.isIndexUpdateActive()) {
      this.resumeAfterIndexUpdate = true;
      return;
    }
    if (actions.hasPendingChanges()) {
      this.resumeOwnsFlushCompletion = true;
      try {
        await actions.flush();
      } finally {
        this.resumeOwnsFlushCompletion = false;
      }
      if (!this.allowed) return;
    }
    if (this.allowed && !actions.isIndexUpdateActive()) actions.query();
  }
}
