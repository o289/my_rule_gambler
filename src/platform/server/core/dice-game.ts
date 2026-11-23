import { cellKey, nextOpenCell, requiredGemAt } from '../../../features/board/model/board-model';
import type { BoardDefinition } from '../../../features/board/model/board-model';
import { DEFAULT_CONFIG } from '../../../shared/contracts/dice';
import type { DiceResult, GameState, Placement, RollConfig } from '../../../shared/contracts/dice';

export interface DiceGameState {
  turnId: string | null;
  phase: GameState['phase'];
  revision: number;
  config: RollConfig;
  rollId: string | null;
  results: readonly DiceResult[];
  remaining: readonly string[];
  placedThisRoll: boolean;
  board: ReadonlyMap<string, Placement>;
}

export interface PlaceDieCommand {
  rollId: string;
  dieId: string;
  row: number;
  column?: number;
}

export interface DiceGamePlayer { id: string; online: boolean }

export function initialDiceGameState(): DiceGameState {
  return {
    turnId: null,
    phase: 'ready',
    revision: 0,
    config: { ...DEFAULT_CONFIG },
    rollId: null,
    results: [],
    remaining: [],
    placedThisRoll: false,
    board: new Map(),
  };
}

export function hasTurn(state: DiceGameState, playerId: string) {
  return state.turnId === playerId;
}

export function canConfigure(state: DiceGameState, isDev: boolean) {
  return isDev && (state.phase === 'ready' || state.phase === 'placement');
}

export function setRollConfig(state: DiceGameState, config: RollConfig) {
  return { ...state, config };
}

export function rollRequestStatus(
  state: DiceGameState,
  playerId: string,
  kind: 'initial' | 'reroll',
  requestId: string,
  seen: ReadonlySet<string>,
  isDev: boolean,
): 'accepted' | 'duplicate' | 'turn' | 'phase' | 'place-first' {
  if (!hasTurn(state, playerId)) return 'turn';
  if (seen.has(requestId)) return 'duplicate';
  if ((kind === 'initial' && state.phase !== 'ready')
    || (kind === 'reroll' && (state.phase !== 'placement' || state.remaining.length === 0))) return 'phase';
  if (kind === 'reroll' && !canReroll(state, isDev)) return 'place-first';
  return 'accepted';
}

export function rememberRollRequest(seen: ReadonlySet<string>, requestId: string, limit = 48) {
  const next = new Set(seen);
  next.add(requestId);
  while (next.size > limit) {
    const oldest = next.values().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
}

export type DiceRollRequestDecision =
  | { status: 'accepted'; seen: Set<string> }
  | { status: 'duplicate' }
  | { status: 'turn' }
  | { status: 'phase' }
  | { status: 'place-first' };

export function createDiceRollRequest(
  state: DiceGameState,
  playerId: string,
  kind: 'initial' | 'reroll',
  requestId: string,
  seen: ReadonlySet<string>,
  isDev: boolean,
): DiceRollRequestDecision {
  const status = rollRequestStatus(state, playerId, kind, requestId, seen, isDev);
  return status === 'accepted' ? { status, seen: rememberRollRequest(seen, requestId) } : { status };
}

export function setFirstTurn(state: DiceGameState, playerId: string) {
  return state.turnId === null ? { ...state, turnId: playerId } : state;
}

export function selectTurnAfterPrune(state: DiceGameState, players: readonly DiceGamePlayer[]) {
  if (state.turnId && players.some(player => player.id === state.turnId)) return state;
  return { ...state, turnId: players.find(player => player.online)?.id ?? null, revision: state.revision + 1 };
}

export function canReroll(state: DiceGameState, allowDev: boolean) {
  return state.phase === 'placement' && state.remaining.length > 0 && (state.placedThisRoll || allowDev);
}

export function hasLegalPlacement(definition: BoardDefinition, state: DiceGameState) {
  const available = state.results.filter(die => state.remaining.includes(die.id));
  return definition.rows.some(row => {
    const open = nextOpenCell(definition, state.board, row.id);
    return open && available.some(die => die.gem === requiredGemAt(definition, open));
  });
}

export function confirmRoll(
  state: DiceGameState,
  playerId: string,
  rollId: string,
  confirmedResults: readonly DiceResult[],
): DiceGameState | null {
  if (!hasTurn(state, playerId) || state.phase !== 'confirm' || state.rollId !== rollId || confirmedResults.length === 0) return null;
  return {
    ...state,
    phase: 'placement',
    revision: state.revision + 1,
    results: confirmedResults,
    remaining: confirmedResults.map(die => die.id),
    placedThisRoll: false,
  };
}

export function beginRoll(
  state: DiceGameState,
  rollId: string,
  kind: 'initial' | 'reroll',
  count: number,
  previousDice: readonly { id: string }[],
  initialDiceIds?: readonly string[],
): { state: DiceGameState; diceIds: string[] } {
  const diceIds = kind === 'initial'
    ? [...(initialDiceIds ?? Array.from({ length: count }, (_, index) => `die-${index + 1}`))].slice(0, count)
    : previousDice.filter(die => state.remaining.includes(die.id)).map(die => die.id);
  return {
    state: { ...state, phase: 'rolling', rollId },
    diceIds,
  };
}

export function finishRoll(state: DiceGameState, rollId: string) {
  if (state.phase !== 'rolling' || state.rollId !== rollId) return state;
  return { ...state, phase: 'confirm' as const };
}

export function placeDie(
  state: DiceGameState,
  definition: BoardDefinition,
  command: PlaceDieCommand,
): { status: 'ignored' | 'invalid' | 'placed'; state: DiceGameState } {
  if (state.phase !== 'placement' || state.rollId !== command.rollId || !state.remaining.includes(command.dieId)) {
    return { status: 'ignored', state };
  }
  const die = state.results.find(result => result.id === command.dieId);
  if (!die) return { status: 'ignored', state };
  const row = definition.rows[command.row];
  const open = row && nextOpenCell(definition, state.board, row.id);
  const column = definition.columns.findIndex(item => item.id === open?.columnId);
  if (!open || requiredGemAt(definition, open) !== die.gem
    || (command.column !== undefined && column !== command.column)) {
    return { status: 'invalid', state };
  }
  const board = new Map(state.board).set(cellKey(open), { row: command.row, column, gem: die.gem, dieId: die.id });
  return {
    status: 'placed',
    state: {
      ...state,
      board,
      remaining: state.remaining.filter(id => id !== die.id),
      placedThisRoll: true,
      revision: state.revision + 1,
    },
  };
}

export function endTurnStatus(state: DiceGameState, definition: BoardDefinition, expectedRevision: number) {
  if (state.phase !== 'placement' || state.revision !== expectedRevision) return 'ignored' as const;
  return hasLegalPlacement(definition, state) && !state.placedThisRoll ? 'place-first' as const : 'allowed' as const;
}

export function finishTurn(
  state: DiceGameState,
  players: readonly DiceGamePlayer[],
  currentPlayerId: string,
): DiceGameState {
  const start = players.findIndex(player => player.id === currentPlayerId);
  const rotated = start < 0 ? players : [...players.slice(start + 1), ...players.slice(0, start + 1)];
  const next = rotated.find(player => player.online);
  return {
    ...state,
    turnId: next?.id ?? currentPlayerId,
    phase: 'ready',
    remaining: [],
    placedThisRoll: false,
    revision: state.revision + 1,
  };
}

