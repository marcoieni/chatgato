export type PollingTask = () => Promise<void>;

export type PollingErrorHandler = (error: unknown) => void | Promise<void>;

type ActivePoll = {
  intervalMs: number;
  onError: PollingErrorHandler;
  task: PollingTask;
  timer: NodeJS.Timeout | null;
};

export function pollIntervalMs(
  value: unknown,
  fallbackSeconds: number,
  minSeconds: number,
  maxSeconds: number,
): number {
  const seconds = Math.min(
    maxSeconds,
    Math.max(minSeconds, Number(value) || fallbackSeconds),
  );
  return seconds * 1000;
}

export class ActionPoller {
  private readonly activePolls = new Map<string, ActivePoll>();

  async start(
    id: string,
    task: PollingTask,
    intervalMs: number,
    onError: PollingErrorHandler = () => undefined,
  ): Promise<void> {
    this.stop(id);
    const poll: ActivePoll = { intervalMs, onError, task, timer: null };
    this.activePolls.set(id, poll);
    try {
      await poll.task();
    } catch (error) {
      if (this.activePolls.get(id) === poll) this.activePolls.delete(id);
      throw error;
    }
    if (this.activePolls.get(id) !== poll) return;
    this.schedule(id, poll);
  }

  stop(id: string): void {
    const poll = this.activePolls.get(id);
    if (poll?.timer) clearTimeout(poll.timer);
    this.activePolls.delete(id);
  }

  private schedule(id: string, poll: ActivePoll): void {
    const timer = setTimeout(() => {
      if (this.activePolls.get(id) !== poll || poll.timer !== timer) return;
      poll.timer = null;
      void this.runAndSchedule(id, poll);
    }, poll.intervalMs);
    timer.unref();
    poll.timer = timer;
  }

  private async runAndSchedule(id: string, poll: ActivePoll): Promise<void> {
    try {
      await poll.task();
    } catch (error) {
      try {
        await poll.onError(error);
      } catch {
        // Polling continues even if reporting the failure also fails.
      }
    }
    if (this.activePolls.get(id) === poll) {
      this.schedule(id, poll);
    }
  }
}
