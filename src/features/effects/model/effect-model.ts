import { LANDING_FRACTION, TUMBLE_DURATION } from '../../dice/model/die-motion';
import { GEMS } from '../../board/model/gems';
import type { GemId } from '../../board/model/gems';
import type { CellAddress } from '../../board/model/board-model';
import { canSelect } from '../../board/model/board-model';
import { SAMPLE_BOARD } from '../../../dev/preview-data/sample-board';

export interface EffectParams {
  DICE_STOP: { gem: GemId };
  GEM_PLACEMENT: { gem: GemId; target: CellAddress };
  BIG_WIN: { playerName: string; points: number; target?: CellAddress };
  COMEBACK: { playerName: string; opponents: readonly string[]; fromRank: number; toRank: number };
  JACKPOT_VICTORY: { playerName: string; gem: GemId; target?: CellAddress };
}

export type EffectKind = keyof EffectParams;
export type EffectRequest = { [K in EffectKind]: { kind: K; params: EffectParams[K] } }[EffectKind];
export type EffectCall = { [K in EffectKind]: [kind: K, params: EffectParams[K]] }[EffectKind];

export const EFFECT_LABELS: Record<EffectKind, string> = {
  DICE_STOP: 'サイコロ停止演出',
  GEM_PLACEMENT: '宝石配置演出',
  BIG_WIN: 'BIG WIN',
  COMEBACK: 'COMEBACK',
  JACKPOT_VICTORY: 'JACKPOT VICTORY',
};

export const FEATURED_CELL: CellAddress = { rowId: 'royal', columnId: 'amethyst' };

export const DEMO: EffectParams = {
  DICE_STOP: { gem: 'sapphire' },
  GEM_PLACEMENT: { gem: 'amethyst', target: FEATURED_CELL },
  BIG_WIN: { playerName: 'PLAYER 1', points: 100, target: FEATURED_CELL },
  COMEBACK: { playerName: 'PLAYER 1', opponents: ['PLAYER 2', 'PLAYER 3'], fromRank: 3, toRank: 1 },
  JACKPOT_VICTORY: { playerName: 'PLAYER 1', gem: 'amethyst', target: FEATURED_CELL },
};

export type Cue = 'start' | 'flight' | 'focus' | 'gather' | 'charge' | 'silence' | 'impact' | 'glow' | 'reveal' | 'finish';

export interface Beat {
  at: number;
  cue: Cue;
}

const timeline: Record<EffectKind, readonly Beat[]> = {
  DICE_STOP: [
    { at: 0, cue: 'start' },
    { at: Math.round(TUMBLE_DURATION * LANDING_FRACTION), cue: 'impact' },
    { at: TUMBLE_DURATION, cue: 'glow' },
    { at: 1990, cue: 'finish' },
  ],
  GEM_PLACEMENT: [
    { at: 0, cue: 'start' },
    { at: 105, cue: 'flight' },
    { at: 680, cue: 'impact' },
    { at: 770, cue: 'glow' },
    { at: 990, cue: 'finish' },
  ],
  BIG_WIN: [
    { at: 0, cue: 'start' },
    { at: 270, cue: 'focus' },
    { at: 510, cue: 'gather' },
    { at: 1430, cue: 'silence' },
    { at: 1730, cue: 'impact' },
    { at: 3780, cue: 'finish' },
  ],
  COMEBACK: [
    { at: 0, cue: 'start' },
    { at: 235, cue: 'focus' },
    { at: 600, cue: 'silence' },
    { at: 890, cue: 'impact' },
    { at: 1515, cue: 'reveal' },
    { at: 2550, cue: 'finish' },
  ],
  JACKPOT_VICTORY: [
    { at: 0, cue: 'start' },
    { at: 635, cue: 'gather' },
    { at: 1660, cue: 'charge' },
    { at: 2630, cue: 'silence' },
    { at: 3030, cue: 'impact' },
    { at: 3690, cue: 'reveal' },
    { at: 6350, cue: 'finish' },
  ],
};

const quietDice: readonly Beat[] = [
  { at: 0, cue: 'start' },
  { at: 0, cue: 'impact' },
  { at: 80, cue: 'glow' },
  { at: 335, cue: 'finish' },
];

export function beatsFor(kind: EffectKind, reduced: boolean) {
  return reduced && kind === 'DICE_STOP' ? quietDice : timeline[kind];
}

export function effectDuration(beats: readonly Beat[]) {
  return beats.at(-1)?.at ?? 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGem(id: unknown): id is GemId {
  return typeof id === 'string' && Object.hasOwn(GEMS, id);
}

function readTarget(value: unknown): CellAddress {
  if (!isRecord(value) || typeof value.rowId !== 'string' || typeof value.columnId !== 'string') {
    throw new TypeError('マスの行 ID と列 ID を指定してください。');
  }
  const target = { rowId: value.rowId, columnId: value.columnId };
  if (!canSelect(SAMPLE_BOARD, target)) throw new RangeError('指定されたマスは使用できません。');
  return target;
}

function readName(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('プレイヤー名を指定してください。');
  return value.trim();
}

function readRank(rank: unknown, count: number) {
  if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 1 || rank > count) {
    throw new RangeError('順位はプレイヤー数の範囲内で指定してください。');
  }
  return rank;
}

function readGem(id: unknown) {
  if (!isGem(id)) throw new RangeError('対応する宝石 ID を指定してください。');
  return id;
}

export function readEffect(kind: unknown, params: unknown): EffectRequest {
  if (!isRecord(params)) throw new TypeError('演出の設定を指定してください。');
  switch (kind) {
    case 'DICE_STOP':
      return { kind, params: { gem: readGem(params.gem) } };
    case 'GEM_PLACEMENT':
      return { kind, params: { gem: readGem(params.gem), target: readTarget(params.target) } };
    case 'BIG_WIN': {
      if (typeof params.points !== 'number' || !Number.isSafeInteger(params.points) || params.points <= 0) {
        throw new RangeError('獲得得点には正の整数を指定してください。');
      }
      const target = readTarget(params.target ?? FEATURED_CELL);
      return { kind, params: { playerName: readName(params.playerName), points: params.points, target } };
    }
    case 'COMEBACK': {
      const playerName = readName(params.playerName);
      if (!Array.isArray(params.opponents) || !params.opponents.length) throw new TypeError('対戦相手を指定してください。');
      const opponents = params.opponents.map(readName);
      if (new Set([...opponents, playerName]).size !== opponents.length + 1) throw new RangeError('プレイヤー名はそれぞれ異なる名前を指定してください。');
      const fromRank = readRank(params.fromRank, opponents.length + 1);
      const toRank = readRank(params.toRank, opponents.length + 1);
      if (toRank >= fromRank) throw new RangeError('逆転後には、逆転前より上の順位を指定してください。');
      return { kind, params: { playerName, opponents, fromRank, toRank } };
    }
    case 'JACKPOT_VICTORY':
      return { kind, params: { playerName: readName(params.playerName), gem: readGem(params.gem), target: readTarget(params.target ?? FEATURED_CELL) } };
    default:
      throw new RangeError('対応する演出を指定してください。');
  }
}

export function rankOrder(params: EffectParams['COMEBACK'], after: boolean) {
  const rank = after ? params.toRank : params.fromRank;
  const order = [...params.opponents];
  order.splice(rank - 1, 0, params.playerName);
  return order;
}
