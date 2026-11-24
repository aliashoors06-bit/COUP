import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { AVATARS } from '../../shared/constants';
import { sound } from '../lib/sound';
import { avatarImg, cls } from '../lib/util';
import { useStore } from '../lib/store';

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'gold' | 'ghost' | 'danger' | 'silver' };

export function Button({ variant = 'ghost', className, onClick, children, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={cls('btn', `btn-${variant}`, className)}
      onClick={(e) => {
        sound.play('click', 0.6);
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cls('deco-panel', className)}>{children}</div>;
}

export function DecoHeading({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="text-center">
      <h2 className="deco-title text-3xl sm:text-4xl">{children}</h2>
      <div className="deco-rule mx-auto mt-3 w-48" />
      {sub && <p className="mt-3 text-ivory/70 text-sm tracking-wide">{sub}</p>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  children,
  title,
  className,
  dismissable = true,
}: {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  title?: ReactNode;
  className?: string;
  dismissable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissable, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => dismissable && onClose?.()}
        >
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            className={cls('deco-panel w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto scrollbar-thin', className)}
            initial={{ y: 24, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 12, scale: 0.98, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            {title && <div className="mb-4 text-center font-deco text-2xl tracking-[0.15em] text-champagne">{title}</div>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AvatarPicker({ value, onChange }: { value: string; onChange: (a: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Choose an avatar" className="flex flex-wrap justify-center gap-3">
      {AVATARS.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={value === a}
          aria-label={`Avatar: ${a === 'card-back' ? 'emblem' : a}`}
          onClick={() => {
            sound.play('click', 0.5);
            onChange(a);
          }}
          className={cls(
            'h-14 w-14 overflow-hidden rounded-full border-2 transition sm:h-16 sm:w-16',
            value === a ? 'scale-110 border-champagne shadow-[0_0_18px_rgba(214,190,140,.5)]' : 'border-white/10 opacity-70 hover:opacity-100',
          )}
        >
          <img src={avatarImg(a)} alt="" className="h-full w-full object-cover" draggable={false} />
        </button>
      ))}
    </div>
  );
}

export function Avatar({ avatar, size = 40, className }: { avatar: string; size?: number; className?: string }) {
  return (
    <img
      src={avatarImg(avatar)}
      alt=""
      draggable={false}
      width={size}
      height={size}
      className={cls('rounded-full border border-champagne/50 bg-navy-900 object-cover', className)}
      style={{ width: size, height: size }}
    />
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed left-1/2 top-3 z-[70] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            onClick={() => dismiss(t.id)}
            className={cls(
              'pointer-events-auto rounded border px-4 py-3 text-left text-sm shadow-deco backdrop-blur',
              t.kind === 'error' ? 'border-coupred/70 bg-[#2a1015]/95 text-ivory' : 'border-champagne/40 bg-navy-900/95 text-ivory',
            )}
          >
            {t.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-sm text-ivory/80">
        <span>{label}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#d6be8c]"
      />
    </label>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1 text-sm text-ivory/90">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cls('relative h-6 w-11 rounded-full border transition', checked ? 'border-champagne bg-champagne/40' : 'border-white/20 bg-black/40')}
      >
        <span className={cls('absolute top-0.5 h-4 w-4 rounded-full transition-all', checked ? 'left-6 bg-champagne' : 'left-1 bg-ivory/60')} />
      </button>
    </label>
  );
}

export function CoinIcon({ size = 20, className }: { size?: number; className?: string }) {
  return <img src="/assets/coins/coin-front.png" alt="" width={size} height={size} className={cls('inline-block drop-shadow', className)} style={{ width: size, height: size }} draggable={false} />;
}
