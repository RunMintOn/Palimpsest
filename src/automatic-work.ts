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

/**
 * Visibility gate and ordered automatic-work runner. The host supplies actual
 * vault/index/query effects, while this class owns deduplication and the
 * reconciliation → flush → query ordering.
 */
export class AutomaticWorkCoordinator<View> {
  private readonly visibleViews = new Set<View>();
  private resumePromise: Promise<void> | undefined;
  private resumeAfterIndexUpdate = false;

  get allowed(): boolean { return this.visibleViews.size > 0; }
  get isResuming(): boolean { return this.resumePromise !== undefined; }

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
    this.resumePromise = this.runResume(actions).finally(() => { this.resumePromise = undefined; });
    return this.resumePromise;
  }

  /** An active update blocked a prior resume; its completion is the next safe retry point. */
  indexUpdateCompleted(actions: AutomaticWorkActions): void {
    if (!this.resumeAfterIndexUpdate) return;
    this.resumeAfterIndexUpdate = false;
    void this.resume(actions);
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
      await actions.flush();
      if (!this.allowed) return;
    }
    if (!actions.isIndexUpdateActive()) actions.query();
  }
}
