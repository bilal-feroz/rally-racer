// Stage layout for "Black Pine Ridge" — designed as a sequence of turtle segments.
// Arc angles: positive = left turn, negative = right turn.
// rise: elevation change across the segment (m). bank: degrees of banking into the turn
// (negative = off-camber). hw: road half-width (m).

export interface JumpDef {
  /** position along the segment as 0..1 */
  at: number;
  /** lip height above the underlying profile (m) */
  h: number;
  /** approach ramp length (m) */
  la: number;
  /** landing fall-off length (m) */
  ld: number;
}

export interface SegmentDef {
  kind: 's' | 'a';
  len?: number;
  r?: number;
  ang?: number;
  rise?: number;
  bank?: number;
  hw?: number;
  tag?: string;
  jump?: JumpDef;
}

export interface StageDesign {
  name: string;
  start: { x: number; z: number; heading: number; y: number };
  defaultHalfWidth: number;
  segments: SegmentDef[];
  /** distance (m) after the start line where the finish line sits is computed from the 'finish' tag */
}

export const STAGE: StageDesign = {
  name: 'Black Pine Ridge',
  start: { x: 0, z: 0, heading: 0, y: 60 },
  defaultHalfWidth: 3.9,
  segments: [
    { kind: 's', len: 70, rise: 0, hw: 4.6, tag: 'start' },
    { kind: 's', len: 250, rise: -7 },
    { kind: 'a', r: 240, ang: -36, rise: -2, bank: 4, tag: 'sweeper' },
    { kind: 's', len: 100, rise: 3 },
    { kind: 's', len: 70, rise: -5, jump: { at: 0.05, h: 1.15, la: 30, ld: 24 }, tag: 'jump1' },
    { kind: 'a', r: 330, ang: 30, rise: -15, bank: 3, tag: 'vista' },
    { kind: 's', len: 120, rise: -11 },
    { kind: 'a', r: 78, ang: 62, rise: -2, bank: 6, tag: 's1' },
    { kind: 's', len: 30 },
    { kind: 'a', r: 64, ang: -80, rise: 0, bank: 7, tag: 's2' },
    { kind: 's', len: 26 },
    { kind: 'a', r: 88, ang: 48, rise: 1, bank: 5, tag: 's3' },
    { kind: 's', len: 170, rise: 4, hw: 3.6, tag: 'valley' },
    { kind: 'a', r: 50, ang: -150, rise: 2, bank: 15, hw: 4.4, tag: 'banked' },
    { kind: 's', len: 250, rise: 15, tag: 'recovery' },
    { kind: 's', len: 60, rise: -2, jump: { at: 0.05, h: 1.1, la: 26, ld: 22 }, tag: 'jump2' },
    { kind: 'a', r: 220, ang: 46, rise: -4, bank: 4, tag: 'flow1' },
    { kind: 'a', r: 200, ang: -52, rise: -3, bank: 4, tag: 'flow2' },
    { kind: 's', len: 140, rise: -2 },
    { kind: 'a', r: 38, ang: 86, rise: 0, bank: 5, hw: 4.0, tag: 'tight1' },
    { kind: 's', len: 85, rise: 2 },
    { kind: 'a', r: 44, ang: -96, rise: 1, bank: 6, hw: 4.0, tag: 'tight2' },
    { kind: 's', len: 60 },
    { kind: 'a', r: 60, ang: 66, rise: 0, bank: 5, tag: 'medium' },
    { kind: 'a', r: 130, ang: -42, rise: -3, bank: -3, tag: 'offcamber' },
    { kind: 's', len: 290, rise: -8, tag: 'finish' },
    { kind: 's', len: 160, rise: 0, hw: 4.6, tag: 'runoff' },
  ],
};
