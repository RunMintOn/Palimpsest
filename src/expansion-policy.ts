export interface ExpansionPolicy {
  /** -1 means all results; 0 means all collapsed. */
  count: number;
  thresholdEnabled: boolean;
  threshold: number;
}

export function shouldAutoExpand(index: number, similarity: number, policy: ExpansionPolicy): boolean {
  const withinCount = policy.count < 0 || index < policy.count;
  const aboveThreshold = !policy.thresholdEnabled || similarity >= policy.threshold;
  return withinCount && aboveThreshold;
}
