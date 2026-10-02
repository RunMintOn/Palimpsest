export interface ExpansionPolicy {
  /** -1 means all results; 0 means all collapsed. */
  count: number;
}

export function shouldAutoExpand(index: number, policy: ExpansionPolicy): boolean {
  return policy.count < 0 || index < policy.count;
}
