/** Shared confirmation gate for a prepared incremental batch. */
export async function runPreparedIncrementalIndexUpdate<T>(actions: {
  needsConfirmation: boolean;
  confirm(): Promise<boolean>;
  execute(): Promise<T>;
  commit(result: T): Promise<void>;
}): Promise<"cancelled" | "committed"> {
  if (actions.needsConfirmation && !await actions.confirm()) return "cancelled";
  const result = await actions.execute();
  await actions.commit(result);
  return "committed";
}
