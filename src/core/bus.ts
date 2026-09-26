// Tiny typed event bus used to decouple systems (UI, audio, sim).
type Handler = (payload: any) => void;

export class Bus {
  private handlers = new Map<string, Set<Handler>>();
  on(evt: string, fn: Handler): () => void {
    if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
    this.handlers.get(evt)!.add(fn);
    return () => this.handlers.get(evt)?.delete(fn);
  }
  emit(evt: string, payload?: any) {
    this.handlers.get(evt)?.forEach((fn) => fn(payload));
  }
}
