import { z } from 'zod';
import { ACTIONS, AVATARS, ROLES, TIMER_LIMITS } from './constants.js';

const name = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim())
  .pipe(z.string().min(1, 'Enter a display name').max(16, 'Names are limited to 16 characters'));

export const roomCode = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{6}$/, 'Room codes are six letters or digits'));

const avatar = z.enum(AVATARS);

export const CreateRoomSchema = z.object({ name, avatar });
export const JoinRoomSchema = z.object({ name, avatar, code: roomCode });
export const ResumeSchema = z.object({ code: roomCode, token: z.string().min(16).max(128) });
export const PracticeSchema = z.object({ name, avatar, difficulty: z.enum(['easy', 'medium', 'hard']) });
export const ReadySchema = z.object({ ready: z.boolean() });
export const AvatarSchema = z.object({ avatar });
export const KickSchema = z.object({ playerId: z.string().min(1).max(64) });

const timer = (k: keyof typeof TIMER_LIMITS) => z.number().int().min(TIMER_LIMITS[k][0]).max(TIMER_LIMITS[k][1]);
export const SettingsSchema = z.object({
  timers: z.object({
    turn: timer('turn'),
    challenge: timer('challenge'),
    counter: timer('counter'),
    proof: timer('proof'),
    influence: timer('influence'),
    exchange: timer('exchange'),
  }),
  disconnectPolicy: z.enum(['wait', 'bot']),
  botTakeoverAfter: z.number().int().min(15).max(300),
});

export const ChatSchema = z.object({
  text: z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim())
    .pipe(z.string().min(1).max(200)),
});

export const QUICK_REACTIONS = ['👏', '😂', '😮', '🤔', '😤', '🙏', '🎭', '🗡️'] as const;
export const ReactionSchema = z.object({ emoji: z.enum(QUICK_REACTIONS) });

export const GameCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('action'), action: z.enum(ACTIONS), targetId: z.string().max(64).nullish() }),
  z.object({ type: z.literal('challenge') }),
  z.object({ type: z.literal('pass') }),
  z.object({ type: z.literal('block'), role: z.enum(ROLES) }),
  z.object({ type: z.literal('prove') }),
  z.object({ type: z.literal('concede') }),
  z.object({ type: z.literal('lose'), slot: z.number().int().min(0).max(1) }),
  z.object({ type: z.literal('exchange'), keep: z.array(z.string().max(32)).min(1).max(2) }),
]);

export const CommandEnvelopeSchema = z.object({
  actionId: z.string().min(8).max(64),
  promptId: z.number().int().nonnegative(),
  command: GameCommandSchema,
});
