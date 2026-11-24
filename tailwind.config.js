/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/client/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        midnight: '#101116',
        charcoal: '#16171d',
        navy: { 900: '#141b2b', 800: '#1b2438', 700: '#24304a' },
        champagne: { DEFAULT: '#d6be8c', light: '#ead9b4', dark: '#a68b5b' },
        ivory: '#f3ead8',
        silver: { DEFAULT: '#c9ccd3', dark: '#8a8e97' },
        coupred: '#c8232c',
        cyanglow: '#8fe3ef',
        role: {
          duke: '#8a2433',
          assassin: '#4a2b6b',
          captain: '#22386a',
          ambassador: '#1f6446',
          contessa: '#b8324d',
        },
      },
      fontFamily: {
        deco: ['Limelight', 'Georgia', 'serif'],
        display: ['"Josefin Sans"', 'system-ui', 'sans-serif'],
        body: ['"Josefin Sans"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        deco: '0 0 0 1px rgba(214,190,140,.35), 0 10px 30px -10px rgba(0,0,0,.7)',
        glow: '0 0 0 2px rgba(143,227,239,.9), 0 0 24px 4px rgba(143,227,239,.35)',
      },
    },
  },
  plugins: [],
};
