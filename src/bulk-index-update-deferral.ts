/** Prevents a cancelled bulk batch from immediately opening the same modal again. */
export class BulkIndexUpdateDeferral {
  private deferred = false;

  get isDeferred(): boolean { return this.deferred; }
  defer(): void { this.deferred = true; }
  clear(): void { this.deferred = false; }
}
