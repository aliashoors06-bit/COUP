import { useEffect, useState } from 'react';
import { ACTION_META, MANDATORY_COUP_AT, ROLE_META, type ActionType, type Role } from '../../shared/constants';
import type { PublicGameState, PublicPlayer } from '../../shared/types';
import { useStore } from './store';

export const roleLabel = (r: Role) => ROLE_META[r].label;

/** Re-render periodically with the server-synchronised clock. */
export function useServerNow(interval = 200) {
  const serverNow = useStore((s) => s.serverNow);
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), interval);
    return () => clearInterval(t);
  }, [interval, serverNow]);
  return now;
}

export function nameOf(game: PublicGameState, id: string | null | undefined): string {
  if (!id) return '';
  return game.players.find((p) => p.id === id)?.name ?? 'Someone';
}

export function isMyPrompt(game: PublicGameState | null, me: string | undefined): boolean {
  const pr = game?.prompt;
  return !!pr && !!me && pr.playerIds.includes(me) && !pr.responded.includes(me);
}

export interface ActionAvailability {
  enabled: boolean;
  reason?: string;
}

export function actionAvailability(game: PublicGameState, me: PublicPlayer | undefined, action: ActionType): ActionAvailability {
  if (!me) return { enabled: false, reason: 'Spectating' };
  if (me.eliminated) return { enabled: false, reason: 'You have been exiled' };
  if (game.phase !== 'WAITING_FOR_ACTION' || game.currentPlayerId !== me.id) return { enabled: false, reason: 'Not your turn' };
  if (me.coins >= MANDATORY_COUP_AT && action !== 'coup') return { enabled: false, reason: '10+ coins: you must Coup' };
  const meta = ACTION_META[action];
  if (me.coins < meta.cost) return { enabled: false, reason: `Needs ${meta.cost} coins` };
  if (meta.targeted && validTargets(game, me.id).length === 0) return { enabled: false, reason: 'No valid targets' };
  return { enabled: true };
}

export function validTargets(game: PublicGameState, meId: string): PublicPlayer[] {
  return game.players.filter((p) => p.id !== meId && !p.eliminated);
}

const VERB: Record<ActionType, [string, string]> = {
  income: ['take Income', 'takes Income'],
  foreign_aid: ['take Foreign Aid', 'takes Foreign Aid'],
  coup: ['launch a Coup against', 'launches a Coup against'],
  tax: ['collect Tax', 'collects Tax'],
  assassinate: ['assassinate', 'assassinates'],
  steal: ['steal from', 'steals from'],
  exchange: ['exchange with the Court Deck', 'exchanges with the Court Deck'],
};

function actionPhrase(game: PublicGameState, me: string | undefined, n: (id: string | null | undefined) => string): string {
  const pd = game.pending;
  if (!pd) return '';
  const you = pd.actorId === me;
  const target = pd.targetId ? ` ${n(pd.targetId)}` : '';
  if (pd.claim) return `${n(pd.actorId)} ${you ? 'claim' : 'claims'} ${roleLabel(pd.claim)} to ${VERB[pd.action][0]}${target}`;
  return `${n(pd.actorId)} ${VERB[pd.action][you ? 0 : 1]}${target}`;
}

/** Headline + subline describing the current moment, for the centre of the table. */
export function describeMoment(game: PublicGameState, me: string | undefined): { title: string; sub: string; role: Role | null } {
  const pd = game.pending;
  const pr = game.prompt;
  const n = (id: string | null | undefined) => (id === me ? 'You' : nameOf(game, id));
  const cur = game.currentPlayerId;
  if (game.phase === 'GAME_OVER') return { title: `${nameOf(game, game.winnerId)} wins`, sub: 'The court has a new master.', role: null };
  if (!pr) return { title: '…', sub: '', role: null };
  const phrase = actionPhrase(game, me, n);
  switch (pr.kind) {
    case 'action':
      return cur === me
        ? { title: 'Your turn', sub: 'Choose an action. Any character may be claimed.', role: null }
        : { title: `${nameOf(game, cur)}'s turn`, sub: 'Choosing an action…', role: null };
    case 'action_challenge':
      return { title: phrase, sub: 'Any player may challenge this claim.', role: pd?.claim ?? null };
    case 'prove_action':
      return {
        title: `${n(pd?.challengerId)} challenge${pd?.challengerId === me ? '' : 's'} ${pd?.actorId === me ? 'your' : `${nameOf(game, pd?.actorId)}'s`} ${roleLabel(pr.role!)}!`,
        sub: `${n(pd?.actorId)} must reveal a ${roleLabel(pr.role!)} or concede.`,
        role: pr.role ?? null,
      };
    case 'block': {
      const who = pr.playerIds.length > 1 ? 'Any opponent' : n(pr.playerIds[0]);
      return { title: phrase, sub: `${who} may block with ${pr.blockRoles!.map(roleLabel).join(' or ')}.`, role: pd?.claim ?? null };
    }
    case 'block_challenge':
      return {
        title: `${n(pd?.blockerId)} block${pd?.blockerId === me ? '' : 's'} with ${roleLabel(pd!.blockRole!)}`,
        sub: 'Any player may challenge the block.',
        role: pd?.blockRole ?? null,
      };
    case 'prove_block':
      return {
        title: `${n(pd?.blockChallengerId)} challenge${pd?.blockChallengerId === me ? '' : 's'} the ${roleLabel(pr.role!)} block!`,
        sub: `${n(pd?.blockerId)} must reveal a ${roleLabel(pr.role!)} or concede.`,
        role: pr.role ?? null,
      };
    case 'lose_influence':
      return { title: `${n(pr.playerIds[0])} must lose an influence`, sub: pr.reason ? `${n(pr.playerIds[0])} ${pr.reason}.` : '', role: null };
    case 'exchange':
      return { title: `${n(pr.playerIds[0])} ${pr.playerIds[0] === me ? 'are' : 'is'} consulting the Court Deck`, sub: 'Choosing which cards to keep…', role: 'ambassador' };
  }
}
