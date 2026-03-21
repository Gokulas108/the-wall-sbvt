// Server-side event bus — global singleton (survives hot reloads)
type Listener = (data: unknown) => void;

class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => { this.listeners.get(event)?.delete(fn); };
  }

  emit(event: string, data: unknown) {
    this.listeners.get(event)?.forEach((fn) => fn(data));
  }
}

const g = globalThis as unknown as { __eventBus?: EventBus };
export const eventBus = (g.__eventBus ??= new EventBus());
