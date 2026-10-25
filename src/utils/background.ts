const pending = new Set<Promise<void>>();

/**
 * Runs work after the response is built without making the caller wait for it,
 * so its duration (or whether it ran at all) cannot be observed from outside.
 * Failures are logged with the label only; task errors never reach the client.
 *
 * On serverless hosts the instance may be frozen once the response is sent, so
 * this is for best-effort side effects such as email delivery.
 */
export function runInBackground(label: string, task: () => Promise<void>): void {
  const run: Promise<void> = Promise.resolve()
    .then(task)
    .catch((error: unknown) => {
      console.error(`Background task failed (${label}):`, error instanceof Error ? error.message : error);
    })
    .finally(() => {
      pending.delete(run);
    });
  pending.add(run);
}

/** Test hook: resolves once every task started so far has settled. */
export async function waitForBackgroundTasks(): Promise<void> {
  while (pending.size > 0) await Promise.all(Array.from(pending));
}
