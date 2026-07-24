import { IndexLoadResult } from "./index-store";

/** Keeps the recovery wording stable and intentionally hides IndexedDB internals. */
export function indexLoadRecoveryMessage(result: IndexLoadResult): string | undefined {
  return result.status === "ready" && result.recovery === "used-previous-generation"
    ? "本地索引已回退到上一份可用版本，建议稍后全量重建。"
    : undefined;
}
