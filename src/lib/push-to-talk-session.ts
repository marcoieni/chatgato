import { setPushToTalk } from "./codex-controller.js";

type PushToTalkSetter = (active: boolean) => Promise<void>;

export class PushToTalkSession {
  private readonly activeActions = new Set<string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly setter: PushToTalkSetter = setPushToTalk) {}

  async press(actionId: string): Promise<boolean> {
    if (this.activeActions.has(actionId)) return false;
    const shouldStart = this.activeActions.size === 0;
    this.activeActions.add(actionId);
    if (!shouldStart) return false;

    try {
      await this.setActive(true);
      return true;
    } catch (error) {
      this.activeActions.clear();
      try {
        await this.setActive(false);
      } catch {
        // Preserve the start failure; the best-effort release is already queued.
      }
      throw error;
    }
  }

  async release(actionId: string): Promise<boolean> {
    if (!this.activeActions.delete(actionId) || this.activeActions.size > 0)
      return false;
    await this.setActive(false);
    return true;
  }

  private setActive(active: boolean): Promise<void> {
    const operation = this.queue.then(() => this.setter(active));
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}

export const pushToTalkSession = new PushToTalkSession();
