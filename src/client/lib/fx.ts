import type { GameEvent } from '../../shared/types';

type Listener = (e: GameEvent) => void;
const listeners = new Set<Listener>();

/** Simple event bus for animation / sound effects driven by authoritative server events. */
export const fxBus = {
  on(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  emit(events: GameEvent[]) {
    for (const e of events) for (const l of listeners) l(e);
  },
};
