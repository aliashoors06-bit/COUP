import { motion } from 'framer-motion';
import type { PublicGameState, RoomState } from '../../shared/types';
import { request } from '../lib/socket';
import { useStore } from '../lib/store';
import { GameCard } from './GameCard';
import { Particles } from './Particles';
import { Avatar, Button } from './ui';

function fmt(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export function GameOver({ game, room, meId }: { game: PublicGameState; room: RoomState | null; meId: string }) {
  const toast = useStore((s) => s.toast);
  const leaveRoom = useStore((s) => s.leaveRoom);
  const sum = game.summary;
  const winner = game.players.find((p) => p.id === game.winnerId);
  if (!sum || !winner) return null;
  const iWon = winner.id === meId;
  const isHost = room?.hostId === meId;
  const lobbyMe = room?.players.find((p) => p.id === meId);
  const humans = room?.players.filter((p) => !p.isBot) ?? [];
  const votes = humans.filter((p) => p.rematchVote).length;

  const call = async (ev: string, payload?: unknown) => {
    const r = await request(ev, payload);
    if (!r.ok) toast(r.error ?? 'Request failed', 'error');
  };

  const stats: [string, string | number][] = [
    ['Match duration', fmt(sum.durationMs)],
    ['Turns', sum.turns],
    ['Coups performed', sum.coups],
    ['Assassinations attempted', sum.assassinationsAttempted],
    ['Successful challenges', sum.successfulChallenges],
    ['Failed challenges', sum.failedChallenges],
    ['Successful blocks', sum.successfulBlocks],
    ['Coins earned', sum.coinsEarned],
  ];

  return (
    <motion.div className="fixed inset-0 z-[60] overflow-y-auto bg-black/55 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }}>
      <Particles count={120} color="220,224,232" burst />
      <div className="relative mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center gap-5 px-4 py-8">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 1.4, type: 'spring' }} className="text-center">
          <div className="font-display text-xs uppercase tracking-[0.5em] text-champagne/80">{iWon ? 'Victory' : 'The court has fallen'}</div>
          <div className="mt-3 flex items-center justify-center gap-4">
            <Avatar avatar={winner.avatar} size={72} className="shadow-[0_0_30px_rgba(220,224,232,.6)]" />
            <div className="silver-text font-deco text-4xl tracking-[0.12em] sm:text-6xl">{iWon ? 'You win!' : `${winner.name} wins`}</div>
          </div>
          {iWon && (
            <div className="mt-4 flex justify-center gap-3">
              {(sum.finalHands[meId] ?? []).map((r, i) => (
                <GameCard key={i} role={r} width={92} />
              ))}
            </div>
          )}
        </motion.div>

        <div className="deco-panel w-full p-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
            {stats.map(([k, v]) => (
              <div key={k}>
                <div className="text-[10px] uppercase tracking-[0.2em] text-ivory/50">{k}</div>
                <div className="font-display text-lg font-bold text-ivory">{v}</div>
              </div>
            ))}
          </div>
          <div className="deco-rule my-4" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-xs">
              <thead className="text-champagne/80">
                <tr>
                  <th className="py-1">Player</th>
                  <th>Claims</th>
                  <th>Proven</th>
                  <th>Bluffs</th>
                  <th>Caught</th>
                  <th>Got away</th>
                  <th>Challenges won/lost</th>
                  <th>Blocks</th>
                </tr>
              </thead>
              <tbody>
                {game.players.map((p) => {
                  const s = sum.perPlayer[p.id]!;
                  return (
                    <tr key={p.id} className={p.id === winner.id ? 'text-champagne' : 'text-ivory/85'}>
                      <td className="py-1 font-bold">
                        {p.name}
                        {p.id === meId ? ' (you)' : ''}
                      </td>
                      <td>{s.claimsMade}</td>
                      <td>{s.claimsProven}</td>
                      <td>{s.bluffsMade}</td>
                      <td>{s.bluffsCaught}</td>
                      <td>{s.bluffsUndetected}</td>
                      <td>
                        {s.challengesWon}/{s.challengesLost}
                      </td>
                      <td>{s.blocksSuccessful}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="gold" disabled={lobbyMe?.rematchVote} onClick={() => call('game:rematch', { ready: true })}>
            {lobbyMe?.rematchVote ? `Waiting (${votes}/${humans.length})` : `Rematch${humans.length > 1 ? ` (${votes}/${humans.length})` : ''}`}
          </Button>
          {!room?.practice && isHost && <Button onClick={() => call('room:toLobby')}>Return to Lobby</Button>}
          <Button variant="danger" onClick={() => leaveRoom()}>
            Leave Room
          </Button>
        </div>
        {!room?.practice && !isHost && <p className="text-xs text-ivory/50">The host can return everyone to the lobby.</p>}
      </div>
    </motion.div>
  );
}
