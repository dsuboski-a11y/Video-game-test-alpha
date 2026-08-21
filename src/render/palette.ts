/** One place for every colour, so the whole game reads as a single system and
 *  a re-skin (or a colour-blind palette) is a one-file change. */
export const PAL = {
  bg: '#05070d',
  // Four near-identical shades per terrain, picked by a spatial hash. Enough
  // variation to break up a large field, small enough that it never reads as
  // a pattern.
  water: ['#0b1a35', '#0d1e3c', '#102343', '#0c1b38'],
  plains: ['#111a24', '#141f2b', '#17232f', '#121c27'],
  rough: ['#1d222e', '#202634', '#232937', '#1f2531'],
  grid: 'rgba(120,180,255,0.045)',
  contour: 'rgba(140,200,255,0.10)',
  shore: 'rgba(126,196,255,0.30)',
  speck: 'rgba(150,190,235,0.10)',

  neutral: '#9fb0c6',
  neutralDim: '#4a5260',

  team: [
    { main: '#35e0c8', glow: 'rgba(53,224,200,0.55)', dark: '#0d5f56', ink: '#062b28' },
    { main: '#ff6b4a', glow: 'rgba(255,107,74,0.55)', dark: '#7a2a17', ink: '#2b0c05' },
  ],

  hpGood: '#5df08a',
  hpWarn: '#ffcf4a',
  hpBad: '#ff5a5a',
  fuel: '#4fb8ff',
  ammo: '#ffd166',

  ui: '#cfe3ff',
  uiDim: 'rgba(207,227,255,0.55)',
  panel: 'rgba(8,13,22,0.86)',
  panelEdge: 'rgba(120,180,255,0.22)',
} as const;

export const teamOf = (owner: number) => (owner === 0 ? PAL.team[0] : PAL.team[1]);
