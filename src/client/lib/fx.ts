import type { GameEvent } from '../../shared/types';

type Listener = (e: GameEvent) => void;
type BatchListener = (events: GameEvent[]) => void;
const listeners = new Set<Listener>();
const batchListeners = new Set<BatchListener>();

/**
 * Event bus for animations and sounds. It only carries events confirmed by the server
 * (attached to a game:update), so the client never animates guesses, and a reconnect
 * snapshot (which carries no events) never replays old transactions.
 */
export const fxBus = {
  on(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  onBatch(fn: BatchListener) {
    batchListeners.add(fn);
    return () => {
      batchListeners.delete(fn);
    };
  },
  emit(events: GameEvent[]) {
    for (const l of batchListeners) l(events);
    for (const e of events) for (const l of listeners) l(e);
  },
};
