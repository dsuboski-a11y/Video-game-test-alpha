/** One place for every colour, so the whole game reads as a single system and
 *  a re-skin (or a colour-blind palette) is a one-file change. */
export const PAL = {
  bg: '#05070d',
  // Four near-identical shades per terrain, picked by a spatial hash. Enough
  // variation to break up a large field, small enough that it never reads as
  // a pattern.
  water: ['#123a6b', '#154577', '#1a5089', '#134070'],
  plains: ['#27362c', '#2c3d30', '#314434', '#2a3a2e'],
  rough: ['#3d372f', '#453e34', '#4c453a', '#413a31'],
  grid: 'rgba(120,180,255,0.045)',
  contour: 'rgba(140,200,255,0.10)',
  shore: 'rgba(150,215,255,0.42)',
  speck: 'rgba(190,215,180,0.13)',

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
