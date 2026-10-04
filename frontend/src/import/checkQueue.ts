/**
 * Dry runs for the import list: each row waits for a pause in editing
 * (`delayMs`), only its latest schedule counts, and at most `limit` run at
 * once. Answers are matched to rows by version elsewhere; this only paces.
 */

export interface CheckQueue {
  schedule(id: string, version: number): void;
  cancel(id: string): void;
  cancelAll(): void;
}

export function createCheckQueue(opts: {
  run: (id: string, version: number) => Promise<void>; delayMs?: number; limit?: number;
}): CheckQueue {
  const delay = opts.delayMs ?? 400;
  const limit = opts.limit ?? 3;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let waiting: { id: string; version: number }[] = [];
  let active = 0;

  const pump = () => {
    while (active < limit && waiting.length > 0) {
      const job = waiting.shift() as { id: string; version: number };
      active += 1;
      opts.run(job.id, job.version)
        .catch(() => {}) // the run reports its own failure; the queue only keeps going
        .finally(() => { active -= 1; pump(); });
    }
  };
  const cancel = (id: string) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
    waiting = waiting.filter((j) => j.id !== id);
  };

  return {
    schedule(id, version) {
      cancel(id);
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        waiting.push({ id, version });
        pump();
      }, delay));
    },
    cancel,
    cancelAll() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      waiting = [];
    },
  };
}
