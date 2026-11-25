import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readServerMessage } from '../../shared/contracts/dice';
import { DEFAULT_GAME_RULES } from '../../shared/contracts/game-rules';

function serverState(match: unknown) {
  const players = Array.from({ length: 6 }, (_, index) => ({
    id: `player-${index + 1}`, name: `PLAYER ${index + 1}`, slot: index, online: true,
  }));
  return {
    type: 'state',
    state: {
      seats: players, turnId: null, turnSequence: 1, turnNotice: null, phase: 'ready', revision: 1,
      config: { count: 5, hz: 120 }, placements: [], results: [], remaining: [], placedThisRoll: false,
      hasLegalPlacement: false,
    },
    roll: null,
    match,
  };
}

test('固定17個を選んだ6人卓の102個と未使用数を通信データで検証する', () => {
  const players = Array.from({ length: 6 }, (_, index) => ({
    id: `player-${index + 1}`, name: `PLAYER ${index + 1}`, slot: index,
    score: 80, rank: 1, diceCount: 17,
    wallet: [{ denomination: 50, count: 1 }, { denomination: 10, count: 3 }],
  }));
  const match = {
    roundNumber: 1, totalDice: 102, rules: { victoryPoints: 700, startingDice: 17 },
    unusedDiceCount: 0, placedDiceCount: 0, completedRows: [], result: null, players,
  };
  const accepted = readServerMessage(serverState(match));
  assert.ok(accepted?.type === 'state' && accepted.match);
  assert.equal(accepted.match.totalDice, 102);
  assert.equal(accepted.match.rules.victoryPoints, 700);
  assert.equal(readServerMessage(serverState({ ...match, totalDice: 30 })), null);
  assert.equal(readServerMessage(serverState({ ...match, rules: { victoryPoints: 500, startingDice: 6 } })), null);
});

test('設定した勝利点に届いた結果を受け入れ、公式ルールの既定値を維持する', () => {
  const players = [
    { id: 'player-1', name: 'PLAYER 1', slot: 0, score: 300, rank: 1, diceCount: 8,
      wallet: [{ denomination: 100, count: 3 }] },
    { id: 'player-2', name: 'PLAYER 2', slot: 1, score: 80, rank: 2, diceCount: 8,
      wallet: [{ denomination: 50, count: 1 }, { denomination: 10, count: 3 }] },
  ];
  const result = {
    roundNumber: 1, totalDice: 30, rules: { victoryPoints: 300, startingDice: 8 },
    unusedDiceCount: 14, placedDiceCount: 0, completedRows: ['amber'],
    result: { status: 'won', highestScore: 300, winners: ['player-1'] }, players,
  };
  const accepted = readServerMessage(serverState(result));
  assert.ok(accepted?.type === 'state' && accepted.match?.result?.status === 'won');
  assert.deepEqual(DEFAULT_GAME_RULES, { victoryPoints: 500, startingDice: 'official' });
  assert.equal(readServerMessage(serverState({ ...result, result: { ...result.result, highestScore: 250 } })), null);
});
