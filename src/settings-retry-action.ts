/** Keeps a settings action usable even when its asynchronous retry rejects. */
export async function runSettingsRetryAction(options: {
  retry(): Promise<void>;
  reportFailure(): void;
  redraw(): void;
}): Promise<void> {
  try {
    await options.retry();
  } catch {
    options.reportFailure();
  } finally {
    options.redraw();
  }
}
