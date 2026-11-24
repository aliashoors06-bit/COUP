import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { Toasts } from './components/ui';
import { CreateRoomScreen, JoinRoomScreen, PracticeScreen } from './screens/Entry';
import { Game } from './screens/Game';
import { Credits, HowToPlay, SettingsScreen } from './screens/Info';
import { Lobby } from './screens/Lobby';
import { MainMenu } from './screens/MainMenu';
import { useSettings } from './lib/settings';
import { sound } from './lib/sound';
import { useStore } from './lib/store';
import { cls, preloadImages } from './lib/util';
import { ROLES } from '../shared/constants';

export function App() {
  const screen = useStore((s) => s.screen);
  const highContrast = useSettings((s) => s.highContrast);
  const motionSetting = useSettings((s) => s.motion);

  useEffect(() => {
    preloadImages([
      ...ROLES.map((r) => `/assets/cards/${r}.png`),
      '/assets/cards/card-back.png',
      '/assets/coins/coin-front.png',
      '/assets/coins/coin-angle.png',
      '/assets/coins/coin-stack.png',
      '/assets/backgrounds/game-table.webp',
      '/assets/effects/crack.png',
    ]);
    sound.preload();
    const start = () => sound.startMusic();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }, []);

  const view = (() => {
    switch (screen) {
      case 'menu':
        return <MainMenu />;
      case 'create':
        return <CreateRoomScreen />;
      case 'join':
        return <JoinRoomScreen />;
      case 'practice':
        return <PracticeScreen />;
      case 'howto':
        return <HowToPlay />;
      case 'settings':
        return <SettingsScreen />;
      case 'credits':
        return <Credits />;
      case 'lobby':
        return <Lobby />;
      case 'game':
        return <Game />;
    }
  })();

  return (
    <div className={cls('h-full', highContrast && 'hc', motionSetting === 'off' && 'motion-off')}>
      <AnimatePresence mode="wait">
        <motion.div
          key={screen}
          className="h-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: motionSetting === 'off' ? 0 : 0.35 }}
        >
          {view}
        </motion.div>
      </AnimatePresence>
      <Toasts />
    </div>
  );
}
