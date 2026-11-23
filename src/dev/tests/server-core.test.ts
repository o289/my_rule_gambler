import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoardDefinition } from '../../features/board/model/board-model';
import type { DiceResult } from '../../shared/contracts/dice';
import {
  beginRoll,
  canReroll,
  confirmRoll,
  endTurnStatus,
  finishTurn,
  initialDiceGameState,
  placeDie,
  rollRequestStatus,
} from '../../platform/server/core/dice-game';
import { advanceRoll } from '../../platform/server/core/dice/roll-engine';
import {
  cancelLobbyCountdown,
  initialLobbyCountdownState,
  resolveLobbyCountdown,
  scheduleLobbyCountdown,
  updateLobbyReady,
} from '../../platform/server/core/lobby';
import { availableSeatSlot, reconnectGraceExpired, roomGraceExpired } from '../../platform/server/core/participant-lifecycle';

test('lobby countdown is generation-checked, waits for its deadline, and freezes eligible seats once', () => {
  const players = [
    { id: 'late-seat', name: 'B', slot: 1, online: true, ready: false },
    { id: 'first-seat', name: 'A', slot: 0, online: true, ready: true },
  ];
  const updated = updateLobbyReady(players, 'late-seat', true, false)!;
  assert.equal(players[0]?.ready, false);
  assert.equal(updateLobbyReady(updated, 'late-seat', false, true), null);
  const scheduled = scheduleLobbyCountdown(initialLobbyCountdownState(), updated, 1_000, 3_000);
  assert.equal(scheduled.startAt, 4_000);
  assert.equal(resolveLobbyCountdown(scheduled, updated, scheduled.generation, 3_999).status, 'early');
  const started = resolveLobbyCountdown(scheduled, updated, scheduled.generation, 4_000);
  assert.equal(started.status, 'started');
  if (started.status === 'started') {
    assert.deepEqual(started.state.startedPlayers?.map(player => player.id), ['first-seat', 'late-seat']);
    assert.equal(resolveLobbyCountdown(started.state, updated, scheduled.generation, 4_000).status, 'stale');
  }

  const canceled = cancelLobbyCountdown(scheduled);
  assert.equal(resolveLobbyCountdown(canceled, updated, scheduled.generation, 4_000).status, 'stale');
  assert.equal(scheduleLobbyCountdown(canceled, [...updated, { ...updated[0]!, id: 'not-ready', ready: false }], 2_000, 3_000), canceled);
});

test('shared participant lifecycle uses exact grace boundaries and lowest free seat', () => {
  assert.equal(availableSeatSlot([{ slot: 0 }, { slot: 2 }], 4), 1);
  assert.equal(availableSeatSlot([{ slot: 0 }, { slot: 1 }], 2), null);
  assert.equal(reconnectGraceExpired(null, 90_000, 90_000), false);
  assert.equal(reconnectGraceExpired(1_000, 90_999, 90_000), false);
  assert.equal(reconnectGraceExpired(1_000, 91_000, 90_000), true);
  assert.equal(roomGraceExpired(1_000, 91_000, 90_000), true);
});

test('dice rules authorize rolls and update confirm, placement, and turn as one immutable state', () => {
  const board: BoardDefinition = {
    rows: [{ id: 'row', score: 10 }],
    columns: [{ id: 'left', gem: 'ruby' }, { id: 'right', gem: 'sapphire' }],
  };
  const results: DiceResult[] = [
    { id: 'die-1', gem: 'ruby', approximate: false },
    { id: 'die-2', gem: 'sapphire', approximate: false },
  ];
  const ready = { ...initialDiceGameState(), turnId: 'p1' };
  assert.equal(rollRequestStatus(ready, 'p2', 'initial', 'r1', new Set(), false), 'turn');
  assert.equal(rollRequestStatus(ready, 'p1', 'initial', 'r1', new Set(['r1']), false), 'duplicate');
  assert.equal(rollRequestStatus(ready, 'p1', 'initial', 'r2', new Set(), false), 'accepted');
  const rolling = beginRoll(ready, 'roll-1', 'initial', 2, []);
  assert.deepEqual(rolling.diceIds, ['die-1', 'die-2']);
  const confirming = { ...rolling.state, phase: 'confirm' as const };
  assert.equal(confirmRoll(confirming, 'p1', 'old-roll', results), null);
  assert.equal(confirmRoll(confirming, 'p2', 'roll-1', results), null);
  const placement = confirmRoll(confirming, 'p1', 'roll-1', results)!;
  assert.equal(placement.phase, 'placement');
  assert.equal(canReroll(placement, false), false);
  assert.equal(canReroll({ ...placement, placedThisRoll: true }, false), true);
  assert.equal(canReroll(placement, true), true);

  const wrongFirst = placeDie(placement, board, { rollId: 'roll-1', dieId: 'die-2', row: 0, column: 1 });
  assert.equal(wrongFirst.status, 'invalid');
  const firstPlaced = placeDie(placement, board, { rollId: 'roll-1', dieId: 'die-1', row: 0, column: 0 });
  assert.equal(firstPlaced.status, 'placed');
  if (firstPlaced.status !== 'placed') return;
  assert.equal(placement.board.size, 0);
  const finalPlaced = placeDie(firstPlaced.state, board, { rollId: 'roll-1', dieId: 'die-2', row: 0, column: 1 });
  assert.equal(finalPlaced.status, 'placed');
  if (finalPlaced.status !== 'placed') return;
  assert.equal(endTurnStatus(finalPlaced.state, board, finalPlaced.state.revision), 'allowed');
  const ended = finishTurn(finalPlaced.state, [
    { id: 'p1', online: true }, { id: 'p2', online: true }, { id: 'p3', online: false },
  ], 'p1');
  assert.equal(ended.turnId, 'p2');
  assert.equal(ended.phase, 'ready');
  assert.deepEqual(ended.remaining, []);
});

test('fixed-step roll engine caps catch-up and sends the final settled frame after periodic captures', () => {
  const physics = {
    dt: 1 / 120,
    steps: 0,
    settled: false,
    step() { this.steps += 1; this.settled = this.steps === 4; },
    frame() { return this.steps; },
  };
  const first = advanceRoll(physics, 0, 30, 120, 60);
  assert.deepEqual(first.frames, [2]);
  assert.equal(first.finalFrame, null);
  const second = advanceRoll(physics, first.accumulatorMs, 10, 120, 60);
  assert.deepEqual(second.frames, []);
  assert.equal(second.finalFrame, 4);
  assert.equal(physics.steps, 4);

  const cappedPhysics = {
    dt: 1 / 120,
    steps: 0,
    settled: false,
    step() { this.steps += 1; },
    frame() { return this.steps; },
  };
  const capped = advanceRoll(cappedPhysics, 0, 1_000, 120, 60);
  assert.equal(cappedPhysics.steps, 19);
  assert.equal(capped.frames.length, 9);
  assert.ok(capped.accumulatorMs > 0 && capped.accumulatorMs < 1_000 / 120);
});
