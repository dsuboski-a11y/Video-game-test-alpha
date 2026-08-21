/**
 * Sprite models: every unit described as a small stack of solids in model
 * space, from which the sprite compiler bakes real pixel art at 16 facings.
 *
 * Model space is x forward, y right, z up, in world units. `m` selects a
 * material from the team ramp.
 *
 * The two mech poses are the important part. They hold the *same parts in the
 * same order*, so the transformation is a genuine interpolation rather than a
 * cut: the legs swing back and shrink into tail fins, the shoulders sweep out
 * and flatten into wings, the torso stretches into a fuselage, the head slides
 * forward into a nose, and the shoulder cannon tucks under a wing. Watching
 * that happen is half of why the original is remembered, so it is built as an
 * animation rather than a puff of smoke.
 */
export interface Part {
  x: number; y: number; z: number;   // centre
  l: number; w: number; h: number;   // half-extents: length, width, height
  m: number;                          // material index
}

export type Pose = Part[];

export const MAT_TEAM = 0, MAT_ARMOR = 1, MAT_METAL = 2, MAT_DARK = 3,
  MAT_GLOW = 4, MAT_TREAD = 5;

export const MECH_WALKER: Pose = [
  { x: -1, y: -5, z: 5, l: 3, w: 2.3, h: 5, m: MAT_ARMOR },          // left leg
  { x: -1, y: 5, z: 5, l: 3, w: 2.3, h: 5, m: MAT_ARMOR },           // right leg
  { x: 0, y: 0, z: 14, l: 5, w: 6.5, h: 5.5, m: MAT_TEAM },          // torso
  { x: -1, y: -8.5, z: 17.5, l: 3.6, w: 2.6, h: 3, m: MAT_ARMOR },   // left shoulder
  { x: -1, y: 8.5, z: 17.5, l: 3.6, w: 2.6, h: 3, m: MAT_ARMOR },    // right shoulder
  { x: 1.5, y: 0, z: 20.5, l: 2.4, w: 2.6, h: 2, m: MAT_METAL },     // head
  { x: 10, y: 7.5, z: 17.5, l: 7, w: 1.4, h: 1.4, m: MAT_DARK },     // shoulder cannon
  { x: 3.6, y: 0, z: 20.8, l: 0.8, w: 2, h: 0.8, m: MAT_GLOW },      // visor
];

export const MECH_JET: Pose = [
  { x: -10, y: -2.5, z: 4, l: 2.5, w: 0.8, h: 3.5, m: MAT_ARMOR },   // left tail fin
  { x: -10, y: 2.5, z: 4, l: 2.5, w: 0.8, h: 3.5, m: MAT_ARMOR },    // right tail fin
  { x: 1, y: 0, z: 2, l: 13, w: 2.6, h: 2.2, m: MAT_TEAM },          // fuselage
  { x: -3, y: -7.5, z: 1.6, l: 3.5, w: 6.5, h: 0.8, m: MAT_ARMOR },  // left wing
  { x: -3, y: 7.5, z: 1.6, l: 3.5, w: 6.5, h: 0.8, m: MAT_ARMOR },   // right wing
  { x: 11.5, y: 0, z: 2, l: 4, w: 1.4, h: 1.2, m: MAT_METAL },       // nose
  { x: -1, y: 4.5, z: 0.4, l: 4, w: 1.1, h: 1.1, m: MAT_DARK },      // wing pod
  { x: 5.5, y: 0, z: 3.6, l: 2.6, w: 1.6, h: 0.9, m: MAT_GLOW },     // canopy
];

/** Straight-line blend between the two poses. Because the parts correspond one
 *  to one, every intermediate frame is a coherent machine mid-fold. */
export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const k = (p: number, q: number) => p + (q - p) * t;
  return a.map((p, i) => ({
    x: k(p.x, b[i].x), y: k(p.y, b[i].y), z: k(p.z, b[i].z),
    l: k(p.l, b[i].l), w: k(p.w, b[i].w), h: k(p.h, b[i].h),
    m: p.m,
  }));
}

export const UNIT_POSES: Record<string, Pose> = {
  INFANTRY: [
    { x: 0, y: 0, z: 3, l: 1.8, w: 2, h: 3, m: MAT_ARMOR },
    { x: 0, y: 0, z: 7.5, l: 2.4, w: 2.8, h: 3, m: MAT_TEAM },
    { x: 0.5, y: 0, z: 11.5, l: 1.7, w: 1.8, h: 1.6, m: MAT_METAL },
    { x: 3, y: 2, z: 8, l: 3, w: 0.7, h: 0.7, m: MAT_DARK },
  ],
  BIKE: [
    { x: 0, y: 0, z: 2, l: 5.5, w: 1.5, h: 2, m: MAT_ARMOR },
    { x: -1, y: 0, z: 5, l: 2.2, w: 1.8, h: 1.7, m: MAT_TEAM },
    { x: 2.8, y: 0, z: 5.2, l: 1.2, w: 1.2, h: 1.3, m: MAT_METAL },
    { x: 5, y: 0, z: 3.4, l: 2.2, w: 0.6, h: 0.6, m: MAT_DARK },
  ],
  ARMOR: [
    { x: 0, y: 0, z: 1.4, l: 7, w: 5, h: 1.4, m: MAT_TREAD },
    { x: 0, y: 0, z: 4, l: 6.4, w: 4.4, h: 2.2, m: MAT_ARMOR },
    { x: -0.5, y: 0, z: 7.6, l: 3.8, w: 3.4, h: 1.8, m: MAT_TEAM },
    { x: 6, y: 0, z: 7.6, l: 4.2, w: 0.8, h: 0.8, m: MAT_DARK },
  ],
  TANK: [
    { x: 0, y: -5.6, z: 2.2, l: 9, w: 1.7, h: 2.2, m: MAT_TREAD },
    { x: 0, y: 5.6, z: 2.2, l: 9, w: 1.7, h: 2.2, m: MAT_TREAD },
    { x: 0, y: 0, z: 3.6, l: 8, w: 4.6, h: 2.2, m: MAT_ARMOR },
    { x: -1, y: 0, z: 7.6, l: 4.6, w: 4, h: 2.2, m: MAT_TEAM },
    { x: 7.5, y: 0, z: 8, l: 6.5, w: 0.9, h: 0.9, m: MAT_DARK },
  ],
  AA: [
    { x: 0, y: 0, z: 1.4, l: 6.8, w: 4.6, h: 1.4, m: MAT_TREAD },
    { x: 0, y: 0, z: 4, l: 6.2, w: 4.2, h: 2.2, m: MAT_ARMOR },
    { x: -1.5, y: 0, z: 7, l: 2.8, w: 2.8, h: 1.4, m: MAT_TEAM },
    { x: 2, y: -1.7, z: 9.4, l: 5.4, w: 0.7, h: 0.7, m: MAT_DARK },
    { x: 2, y: 1.7, z: 9.4, l: 5.4, w: 0.7, h: 0.7, m: MAT_DARK },
  ],
  ARTILLERY: [
    { x: 0, y: 0, z: 1.4, l: 7.4, w: 4.8, h: 1.4, m: MAT_TREAD },
    { x: 0, y: 0, z: 4, l: 7, w: 4.4, h: 2.2, m: MAT_ARMOR },
    { x: -2.5, y: 0, z: 7, l: 3.4, w: 3.4, h: 1.8, m: MAT_TEAM },
    { x: 2, y: 0, z: 9.4, l: 6, w: 3, h: 1.4, m: MAT_DARK },
    { x: 3, y: 0, z: 11.2, l: 5.4, w: 2.6, h: 0.6, m: MAT_GLOW },
  ],
  SUPPLY: [
    { x: 0, y: 0, z: 1.2, l: 8, w: 4.2, h: 1.2, m: MAT_TREAD },
    { x: 3.5, y: 0, z: 4, l: 3, w: 3.6, h: 2.8, m: MAT_TEAM },
    { x: -3, y: 0, z: 4.6, l: 4.8, w: 4, h: 3.4, m: MAT_METAL },
  ],
};
