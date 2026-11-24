/**
 * Connects confirmed server events to the table animations. Registered once at startup,
 * so an event is never missed while the game screen is still mounting (e.g. the opening
 * deal, which arrives during the lobby → table transition).
 */
import { fxBus } from './fx';
import { useSettings } from './settings';
import { useStore } from './store';
import { animateEvents, resetTableFx } from './tableFx';

let currentGame: number | null = null;

fxBus.onBatch((events) => {
  const st = useStore.getState();
  const g = st.game;
  if (!g) return;
  if (currentGame !== g.startedAt) {
    // A new match (or rematch): drop anything still animating from the previous one.
    currentGame = g.startedAt;
    resetTableFx();
  }
  const motion = useSettings.getState().motion;
  const me = st.session?.playerId ?? '';
  animateEvents(events, {
    me,
    reduced: motion !== 'full',
    physical: motion === 'full',
    names: (id) => (id === me ? 'You' : (g.players.find((p) => p.id === id)?.name ?? '')),
  });
});

// A snapshot without events (first load, reconnect, refresh) just adopts the state.
useStore.subscribe((s, prev) => {
  if (s.game && s.game.startedAt !== prev.game?.startedAt && currentGame !== s.game.startedAt) {
    currentGame = s.game.startedAt;
    resetTableFx();
  }
});
