import { LANDING_FRACTION, TUMBLE_DURATION } from '../../dice/model/die-motion';
import { GEM_IDS } from '../../board/model/gem-ids';
import type { GemId } from '../../board/model/gem-ids';
import type { BoardDefinition, CellAddress } from '../../board/model/board-model';
import { canSelect, formatScore, goalColumn } from '../../board/model/board-model';
import { BANK_AMOUNT_STEP, COIN_TRAVEL_MS } from '../../bank/model/bank-model';
import type { Coin } from '../../bank/model/bank-model';

export interface EffectParams {
  DICE_STOP: { gem: GemId };
  GEM_PLACEMENT: { gem: GemId; target: CellAddress };
  BIG_WIN: { playerName: string; points: number; target?: CellAddress };
  ONE_CELL_COMEBACK: { gem: GemId };
  TURN_CHANGE: { playerName: string; isLocal: boolean };
  LOSS_NOTICE: { playerName: string; paidPoints: number; target: CellAddress };
  COMEBACK: { playerName: string; opponents: readonly string[]; fromRank: number; toRank: number };
  JACKPOT_VICTORY: { playerName: string; gem: GemId; target?: CellAddress };
}

export type EffectKind = keyof EffectParams;
export type EffectRequest = { [K in EffectKind]: { kind: K; params: EffectParams[K] } }[EffectKind];
export type EffectCall = { [K in EffectKind]: [kind: K, params: EffectParams[K]] }[EffectKind];

export interface EffectTurnScenario {
  comebackBoard: BoardDefinition;
  lastCell: CellAddress;
  comebackGem: GemId;
  comebackScore: number;
  players: readonly { name: string; score: number }[];
  currentPlayer: { name: string; score: number };
  nextPlayer: { name: string; score: number };
  comebackRank: EffectParams['COMEBACK'];
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
  TURN_CHANGE: '手番の切り替え',
  LOSS_NOTICE: '失点の通知',
  JACKPOT_VICTORY: 'JACKPOT VICTORY',
};

export type Cue = 'start' | 'flight' | 'focus' | 'gather' | 'charge' | 'silence' | 'impact' | 'glow' | 'reveal' | 'finish' | 'roll' | 'roll-stop' | 'place' | 'comeback';

export interface Beat {
  at: number;
  cue: Cue;
}

const timeline: Record<Exclude<EffectKind, 'ONE_CELL_COMEBACK' | 'LOSS_NOTICE'>, readonly Beat[]> = {
  TURN_CHANGE: [
    { at: 0, cue: 'start' },
    { at: 690, cue: 'finish' },
  ],
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

function oneCellComebackBeats(
  gem: GemId, reduced: boolean, scenario: EffectTurnScenario,
): readonly Beat[] {
  const roll = reduced ? 720 : 1540;
  const stop = roll + (reduced ? 0 : TUMBLE_DURATION);
  const opening: Beat[] = [
    { at: 0, cue: 'start' },
    { at: roll, cue: 'roll' },
    { at: stop, cue: 'roll-stop' },
  ];
  if (gem !== scenario.comebackGem) return [...opening, { at: stop + 1000, cue: 'finish' }];

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

export const LOSS_COIN_STAGGER_MS = 105;

export function lossCoins(paidPoints: number): readonly Coin[] {
  let remaining = paidPoints;
  // Animate the leading coins of each stack for larger penalties.
  return ([100, 50, 10] as const).flatMap(value => {
    const count = Math.floor(remaining / value);
    remaining %= value;
    return Array.from({ length: Math.min(count, 5) }, (_, index) => ({ id: `loss-${value}-${index}`, value }));
  });
}

export function lossLabel(paidPoints: number) {
  return paidPoints > 0 ? `${formatScore(-paidPoints)}点` : '支払いなし';
}

export function turnLabel({ playerName, isLocal }: EffectParams['TURN_CHANGE']) {
  return isLocal ? 'あなたの手番' : `${playerName}の手番`;
}

function lossBeats(paidPoints: number, reduced: boolean): readonly Beat[] {
  const place = reduced ? 120 : 460;
  const opening: Beat[] = [{ at: 0, cue: 'start' }, { at: place, cue: 'place' }];
  if (paidPoints === 0) return [...opening, { at: place + 1180, cue: 'finish' }];
  if (reduced) return [...opening, { at: place + 550, cue: 'reveal' }, { at: place + 900, cue: 'finish' }];
  const launch = 1520;
  const arrival = launch + COIN_TRAVEL_MS + (lossCoins(paidPoints).length - 1) * LOSS_COIN_STAGGER_MS;
  return [...opening, { at: 1080, cue: 'charge' }, { at: launch, cue: 'flight' },
    { at: arrival, cue: 'reveal' }, { at: arrival + 410, cue: 'finish' }];
}

export function beatsFor(request: EffectRequest, reduced: boolean, scenario: EffectTurnScenario) {
  switch (request.kind) {
    case 'ONE_CELL_COMEBACK':
      return oneCellComebackBeats(request.params.gem, reduced, scenario);
    case 'DICE_STOP':
      return reduced ? quietDice : timeline.DICE_STOP;
    case 'TURN_CHANGE':
      return reduced ? [{ at: 0, cue: 'start' }, { at: 200, cue: 'finish' }] as const : timeline.TURN_CHANGE;
    case 'LOSS_NOTICE':
      return lossBeats(request.params.paidPoints, reduced);
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
      return { kind, params: { gem: readGem(params.gem) } };
    case 'GEM_PLACEMENT':
      return { kind, params: { gem: readGem(params.gem), target: readTarget(params.target, context?.board) } };
    case 'TURN_CHANGE':
      if (typeof params.isLocal !== 'boolean') throw new TypeError('自分の手番かどうかを指定してください。');
      return { kind, params: { playerName: readName(params.playerName), isLocal: params.isLocal } };
    case 'LOSS_NOTICE': {
      const target = readTarget(params.target, context?.board);
      const paidPoints = params.paidPoints;
      if (typeof paidPoints !== 'number' || !Number.isSafeInteger(paidPoints) || paidPoints < 0 || paidPoints % BANK_AMOUNT_STEP !== 0) {
        throw new RangeError('確定した支払額を0点または10点単位で指定してください。');
      }
      const row = context?.board.rows.find(item => item.id === target.rowId);
      if (row && context && (row.score >= 0 || goalColumn(context.board, row)?.id !== target.columnId || paidPoints > -row.score)) {
        throw new RangeError('マイナスの行のゴールと、行の失点以下の支払額を指定してください。');
      }
      return { kind, params: { playerName: readName(params.playerName), paidPoints, target } };
    }
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
