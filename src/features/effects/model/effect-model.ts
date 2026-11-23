import { TUMBLE_DURATION } from '../../dice/model/die-motion';
import { GEM_IDS } from '../../board/model/gem-ids';
import type { GemId } from '../../board/model/gem-ids';
import type { BoardDefinition, CellAddress } from '../../board/model/board-model';
import { canSelect, formatScore, goalColumn, playableColumns } from '../../board/model/board-model';
import { REDUCED_SCORE_MS, scoreTimings } from '../ui/board-score/board-motion';

const idPattern = /^[A-Za-z0-9_-]{1,80}$/;

export interface EffectParams {
  GEM_PLACEMENT: { gem: GemId; target: CellAddress };
  BOARD_SCORE: { playerName: string; points: number; target: CellAddress };
  BIG_WIN: { playerName: string; points: number; target?: CellAddress };
  ONE_CELL_COMEBACK: { gem: GemId };
  TURN_CHANGE: { playerName: string; isLocal: boolean };
  COMEBACK: {
    playerName: string;
    opponents: readonly string[];
    fromRank: number;
    toRank: number;
    playerId?: string;
    ranking?: readonly { id: string; name: string; fromRank: number; toRank: number }[];
  };
  JACKPOT_VICTORY: { playerName: string; gem: GemId; target?: CellAddress };
}

export type EffectKind = keyof EffectParams;
export type EffectRequest = { [K in EffectKind]: { kind: K; params: EffectParams[K] } }[EffectKind];
export type EffectCall = { [K in EffectKind]: [kind: K, params: EffectParams[K]] }[EffectKind];

export interface ScoreSettlement {
  score: EffectParams['BOARD_SCORE'];
  rankChange?: EffectParams['COMEBACK'];
  gameEnded?: boolean;
}

export function settlementEffects({ score, rankChange, gameEnded }: ScoreSettlement): EffectCall[] {
  const effects: EffectCall[] = [['BOARD_SCORE', score]];
  if (gameEnded) return effects;
  if (score.points >= 100) effects.push(['BIG_WIN', score]);
  if (rankChange && rankChange.fromRank !== rankChange.toRank) effects.push(['COMEBACK', rankChange]);
  return effects;
}

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
  GEM_PLACEMENT: '宝石配置演出',
  BOARD_SCORE: '得点・失点演出',
  BIG_WIN: 'BIG WIN',
  COMEBACK: 'COMEBACK',
  ONE_CELL_COMEBACK: 'あと1マスで逆転',
  TURN_CHANGE: '手番の切り替え',
  JACKPOT_VICTORY: 'JACKPOT VICTORY',
};

export type Cue = 'start' | 'flight' | 'focus' | 'gather' | 'charge' | 'silence' | 'impact' | 'glow' | 'reveal' | 'finish' | 'roll' | 'roll-stop' | 'place' | 'comeback';

export interface Beat {
  at: number;
  cue: Cue;
}

export const TURN_CHANGE_DURATION_MS = 690;
export const REDUCED_TURN_CHANGE_DURATION_MS = 200;
export const CONVERGING_LIGHT_TRAVEL_MS = 985;
export const CONVERGING_LIGHT_STAGGER_MS = 15;
const bigWinGather = 510;
const bigWinSilence = bigWinGather + CONVERGING_LIGHT_TRAVEL_MS + (GEM_IDS.length - 1) * CONVERGING_LIGHT_STAGGER_MS + 70;
const bigWinImpact = bigWinSilence + 300;

const timeline: Record<Exclude<EffectKind, 'ONE_CELL_COMEBACK' | 'BOARD_SCORE'>, readonly Beat[]> = {
  TURN_CHANGE: [
    { at: 0, cue: 'start' },
    { at: TURN_CHANGE_DURATION_MS, cue: 'finish' },
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
    { at: bigWinGather, cue: 'gather' },
    { at: bigWinSilence, cue: 'silence' },
    { at: bigWinImpact, cue: 'impact' },
    { at: bigWinImpact + 2050, cue: 'finish' },
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

export function scoreLabel(points: number) {
  return points === 0 ? '支払いなし' : `${formatScore(points)}点`;
}

export function turnLabel({ playerName, isLocal }: EffectParams['TURN_CHANGE']) {
  return isLocal ? 'あなたの手番' : `${playerName}の手番`;
}

export type EffectBeatContext = Pick<EffectScenario, 'board'> & Partial<Pick<EffectScenario, 'turn'>>;

export function beatsFor(request: EffectRequest, reduced: boolean, scenario: EffectBeatContext) {
  switch (request.kind) {
    case 'ONE_CELL_COMEBACK': {
      if (!scenario.turn) throw new TypeError('あと1マスで逆転の演出には手番のシナリオが必要です。');
      return oneCellComebackBeats(request.params.gem, reduced, scenario.turn);
    }
    case 'TURN_CHANGE':
      return reduced ? [{ at: 0, cue: 'start' }, { at: REDUCED_TURN_CHANGE_DURATION_MS, cue: 'finish' }] as const : timeline.TURN_CHANGE;
    case 'BOARD_SCORE': {
      const row = scenario.board.rows.find(item => item.id === request.params.target.rowId);
      const columns = row ? playableColumns(scenario.board, row).length : 0;
      const duration = reduced ? REDUCED_SCORE_MS : scoreTimings(columns).total;
      return [{ at: 0, cue: 'start' }, { at: duration, cue: 'finish' }] as const;
    }
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
    case 'ONE_CELL_COMEBACK':
      return { kind, params: { gem: readGem(params.gem) } };
    case 'GEM_PLACEMENT':
      return { kind, params: { gem: readGem(params.gem), target: readTarget(params.target, context?.board) } };
    case 'TURN_CHANGE':
      if (typeof params.isLocal !== 'boolean') throw new TypeError('自分の手番かどうかを指定してください。');
      return { kind, params: { playerName: readName(params.playerName), isLocal: params.isLocal } };
    case 'BOARD_SCORE': {
      const target = readTarget(params.target, context?.board);
      const points = params.points;
      if (typeof points !== 'number' || !Number.isSafeInteger(points)) {
        throw new RangeError('確定した得失点を整数で指定してください。');
      }
      const row = context?.board.rows.find(item => item.id === target.rowId);
      if (row && context && (goalColumn(context.board, row)?.id !== target.columnId
        || (row.score < 0 ? points < row.score || points > 0 : points !== row.score))) {
        throw new RangeError('行のゴールと、その行で確定した得失点を指定してください。');
      }
      return { kind, params: { playerName: readName(params.playerName), points, target } };
    }
    case 'BIG_WIN': {
      if (typeof params.points !== 'number' || !Number.isSafeInteger(params.points) || params.points < 100) {
        throw new RangeError('獲得得点には100以上の整数を指定してください。');
      }
      const target = params.target == null ? context?.featuredCell : readTarget(params.target, context?.board);
      return { kind, params: { playerName: readName(params.playerName), points: params.points, ...(target ? { target } : {}) } };
    }
    case 'COMEBACK': {
      const playerName = readName(params.playerName);
      if (!Array.isArray(params.opponents) || !params.opponents.length) throw new TypeError('対戦相手を指定してください。');
      const opponents = params.opponents.map(readName);
      if (params.ranking === undefined && new Set([...opponents, playerName]).size !== opponents.length + 1) {
        throw new RangeError('プレイヤー名はそれぞれ異なる名前を指定してください。');
      }
      const fromRank = readRank(params.fromRank, opponents.length + 1);
      const toRank = readRank(params.toRank, opponents.length + 1);
      if (toRank === fromRank) throw new RangeError('変動前後で異なる順位を指定してください。');
      const playerId = params.playerId;
      if (playerId !== undefined && (typeof playerId !== 'string' || !idPattern.test(playerId))) {
        throw new TypeError('プレイヤー ID を指定してください。');
      }
      let ranking: EffectParams['COMEBACK']['ranking'];
      if (params.ranking !== undefined) {
        if (!Array.isArray(params.ranking) || params.ranking.length !== opponents.length + 1) {
          throw new TypeError('前後の順位をプレイヤー全員分指定してください。');
        }
        const ids = new Set<string>();
        ranking = params.ranking.map(value => {
          if (!isRecord(value) || typeof value.id !== 'string' || !idPattern.test(value.id)
            || typeof value.name !== 'string' || !value.name.trim()
            || ids.has(value.id)) throw new TypeError('順位表のプレイヤーを正しく指定してください。');
          ids.add(value.id);
          return { id: value.id, name: readName(value.name),
            fromRank: readRank(value.fromRank, opponents.length + 1), toRank: readRank(value.toRank, opponents.length + 1) };
        });
        const changedPlayer = ranking.find(item => item.id === playerId);
        if (!playerId || !changedPlayer || changedPlayer.name !== playerName
          || changedPlayer.fromRank !== fromRank || changedPlayer.toRank !== toRank) {
          throw new RangeError('順位表と対象プレイヤーの順位が一致しません。');
        }
      }
      return { kind, params: { playerName, opponents, fromRank, toRank,
        ...(playerId === undefined ? {} : { playerId }), ...(ranking === undefined ? {} : { ranking }) } };
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

export function rankEntries(params: EffectParams['COMEBACK'], after: boolean) {
  if (params.ranking) {
    return params.ranking.map(item => ({ id: item.id, name: item.name, rank: after ? item.toRank : item.fromRank }))
      .sort((left, right) => left.rank - right.rank);
  }
  return rankOrder(params, after).map((name, index) => ({ id: name, name, rank: index + 1 }));
}
