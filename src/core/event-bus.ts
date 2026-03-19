import type { AppEvents } from '../types.js';

type Handler<T> = (data: T) => void;

export class EventBus {
  private listeners = new Map<string, Set<Handler<unknown>>>();

  on<K extends keyof AppEvents>(event: K, handler: Handler<AppEvents[K]>): void {
    if (!this.listeners.has(event as string)) {
      this.listeners.set(event as string, new Set());
    }
    this.listeners.get(event as string)!.add(handler as Handler<unknown>);
  }

  off<K extends keyof AppEvents>(event: K, handler: Handler<AppEvents[K]>): void {
    this.listeners.get(event as string)?.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof AppEvents>(event: K, ...args: AppEvents[K] extends void ? [] : [data: AppEvents[K]]): void {
    const data = (args as unknown[])[0] as AppEvents[K];
    const handlers = this.listeners.get(event as string);
    if (!handlers) return;
    for (const fn of handlers) {
      try { fn(data); } catch (e) { console.error(`EventBus error in '${event as string}':`, e); }
    }
  }

  subscribe<K extends keyof AppEvents>(event: K, handler: Handler<AppEvents[K]>): () => void {
    this.on(event, handler);
    return () => { this.off(event, handler); };
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const bus = new EventBus();
