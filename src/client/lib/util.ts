/** UUID that also works in insecure contexts (plain http on a LAN IP). */
export function uid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      /* fall through */
    }
  }
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  },
};

export function cls(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ');
}

export const cardImg = (role: string) => `/assets/cards/${role}.png`;
export const avatarImg = (a: string) => `/assets/icons/avatar-${a}.png`;

export function preloadImages(urls: string[]) {
  for (const u of urls) {
    const i = new Image();
    i.src = u;
  }
}
