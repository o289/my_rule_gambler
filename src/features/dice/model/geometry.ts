export type Vec3 = readonly [number, number, number];
export type Quaternion = readonly [number, number, number, number];

export const TRAY = { width: 9.25, depth: 5.4, floor: .28, wall: .32, wallHeight: 1.19 } as const;
export const DIE_SIZE = TRAY.depth * .18;
export const DIE_BEVEL = .055;
export const CAPTURE_HZ = 60;
export const BOARD_ROWS = 6;
export const GEM_ORDER = ['ruby', 'sapphire', 'emerald', 'amethyst', 'topaz', 'diamond'] as const;
export type GemId = (typeof GEM_ORDER)[number];

type Face = { readonly gem: GemId; readonly axis: Vec3 };

// BoxGeometry material order. The original CSS viewer's top and bottom map to +Y and −Y.
export const FACES: readonly Face[] = [
  { gem: 'sapphire', axis: [1, 0, 0] },
  { gem: 'topaz', axis: [-1, 0, 0] },
  { gem: 'emerald', axis: [0, 1, 0] },
  { gem: 'amethyst', axis: [0, -1, 0] },
  { gem: 'diamond', axis: [0, 0, 1] },
  { gem: 'ruby', axis: [0, 0, -1] },
];

export function upperFace([x, y, z, w]: Quaternion) {
  const yProjection = [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)] as const;
  let gem: GemId = 'emerald';
  let alignment = -Infinity;
  let next = -Infinity;
  for (const face of FACES) {
    const [a, b, c] = face.axis;
    const dot = a * yProjection[0] + b * yProjection[1] + c * yProjection[2];
    if (dot > alignment) {
      next = alignment;
      alignment = dot;
      gem = face.gem;
    } else {
      next = Math.max(next, dot);
    }
  }
  return { gem, ambiguous: alignment < .94 || alignment - next < .17, alignment };
}

export function releaseAt(kind: 'initial' | 'reroll') {
  return kind === 'initial' ? 810 : 1490;
}
