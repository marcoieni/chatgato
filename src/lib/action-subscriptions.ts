export type ActionEventSubscriber<Event> = (
  listener: (event: Event) => void,
) => () => void;

/** Owns replace-on-appear and remove-on-disappear action subscriptions. */
export class ActionSubscriptionRegistry {
  private readonly subscriptions = new Map<string, () => void>();

  replace<Event>(
    id: string,
    subscribe: ActionEventSubscriber<Event>,
    refresh: (event: Event) => Promise<void>,
  ): void {
    this.remove(id);
    this.subscriptions.set(
      id,
      subscribe((event) => {
        void refresh(event).catch(() => undefined);
      }),
    );
  }

  remove(id: string): void {
    this.subscriptions.get(id)?.();
    this.subscriptions.delete(id);
  }
}
