import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoardDefinition } from '../../features/board/model/board-model';
import { cellKey } from '../../features/board/model/board-model';
import { oneCellComebackHint, settlementFollowups, settlementRankChange } from '../../features/dice/model/settlement-presentation';
import { settlementCoinMoves } from '../../features/bank/model/settlement-coins';
import { settlementEffects } from '../../features/effects/model/effect-model';
import { SettlementEventQueue } from '../../features/dice/model/settlement-event-queue';
import { acceptsGameState } from '../../features/dice/model/state-sync';
import type { GameState, MatchSettlementEvent } from '../../shared/contracts/dice';

const board: BoardDefinition = {
  columns: [{ id: 'first', gem: 'ruby' }, { id: 'goal', gem: 'sapphire' }],
  rows: [{ id: 'row-a', score: 100 }],
};

function event(points: number, overrides: Partial<MatchSettlementEvent> = {}): MatchSettlementEvent {
  return {
    boardSeed: 17,
    revision: 4,
    playerId: 'p1',
    playerName: 'Player One',
    rowId: 'row-a',
    columnId: 'goal',
    rowPoints: 100,
    points,
    gameEnded: false,
    beforeRanks: [{ id: 'p1', name: 'Player One', rank: 2 }, { id: 'p2', name: 'Player Two', rank: 1 }],
    afterRanks: [{ id: 'p1', name: 'Player One', rank: 1 }, { id: 'p2', name: 'Player Two', rank: 2 }],
    ...overrides,
  };
}

test('settlement bonus uses the actual all-player ranks, including unchanged scorer and tied ranks', () => {
  const otherMoves = event(20, {
    beforeRanks: [
      { id: 'p1', name: '同じ名前', rank: 1 }, { id: 'p2', name: '同じ名前', rank: 1 }, { id: 'p3', name: '三人目', rank: 3 },
    ],
    afterRanks: [
      { id: 'p1', name: '同じ名前', rank: 1 }, { id: 'p2', name: '同じ名前', rank: 2 }, { id: 'p3', name: '三人目', rank: 2 },
    ],
  });
  const change = settlementRankChange(otherMoves);
  assert.equal(change?.playerId, 'p2', 'when the scorer stays tied at rank 1, the first actual rank movement is shown');
  assert.equal(change?.fromRank, 1);
  assert.equal(change?.toRank, 2, 'downward movement uses the real rank numbers');
  assert.deepEqual(change?.ranking?.map(item => [item.id, item.fromRank, item.toRank]), [
    ['p1', 1, 1], ['p2', 1, 2], ['p3', 3, 2],
  ]);
  const score = { playerName: 'Player One', target: { rowId: 'row-a', columnId: 'goal' } };
  assert.deepEqual(settlementEffects({ score: { ...score, points: 99 }, rankChange: change }).map(([kind]) => kind), ['BOARD_SCORE', 'COMEBACK']);
  assert.deepEqual(settlementEffects({ score: { ...score, points: 100 }, rankChange: change }).map(([kind]) => kind), ['BOARD_SCORE', 'BIG_WIN', 'COMEBACK']);
  assert.deepEqual(settlementEffects({ score: { ...score, points: 120 }, rankChange: change }).map(([kind]) => kind), ['BOARD_SCORE', 'BIG_WIN', 'COMEBACK']);
  const rise = settlementRankChange(event(100));
  assert.equal(rise?.playerId, 'p1');
  assert.equal(rise?.fromRank, 2);
  assert.equal(rise?.toRank, 1);
  assert.deepEqual(settlementEffects({ score: { ...score, points: 120 }, gameEnded: true }).map(([kind]) => kind), ['BOARD_SCORE']);
  assert.deepEqual(settlementFollowups(event(100), board).map(effect => effect.kind), ['BIG_WIN', 'COMEBACK']);
  assert.equal(settlementRankChange(event(20, {
    beforeRanks: [{ id: 'p1', name: 'Player One', rank: 1 }, { id: 'p2', name: 'Player Two', rank: 2 }],
    afterRanks: [{ id: 'p1', name: 'Player One', rank: 1 }, { id: 'p2', name: 'Player Two', rank: 2 }],
  })), undefined);
});

test('score coin flights move exactly the committed amount without changing the wallet snapshot', () => {
  const loss = settlementCoinMoves('room-event', -10);
  assert.equal(loss.outgoing.reduce((sum, coin) => sum + coin.value, 0), 10);
  assert.deepEqual(loss.incoming, []);
  assert.deepEqual(settlementCoinMoves('room-event', 0), { outgoing: [], incoming: [] });
  for (const amount of [10, 50, 100, 120]) {
    const movement = settlementCoinMoves('room-event', amount);
    assert.equal(movement.incoming.reduce((sum, coin) => sum + coin.value, 0), amount);
    assert.deepEqual(movement.outgoing, []);
  }
  const zeroBalanceLoss = event(0, { rowPoints: -10 });
  assert.equal(zeroBalanceLoss.points, 0, 'the score event keeps a zero actual payment distinct from its negative row value');
});

test('settlement event queue suppresses duplicate receive and does not replay after reconnect baseline', () => {
  const queue = new SettlementEventQueue();
  const committed = event(-10, { rowPoints: -10 });
  assert.equal(queue.enqueue(committed), true);
  assert.equal(queue.enqueue(committed), false);
  assert.equal(queue.getSnapshot().length, 1);
  queue.clearPending();
  assert.equal(queue.getSnapshot().length, 0);
  assert.equal(queue.enqueue(committed), false, 'a reconnect baseline or duplicate state cannot replay the old event');
  const next = event(100, { boardSeed: 18, revision: 5 });
  assert.equal(queue.enqueue(next), true);
  assert.equal(queue.complete(committed), false, 'a stale completion cannot consume the next settlement');
  assert.equal(queue.complete(next), true);
  assert.equal(queue.getSnapshot().length, 0, 'skipping an effect only acknowledges its presentation event');
});

test('an older snapshot from the same board cannot roll back newer score or placement state', () => {
  const game = (boardSeed: number, revision: number): GameState => ({
    seats: [], turnId: null, turnSequence: 0, turnNotice: null, phase: 'ready', revision,
    config: { count: 5, hz: 120 }, boardSeed, placements: [], results: [], remaining: [],
    placedThisRoll: false, hasLegalPlacement: false,
  });
  assert.equal(acceptsGameState(game(17, 9), game(17, 8)), false);
  assert.equal(acceptsGameState(game(17, 9), game(17, 9)), true);
  assert.equal(acceptsGameState(game(17, 9), game(18, 0)), true, 'a new board seed starts a new revision sequence');
});

test('one-cell comeback hint points only to an actual legal final cell for a confirmed remaining die', () => {
  const occupied = new Set([cellKey({ rowId: 'row-a', columnId: 'first' })]);
  const players = [{ id: 'p1', score: 80 }, { id: 'p2', score: 100 }];
  const results = [{ id: 'die-1', gem: 'sapphire' as const, approximate: false }];
  const hint = oneCellComebackHint(board, occupied, players, 'p1', results, ['die-1']);
  assert.deepEqual(hint, { target: { rowId: 'row-a', columnId: 'goal' }, gem: 'sapphire', points: 100 });
  assert.equal(oneCellComebackHint(board, occupied, [{ id: 'p1', score: 101 }, players[1]!], 'p1', results, ['die-1']), null,
    'a sole current leader is not told they can make a comeback');
  assert.equal(oneCellComebackHint(board, occupied, players, 'p1', results, []), null,
    'an already placed die is not a live hint');
  assert.equal(oneCellComebackHint(board, occupied, players, 'p1', [{ ...results[0]!, gem: 'ruby' }], ['die-1']), null,
    'the hint is suppressed when the actual confirmed result does not match the cell');
});
