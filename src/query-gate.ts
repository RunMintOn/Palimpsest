/** Monotonic gate that prevents a completed old async query changing newer UI. */
export class QueryGate {
  private generation = 0;

  begin(): number {
    return ++this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  invalidate(): void {
    this.generation++;
  }
}
