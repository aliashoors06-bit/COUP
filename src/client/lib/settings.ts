import { create } from 'zustand';
import { storage } from './util';

export interface UserSettings {
  musicVolume: number;
  sfxVolume: number;
  musicMuted: boolean;
  sfxMuted: boolean;
  motion: 'full' | 'reduced' | 'off';
  highContrast: boolean;
  lastName: string;
  lastAvatar: string;
}

const prefersReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const defaults: UserSettings = {
  musicVolume: 0.35,
  sfxVolume: 0.7,
  musicMuted: false,
  sfxMuted: false,
  motion: prefersReduced ? 'reduced' : 'full',
  highContrast: false,
  lastName: '',
  lastAvatar: 'duke',
};

interface SettingsStore extends UserSettings {
  update: (patch: Partial<UserSettings>) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...defaults,
  ...storage.get<Partial<UserSettings>>('coup.settings', {}),
  update(patch) {
    set(patch);
    const { update: _u, ...rest } = { ...get(), ...patch };
    storage.set('coup.settings', rest);
  },
}));
