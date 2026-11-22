import { LANDING_FRACTION, TUMBLE_DURATION } from '../../dice/model/die-motion';
import { GEM_IDS } from '../../board/model/gem-ids';
import type { GemId } from '../../board/model/gem-ids';
import type { BoardDefinition, CellAddress } from '../../board/model/board-model';
import { canSelect } from '../../board/model/board-model';

export interface EffectParams {
  DICE_STOP: { gem: GemId };
  GEM_PLACEMENT: { gem: GemId; target: CellAddress };
  BIG_WIN: { playerName: string; points: number; target?: CellAddress };
  ONE_CELL_COMEBACK: { gem: GemId };
  REROLL_THROW: { gem: GemId };
  COMEBACK: { playerName: string; opponents: readonly string[]; fromRank: number; toRank: number };
  JACKPOT_VICTORY: { playerName: string; gem: GemId; target?: CellAddress };
}

export type EffectKind = keyof EffectParams;
export type EffectRequest = { [K in EffectKind]: { kind: K; params: EffectParams[K] } }[EffectKind];
export type EffectCall = { [K in EffectKind]: [kind: K, params: EffectParams[K]] }[EffectKind];

export interface EffectTurnScenario {
  board: BoardDefinition;
  comebackBoard: BoardDefinition;
  lastCell: CellAddress;
  comebackGem: GemId;
  comebackScore: number;
  players: readonly { name: string; score: number }[];
  currentPlayer: { name: string; score: number };
  nextPlayer: { name: string; score: number };
  comebackRank: EffectParams['COMEBACK'];
  retainedGem: GemId;
  rerollResults: { available: GemId; blocked: GemId };
  rerollTargets: (gem: GemId) => readonly CellAddress[];
}

export interface EffectScenario {
  board: BoardDefinition;
  featuredCell: CellAddress;
  demo: EffectParams;
  turn: EffectTurnScenario;
}

export type EffectTargetContext = Pick<EffectScenario, 'board' | 'featuredCell'>;

export const EFFECT_LABELS: Record<EffectKind, string> = {
  DICE_STOP: 'サイコロ停止演出',
  GEM_PLACEMENT: '宝石配置演出',
  BIG_WIN: 'BIG WIN',
  COMEBACK: 'COMEBACK',
  ONE_CELL_COMEBACK: 'あと1マスで逆転',
  REROLL_THROW: '振り直しの一投',
  JACKPOT_VICTORY: 'JACKPOT VICTORY',
};

export type Cue = 'start' | 'flight' | 'focus' | 'gather' | 'charge' | 'silence' | 'impact' | 'glow' | 'reveal' | 'finish' | 'roll' | 'roll-stop' | 'place' | 'comeback' | 'handoff';

export interface Beat {
  at: number;
  cue: Cue;
}

const timeline: Record<Exclude<EffectKind, 'ONE_CELL_COMEBACK' | 'REROLL_THROW'>, readonly Beat[]> = {
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

function turnBeats(request: Extract<EffectRequest, { kind: 'ONE_CELL_COMEBACK' | 'REROLL_THROW' }>, reduced: boolean, scenario: EffectTurnScenario): readonly Beat[] {
  const comeback = request.kind === 'ONE_CELL_COMEBACK';
  const roll = comeback ? (reduced ? 720 : 1540) : (reduced ? 120 : 410);
  const stop = roll + (reduced ? 0 : TUMBLE_DURATION);
  const opening: Beat[] = [
    { at: 0, cue: 'start' },
    { at: roll, cue: 'roll' },
    { at: stop, cue: 'roll-stop' },
  ];
  if (!comeback) {
    return scenario.rerollTargets(request.params.gem).length
      ? [...opening, { at: stop + 1020, cue: 'finish' }]
      : [...opening, { at: stop + 850, cue: 'handoff' }, { at: stop + 1590, cue: 'finish' }];
  }
  if (request.params.gem !== scenario.comebackGem) return [...opening, { at: stop + 1000, cue: 'finish' }];

  const flight = stop + (reduced ? 280 : 660);
  const place = flight + (reduced ? 200 : 575);
  const rankings = place + (reduced ? 440 : 900);
  return [
    ...opening,
    { at: flight, cue: 'flight' },
    { at: place, cue: 'place' },
    ...timeline.COMEBACK.map(beat => ({ at: rankings + beat.at, cue: beat.cue === 'start' ? 'comeback' as const : beat.cue })),
  ];
}

export function beatsFor(request: EffectRequest, reduced: boolean, scenario: EffectTurnScenario) {
  switch (request.kind) {
    case 'ONE_CELL_COMEBACK':
    case 'REROLL_THROW':
      return turnBeats(request, reduced, scenario);
    case 'DICE_STOP':
      return reduced ? quietDice : timeline.DICE_STOP;
    default:
      return timeline[request.kind];
  }
}

export function effectDuration(beats: readonly Beat[]) {
  return beats.at(-1)?.at ?? 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGem(id: unknown): id is GemId {
  return GEM_IDS.some(gem => gem === id);
}

function readTarget(value: unknown, board?: BoardDefinition): CellAddress {
  if (!isRecord(value) || typeof value.rowId !== 'string' || typeof value.columnId !== 'string') {
    throw new TypeError('マスの行 ID と列 ID を指定してください。');
  }
  const target = { rowId: value.rowId, columnId: value.columnId };
  if (board && !canSelect(board, target)) throw new RangeError('指定されたマスは使用できません。');
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

export function readEffect(kind: unknown, params: unknown, context?: EffectTargetContext): EffectRequest {
  if (!isRecord(params)) throw new TypeError('演出の設定を指定してください。');
  switch (kind) {
    case 'DICE_STOP':
    case 'ONE_CELL_COMEBACK':
    case 'REROLL_THROW':
      return { kind, params: { gem: readGem(params.gem) } };
    case 'GEM_PLACEMENT':
      return { kind, params: { gem: readGem(params.gem), target: readTarget(params.target, context?.board) } };
    case 'BIG_WIN': {
      if (typeof params.points !== 'number' || !Number.isSafeInteger(params.points) || params.points <= 0) {
        throw new RangeError('獲得得点には正の整数を指定してください。');
      }
      const target = params.target == null ? context?.featuredCell : readTarget(params.target, context?.board);
      return { kind, params: { playerName: readName(params.playerName), points: params.points, ...(target ? { target } : {}) } };
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
      {
        const target = params.target == null ? context?.featuredCell : readTarget(params.target, context?.board);
        return { kind, params: { playerName: readName(params.playerName), gem: readGem(params.gem), ...(target ? { target } : {}) } };
      }
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
