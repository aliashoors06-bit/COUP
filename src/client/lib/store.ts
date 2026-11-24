import { create } from 'zustand';
import type { ChatMessage, GameCommand, GameUpdate, PrivateState, PublicGameState, RoomState } from '../../shared/types';
import { socket, request, type Ack } from './socket';
import { fxBus } from './fx';
import { storage, uid } from './util';
import { sound } from './sound';

export type Screen = 'menu' | 'create' | 'join' | 'howto' | 'practice' | 'settings' | 'credits' | 'lobby' | 'game';

interface Session {
  code: string;
  playerId: string;
  token: string;
}

interface Toast {
  id: string;
  text: string;
  kind: 'info' | 'error';
}

interface AppStore {
  screen: Screen;
  connected: boolean;
  session: Session | null;
  room: RoomState | null;
  game: PublicGameState | null;
  priv: PrivateState | null;
  clockOffset: number;
  chat: ChatMessage[];
  unreadChat: number;
  muted: string[];
  toasts: Toast[];
  inviteCode: string | null;
  busy: boolean;

  go: (s: Screen) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: string) => void;
  createRoom: (name: string, avatar: string) => Promise<Ack>;
  joinRoom: (name: string, avatar: string, code: string) => Promise<Ack>;
  startPractice: (name: string, avatar: string, difficulty: string) => Promise<Ack>;
  leaveRoom: () => Promise<void>;
  send: (command: GameCommand) => Promise<Ack>;
  toggleMute: (playerId: string) => void;
  markChatRead: () => void;
  serverNow: () => number;
}

const SESSION_KEY = 'coup.session';

export const useStore = create<AppStore>((set, get) => ({
  screen: 'menu',
  connected: socket.connected,
  session: storage.get<Session | null>(SESSION_KEY, null),
  room: null,
  game: null,
  priv: null,
  clockOffset: 0,
  chat: [],
  unreadChat: 0,
  muted: storage.get<string[]>('coup.muted', []),
  toasts: [],
  inviteCode: null,
  busy: false,

  go: (screen) => set({ screen }),

  toast(text, kind = 'info') {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 4500 : 3200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  async createRoom(name, avatar) {
    set({ busy: true });
    const res = await request('room:create', { name, avatar });
    set({ busy: false });
    if (res.ok) adoptSession(res);
    return res;
  },
  async joinRoom(name, avatar, code) {
    set({ busy: true });
    const res = await request('room:join', { name, avatar, code });
    set({ busy: false });
    if (res.ok) adoptSession(res);
    return res;
  },
  async startPractice(name, avatar, difficulty) {
    set({ busy: true });
    const res = await request('practice:create', { name, avatar, difficulty });
    set({ busy: false });
    if (res.ok) adoptSession(res, 'game');
    return res;
  },
  async leaveRoom() {
    await request('room:leave');
    clearSession();
    set({ screen: 'menu' });
  },
  async send(command) {
    const prompt = get().game?.prompt;
    const res = await request('game:command', { actionId: uid(), promptId: prompt?.id ?? -1, command });
    if (!res.ok && res.error) get().toast(res.error, 'error');
    return res;
  },
  toggleMute(playerId) {
    const muted = get().muted.includes(playerId) ? get().muted.filter((m) => m !== playerId) : [...get().muted, playerId];
    storage.set('coup.muted', muted);
    set({ muted });
  },
  markChatRead: () => set({ unreadChat: 0 }),
  serverNow: () => Date.now() + get().clockOffset,
}));

function adoptSession(res: Ack, screen: Screen = 'lobby') {
  const session = { code: String(res.code), playerId: String(res.playerId), token: String(res.token) };
  storage.set(SESSION_KEY, session);
  useStore.setState({ session, screen, chat: [], game: null, priv: null, unreadChat: 0 });
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.has('room')) {
      u.searchParams.delete('room');
      window.history.replaceState(null, '', u.toString());
    }
  } catch {
    /* ignore */
  }
}

function clearSession() {
  storage.remove(SESSION_KEY);
  useStore.setState({ session: null, room: null, game: null, priv: null, chat: [] });
}

// ───────────── Socket wiring ─────────────

async function tryResume() {
  const s = useStore.getState().session;
  if (!s) return;
  const res = await request('room:resume', { code: s.code, token: s.token });
  if (!res.ok) {
    clearSession();
    if (useStore.getState().screen === 'lobby' || useStore.getState().screen === 'game') useStore.setState({ screen: 'menu' });
    useStore.getState().toast('Your previous session has ended.', 'info');
  }
}

socket.on('connect', () => {
  useStore.setState({ connected: true });
  void tryResume();
});
socket.on('disconnect', () => useStore.setState({ connected: false }));

socket.on('room:state', (room: RoomState) => {
  const st = useStore.getState();
  const patch: Partial<AppStore> = { room };
  if (room.status !== 'lobby' && (st.screen === 'lobby' || st.screen === 'menu')) patch.screen = 'game';
  if (room.status === 'lobby' && st.screen === 'game') patch.screen = 'lobby';
  if (room.status === 'lobby' && st.screen === 'menu' && st.session) patch.screen = 'lobby';
  useStore.setState(patch);
});

socket.on('game:update', (u: GameUpdate & { serverNow: number }) => {
  const st = useStore.getState();
  // Ignore out-of-order snapshots.
  if (st.game && u.state.version < st.game.version && u.state.startedAt === st.game.startedAt) return;
  const offset = u.serverNow - Date.now();
  useStore.setState({
    game: u.state,
    priv: u.private,
    clockOffset: st.clockOffset === 0 ? offset : st.clockOffset * 0.7 + offset * 0.3,
    screen: st.screen === 'lobby' || st.screen === 'menu' ? 'game' : st.screen,
  });
  if (u.events.length) fxBus.emit(u.events);
});

socket.on('game:cleared', () => useStore.setState({ game: null, priv: null, screen: 'lobby' }));

socket.on('chat:history', (chat: ChatMessage[]) => useStore.setState({ chat }));
socket.on('chat:message', (m: ChatMessage) => {
  const st = useStore.getState();
  if (m.playerId && st.muted.includes(m.playerId)) return;
  useStore.setState({ chat: [...st.chat.slice(-99), m], unreadChat: st.unreadChat + (m.kind === 'chat' ? 1 : 0) });
  if (m.kind === 'chat' && m.playerId !== st.session?.playerId) sound.play('chat', 0.6);
  if (m.kind === 'reaction') window.dispatchEvent(new CustomEvent('coup:reaction', { detail: m }));
});

socket.on('room:kicked', () => {
  clearSession();
  useStore.setState({ screen: 'menu' });
  useStore.getState().toast('You were removed from the room by the host.', 'error');
});
socket.on('room:replaced', () => {
  useStore.setState({ screen: 'menu', session: null, room: null, game: null });
  useStore.getState().toast('This seat was opened in another tab.', 'info');
});

// Invitation links: /?room=ABC123
try {
  const code = new URL(window.location.href).searchParams.get('room');
  if (code) useStore.setState({ inviteCode: code.toUpperCase().slice(0, 6), screen: 'join' });
} catch {
  /* ignore */
}
