import { Howl, Howler } from 'howler';
import { useSettings } from './settings';

export type Sfx =
  | 'deal' | 'flip' | 'coin' | 'spend' | 'turn' | 'challenge' | 'block' | 'assassinate'
  | 'coup' | 'eliminate' | 'tick' | 'victory' | 'defeat' | 'click' | 'chat';

const names: Sfx[] = ['deal', 'flip', 'coin', 'spend', 'turn', 'challenge', 'block', 'assassinate', 'coup', 'eliminate', 'tick', 'victory', 'defeat', 'click', 'chat'];
const cache = new Map<Sfx, Howl>();
let music: Howl | null = null;

function get(name: Sfx): Howl {
  let h = cache.get(name);
  if (!h) {
    h = new Howl({ src: [`/assets/sounds/${name}.wav`], preload: true });
    cache.set(name, h);
  }
  return h;
}

export const sound = {
  preload() {
    names.forEach(get);
  },
  play(name: Sfx, volume = 1) {
    const s = useSettings.getState();
    if (s.sfxMuted || s.sfxVolume <= 0) return;
    const h = get(name);
    const id = h.play();
    h.volume(Math.min(1, s.sfxVolume * volume), id);
  },
  startMusic() {
    const s = useSettings.getState();
    if (!music) music = new Howl({ src: ['/assets/sounds/music.wav'], loop: true, volume: 0 });
    if (!music.playing()) music.play();
    music.fade(music.volume(), s.musicMuted ? 0 : s.musicVolume * 0.6, 1200);
  },
  applyVolumes() {
    const s = useSettings.getState();
    if (music) music.volume(s.musicMuted ? 0 : s.musicVolume * 0.6);
  },
};

useSettings.subscribe(() => sound.applyVolumes());
Howler.autoUnlock = true;
