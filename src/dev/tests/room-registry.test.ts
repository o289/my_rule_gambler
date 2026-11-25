import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { RoomRegistry } from '../../platform/server/core/room-registry';
import { Room, ROOM_SESSION_GRACE_MS } from '../../platform/server/core/room';
import type { RoomRuntime } from '../../platform/server/core/ports';
import type { LobbyPeer, DicePeer } from '../../platform/server/core/room';
import type { ServerMessage as LobbyMessage } from '../../shared/contracts/casino-entry';
import { parseJson, readServerMessage } from '../../shared/contracts/dice';
import type { ServerMessage as DiceMessage } from '../../shared/contracts/dice';
import type { Frame, DiceResult } from '../../shared/contracts/dice';
import { createGoalBoard } from '../../features/board/model/goal-layout';
import { cellKey, nextOpenCell, playableColumns, requiredGemAt } from '../../features/board/model/board-model';
import { settlementStages } from '../../features/dice/model/settlement-presentation';

let serial = 0;
let boardSeedCalls = 0;
let completeRoll: ((frame: Frame, results: readonly DiceResult[], nudges: number, deadline: boolean) => void) | null = null;
const runtime: RoomRuntime = {
  now: () => Date.now(),
  createPlayerId: () => `player-${++serial}`,
  createToken: () => String(++serial).padStart(32, 't'),
  createBoardSeed: () => { boardSeedCalls += 1; return 17; },
  schedule: (callback, ms) => setTimeout(callback, ms),
  cancelTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  createRoll: (input, callbacks) => {
    completeRoll = callbacks.finished;
    const initialFrame: Frame = { rollId: input.rollId, seq: 0, simMs: 0, phase: 'rolling', hits: [], dice: input.ids.map(id => ({ id, p: [0, 1, 0], q: [0, 0, 0, 1], stopped: false })) };
    return { initialFrame, start() {}, stop() {} };
  },
  allowPreviewDev: false,
};

class LobbyGuest implements LobbyPeer {
  readonly protocol = 'lobby' as const;
  readonly messages: LobbyMessage[] = [];
  close() {}
  send(message: LobbyMessage) { this.messages.push(message); }
  get welcome() { const value = this.messages.find(message => message.type === 'welcome'); assert.ok(value?.type === 'welcome'); return value; }
  get state() { const value = [...this.messages].reverse().find(message => message.type === 'state' || message.type === 'welcome'); assert.ok(value && (value.type === 'state' || value.type === 'welcome')); return value.state; }
}

class DiceGuest implements DicePeer {
  readonly protocol = 'dice' as const;
  readonly messages: DiceMessage[] = [];
  close() {}
  send(message: DiceMessage) { assert.ok(readServerMessage(parseJson(JSON.stringify(message)))); this.messages.push(message); return true; }
}

test('one registry Room carries the frozen lobby seats into the dice connection', async () => {
  const registry = new RoomRegistry(runtime, 15);
  try {
    const room = registry.create({ id: 'a1b2c3d4', name: 'テスト卓' });
    assert.ok(room);
    assert.equal(registry.get('a1b2c3d4'), room);
    assert.equal(registry.create({ id: 'a1b2c3d4', name: 'duplicate' }), null);
    const lobby = [new LobbyGuest(), new LobbyGuest()];
    lobby.forEach(peer => room.connectLobby(peer));
    lobby.forEach(peer => room.commandLobby(peer.welcome.playerId, peer, { type: 'ready', ready: true }));
    await delay(25);
    assert.equal(lobby[0]!.state.phase, 'started');
    const frozen = lobby[0]!.state.startedPlayers;
    assert.deepEqual(frozen?.map(seat => seat.id), lobby.map(peer => peer.welcome.playerId));

    const dice = lobby.map(() => new DiceGuest());
    dice.forEach((peer, index) => {
      const welcome = lobby[index]!.welcome;
      assert.equal(room.connectDice(peer, { token: welcome.token, dev: true }), welcome.playerId);
    });
    const states = dice.map(peer => peer.messages.find(message => message.type === 'welcome'));
    assert.ok(states.every(message => message?.type === 'welcome'));
    if (states[0]?.type === 'welcome') {
      assert.deepEqual(states[0].state.seats.map(seat => seat.id), frozen?.map(seat => seat.id));
      assert.equal(states[0].dev, false, 'standard rooms never grant preview development controls');
      assert.deepEqual(states[0].match?.players.map(player => player.diceCount), [15, 15]);
    }
    const firstId = lobby[0]!.welcome.playerId;
    room.commandDice(firstId, dice[0]!, { type: 'roll', requestId: 'first-roll', turnSequence: 1 });
    const rolling = [...dice[0]!.messages].reverse().find(message => message.type === 'state' && message.state.phase === 'rolling');
    assert.ok(rolling?.type === 'state' && rolling.roll);
    const rollId = rolling.roll.id;
    const definition = createGoalBoard(17);
    const scoredRowIndex = definition.rows.findIndex(row => row.score < 0 && row.cells && Object.keys(row.cells).length === 1);
    assert.notEqual(scoredRowIndex, -1);
    const scoredRow = definition.rows[scoredRowIndex]!;
    const open = nextOpenCell(definition, new Map(), scoredRow.id);
    assert.ok(open);
    const gem = requiredGemAt(definition, open);
    assert.ok(gem);
    const results = rolling.roll.latest.dice.map(die => ({ id: die.id, gem, approximate: false }));
    const settled: Frame = { ...rolling.roll.latest, phase: 'settled', seq: 1, dice: rolling.roll.latest.dice.map(die => ({ ...die, stopped: true })) };
    assert.ok(completeRoll);
    completeRoll(settled, results, 0, false);
    room.commandDice(firstId, dice[0]!, { type: 'confirm', rollId });
    const beforePlace = [...dice[0]!.messages].reverse().find(message => message.type === 'state' && message.state.phase === 'placement');
    assert.ok(beforePlace?.type === 'state');
    const column = definition.columns.findIndex(item => item.id === open.columnId);
    const place = { type: 'place' as const, rollId, dieId: results[0]!.id, row: scoredRowIndex, column, revision: beforePlace.state.revision };
    room.commandDice(firstId, dice[0]!, place);
    const placed = [...dice[0]!.messages].reverse().find(message => message.type === 'state' && message.state.placements.length > 0);
    assert.ok(placed?.type === 'state');
    const settlementMessages = dice.map(peer => peer.messages.filter(message => message.type === 'state' && message.settlement));
    assert.deepEqual(settlementMessages.map(messages => messages.length), [1, 1], 'all online players receive one transient settlement event');
    const scoreEvent = settlementMessages[0]?.[0];
    assert.ok(scoreEvent?.type === 'state' && scoreEvent.settlement);
    if (scoreEvent?.type === 'state' && scoreEvent.settlement) {
      assert.equal(scoreEvent.settlement.points, -10, 'the event carries the actual paid amount');
      assert.equal(scoreEvent.settlement.rowPoints, scoredRow.score);
      assert.equal(scoreEvent.settlement.revision, scoreEvent.state.revision);
      assert.deepEqual(scoreEvent.settlement.beforeRanks.map(player => player.rank), [1, 1]);
      assert.deepEqual(scoreEvent.settlement.afterRanks.map(player => player.rank), [2, 1]);
      assert.equal(scoreEvent.settlement.gameEnded, false);
    }
    if (placed?.type === 'state') {
      assert.equal(placed.match?.players[0]?.score, 70, 'the negative goal charges only ten points once');
      assert.deepEqual(placed.match?.players[0]?.wallet, [{ denomination: 50, count: 1 }, { denomination: 10, count: 2 }]);
      assert.deepEqual(placed.match?.completedRows, [scoredRow.id]);
      room.commandDice(firstId, dice[0]!, place);
      const afterDuplicate = [...dice[0]!.messages].reverse().find(message => message.type === 'state');
      assert.ok(afterDuplicate?.type === 'state');
      assert.equal(afterDuplicate.match?.players[0]?.score, 70, 'a stale duplicate placement cannot settle twice');
      assert.equal(dice[0]!.messages.filter(message => message.type === 'state' && message.settlement).length, 1,
        'a stale duplicate placement does not emit or replay another settlement');
    }
    const replacement = new DiceGuest();
    room.connectDice(replacement, { token: lobby[0]!.welcome.token });
    const resumed = replacement.messages.find(message => message.type === 'welcome');
    assert.ok(resumed?.type === 'welcome');
    if (resumed?.type === 'welcome' && placed?.type === 'state') {
      assert.equal('settlement' in resumed, false, 'reconnect welcome sends a baseline without replaying the prior effect');
      assert.deepEqual(resumed.state.placements, placed.state.placements);
      assert.equal(resumed.state.revision, placed.state.revision);
      assert.equal(resumed.state.turnId, placed.state.turnId);
      assert.equal(resumed.state.placements[0]?.dieId, results[0]!.id);
      assert.equal(resumed.match?.players[0]?.diceCount, 14);
      assert.equal(resumed.match?.players[0]?.score, 70);
      assert.equal(resumed.match?.placedDiceCount, 1);
      room.disconnect(firstId, dice[0]!);
      room.commandDice(firstId, replacement, { type: 'end-turn', revision: placed.state.revision });
      const afterOldClose = [...replacement.messages].reverse().find(message => message.type === 'state');
      assert.ok(afterOldClose?.type === 'state');
      assert.equal(afterOldClose.state.seats[0]?.online, true, 'a replaced socket closing later cannot mark its seat offline');
    }
    assert.equal(room.connectDice(new DiceGuest(), { token: String('x').repeat(32) }), null);
  } finally { registry.dispose(); }
});

test('standard startup allocates thirty dice and eighty points exactly once for two to six seats', async () => {
  const dicePerPlayer = [0, 0, 15, 10, 7, 6, 5];
  for (let count = 2; count <= 6; count += 1) {
    const registry = new RoomRegistry(runtime, 5);
    try {
      const room = registry.create({ id: `${count}0000000`, name: `卓${count}` });
      assert.ok(room);
      const before = boardSeedCalls;
      const lobby = Array.from({ length: count }, () => new LobbyGuest());
      lobby.forEach(peer => room.connectLobby(peer));
      lobby.forEach(peer => room.commandLobby(peer.welcome.playerId, peer, { type: 'ready', ready: true }));
      await delay(20);
      assert.equal(lobby[0]!.state.phase, 'started');
      assert.equal(boardSeedCalls - before, 1, 'the start creates one board and one match');
      const dice = lobby.map(() => new DiceGuest());
      dice.forEach((peer, index) => room.connectDice(peer, { token: lobby[index]!.welcome.token }));
      const welcomes = dice.map(peer => peer.messages.find(message => message.type === 'welcome'));
      assert.ok(welcomes.every(message => message?.type === 'welcome' && message.match));
      if (welcomes[0]?.type === 'welcome' && welcomes[0].match) {
        const setup = welcomes[0].match;
        assert.deepEqual(setup.players.map(player => player.diceCount), Array(count).fill(dicePerPlayer[count]));
        assert.ok(setup.players.every(player => player.score === 80
          && player.wallet.reduce((sum, group) => sum + group.denomination * group.count, 0) === 80));
        assert.equal(setup.unusedDiceCount, count === 4 ? 2 : 0);
        assert.equal(setup.placedDiceCount, 0);
        assert.equal(welcomes[0].state.turnId, lobby[0]!.welcome.playerId);
        assert.deepEqual(setup.players.map(player => player.id), lobby.map(peer => peer.welcome.playerId));
        const firstWallet = setup.players[0]?.wallet;
        assert.deepEqual(firstWallet, [{ denomination: 50, count: 1 }, { denomination: 10, count: 3 }]);
      }
      assert.equal(boardSeedCalls - before, 1, 'subsequent player connections reuse the started board');
    } finally { registry.dispose(); }
  }
});

test('room snapshot reopens the seat and rolls back an unconfirmed physical result', async () => {
  const info = { id: 'baddcafe', name: '復旧確認' };
  const room = new Room(info, runtime, { mode: 'standard', countdownMs: 5 });
  const lobby = [new LobbyGuest(), new LobbyGuest()];
  lobby.forEach(peer => room.connectLobby(peer));
  lobby.forEach(peer => room.commandLobby(peer.welcome.playerId, peer, { type: 'ready', ready: true }));
  await delay(20);

  const dice = [new DiceGuest(), new DiceGuest()];
  dice.forEach((peer, index) => room.connectDice(peer, { token: lobby[index]!.welcome.token }));
  const firstId = lobby[0]!.welcome.playerId;
  room.commandDice(firstId, dice[0]!, { type: 'roll', requestId: 'interrupted-roll', turnSequence: 1 });
  const rolling = [...dice[0]!.messages].reverse().find(message => message.type === 'state' && message.state.phase === 'rolling');
  assert.ok(rolling?.type === 'state' && rolling.roll);
  const settledFrame: Frame = { ...rolling.roll.latest, phase: 'settled', seq: 1,
    dice: rolling.roll.latest.dice.map(die => ({ ...die, stopped: true })) };
  assert.ok(completeRoll);
  completeRoll(settledFrame, settledFrame.dice.map(die => ({ id: die.id, gem: 'ruby', approximate: false })), 0, false);
  const confirmed = [...dice[0]!.messages].reverse().find(message => message.type === 'state' && message.state.phase === 'confirm');
  assert.ok(confirmed?.type === 'state' && confirmed.roll?.results.length);

  const snapshot = room.snapshot();
  assert.equal(snapshot.game?.phase, 'ready', 'a physics result that was not confirmed is not durable');
  assert.equal(snapshot.rollView, null);
  const restored = Room.restore(info, runtime, snapshot);
  assert.ok(restored);
  const returned = new DiceGuest();
  assert.equal(restored.connectDice(returned, { token: lobby[0]!.welcome.token }), firstId);
  const welcome = returned.messages.find(message => message.type === 'welcome');
  assert.ok(welcome?.type === 'welcome');
  assert.equal(welcome.state.phase, 'ready');
  assert.equal(welcome.roll, null);
  assert.equal(welcome.match?.players.find(player => player.id === firstId)?.score, 80);

  const beforeDuplicate = returned.messages.length;
  restored.commandDice(firstId, returned, { type: 'roll', requestId: 'interrupted-roll', turnSequence: 1 });
  assert.equal(returned.messages.length, beforeDuplicate, 'the accepted operation ID is still remembered after rollback');

  const expired = restored.snapshot();
  const member = expired.participants.find(participant => participant.id === firstId);
  assert.ok(member);
  member.online = false;
  member.leftAt = Date.now() - ROOM_SESSION_GRACE_MS - 1;
  expired.lastOccupiedAt = member.leftAt;
  const afterExpiry = Room.restore(info, runtime, expired);
  assert.ok(afterExpiry);
  afterExpiry.prune(Date.now());
  const rejected = new LobbyGuest();
  assert.equal(afterExpiry.connectLobby(rejected, lobby[0]!.welcome.token), null);
  assert.ok(rejected.messages.some(message => message.type === 'error' && message.code === 'TOKEN'));
  assert.equal(afterExpiry.info.id, info.id, 'expiring a seat keeps the room metadata intact');
});

test('preview rooms are isolated from reserved eight-hex gameplay rooms', () => {
  const registry = new RoomRegistry(runtime);
  try {
    const preview = registry.createPreview('table-a');
    const otherPreview = registry.createPreview('table-b');
    const game = registry.create({ id: 'deadbeef', name: '通常卓' });
    assert.ok(preview && otherPreview && game);
    assert.notEqual(preview, otherPreview);
    assert.notEqual(preview, game);
    assert.equal(registry.getPreview('table-a'), preview);
    assert.equal(registry.createPreview('table-a'), preview);
    assert.equal(registry.create({ id: 'not-a-room', name: '誤入力' }), null);
  } finally { registry.dispose(); }
});

test('standard turns hand off after the last used die and after a confirmed roll has no legal cell', async () => {
  const definition = createGoalBoard(17);
  const firstCells = definition.rows.flatMap((row, rowIndex) => {
    const cell = nextOpenCell(definition, new Set<string>(), row.id);
    const gem = cell && requiredGemAt(definition, cell);
    return cell && gem ? [{ rowIndex, column: definition.columns.findIndex(item => item.id === cell.columnId), gem }] : [];
  });
  assert.equal(new Set(firstCells.map(cell => cell.gem)).size, 6);

  const registry = new RoomRegistry(runtime, 5);
  try {
    const room = registry.create({ id: 'a11ce001', name: '手番の自動更新' });
    assert.ok(room);
    const lobby = [new LobbyGuest(), new LobbyGuest()];
    lobby.forEach(peer => room.connectLobby(peer));
    lobby.forEach(peer => room.commandLobby(peer.welcome.playerId, peer, { type: 'ready', ready: true }));
    await delay(20);
    const dice = [new DiceGuest(), new DiceGuest()];
    dice.forEach((peer, index) => room.connectDice(peer, { token: lobby[index]!.welcome.token }));
    const firstId = lobby[0]!.welcome.playerId;
    const secondId = lobby[1]!.welcome.playerId;

    room.commandDice(secondId, dice[1]!, { type: 'roll', requestId: 'wrong-turn', turnSequence: 1 });
    assert.ok(dice[1]!.messages.some(message => message.type === 'error' && message.code === 'TURN'));
    room.commandDice(firstId, dice[0]!, { type: 'roll', requestId: 'fill-used-dice', turnSequence: 1 });
    const firstRoll = [...dice[0]!.messages].reverse().find(message => message.type === 'state' && message.state.phase === 'rolling');
    assert.ok(firstRoll?.type === 'state' && firstRoll.roll);
    const filledResults = firstRoll.roll.latest.dice.map((die, index) => ({
      id: die.id, gem: firstCells[index]!.gem, approximate: false,
    }));
    const filledFrame: Frame = { ...firstRoll.roll.latest, phase: 'settled', seq: 1,
      dice: firstRoll.roll.latest.dice.map(die => ({ ...die, stopped: true })) };
    assert.ok(completeRoll);
    completeRoll(filledFrame, filledResults, 0, false);

    const confirmState = [...dice[0]!.messages].reverse().find(message => message.type === 'state' && message.state.phase === 'confirm');
    assert.ok(confirmState?.type === 'state' && confirmState.roll);
    const rejectedBeforeConfirm = { type: 'place' as const, rollId: confirmState.roll.id,
      dieId: filledResults[0]!.id, row: firstCells[0]!.rowIndex, column: firstCells[0]!.column, revision: confirmState.state.revision };
    room.commandDice(firstId, dice[0]!, rejectedBeforeConfirm);
    assert.equal(dice[0]!.messages.filter(message => message.type === 'state' && message.state.placements.length > 0).length, 0);
    room.commandDice(firstId, dice[0]!, { type: 'confirm', rollId: confirmState.roll.id });

    for (const die of filledResults) {
      const current = [...dice[0]!.messages].reverse().find(message => message.type === 'state' && message.state.phase === 'placement');
      assert.ok(current?.type === 'state');
      const occupied = new Set(current.state.placements.flatMap(placement => {
        const row = definition.rows[placement.row];
        const column = definition.columns[placement.column];
        return row && column ? [cellKey({ rowId: row.id, columnId: column.id })] : [];
      }));
      const target = definition.rows.flatMap((row, rowIndex) => {
        const cell = nextOpenCell(definition, occupied, row.id);
        return cell && requiredGemAt(definition, cell) === die.gem
          ? [{ rowIndex, column: definition.columns.findIndex(item => item.id === cell.columnId) }] : [];
      })[0];
      assert.ok(target, `the ${die.gem} die has a legal target`);
      room.commandDice(firstId, dice[0]!, { type: 'place', rollId: confirmState.roll.id, dieId: die.id,
        row: target.rowIndex, column: target.column, revision: current.state.revision });
    }
    const afterAllUsed = [...dice[0]!.messages].reverse().find(message => message.type === 'state');
    assert.ok(afterAllUsed?.type === 'state');
    assert.equal(afterAllUsed.state.phase, 'ready');
    assert.equal(afterAllUsed.state.turnId, secondId);
    assert.equal(afterAllUsed.state.turnSequence, 2);
    assert.equal(afterAllUsed.state.placements.length, 5);
    assert.equal(afterAllUsed.match?.players[0]?.diceCount, 10);
  } finally { registry.dispose(); }

  const noMoveRegistry = new RoomRegistry(runtime, 5);
  try {
    const room = noMoveRegistry.create({ id: 'b00b0001', name: '候補なし' });
    assert.ok(room);
    const lobby = [new LobbyGuest(), new LobbyGuest()];
    lobby.forEach(peer => room.connectLobby(peer));
    lobby.forEach(peer => room.commandLobby(peer.welcome.playerId, peer, { type: 'ready', ready: true }));
    await delay(20);
    const dice = [new DiceGuest(), new DiceGuest()];
    dice.forEach((peer, index) => room.connectDice(peer, { token: lobby[index]!.welcome.token }));
    const playerId = lobby[0]!.welcome.playerId;

    room.commandDice(playerId, dice[0]!, { type: 'roll', requestId: 'topaz-start', turnSequence: 1 });
    const initial = [...dice[0]!.messages].reverse().find(message => message.type === 'state' && message.state.phase === 'rolling');
    assert.ok(initial?.type === 'state' && initial.roll);
    const topaz = initial.roll.latest.dice.map(die => ({ id: die.id, gem: 'topaz' as const, approximate: false }));
    const topazFrame: Frame = { ...initial.roll.latest, phase: 'settled', seq: 1,
      dice: initial.roll.latest.dice.map(die => ({ ...die, stopped: true })) };
    assert.ok(completeRoll);
    completeRoll(topazFrame, topaz, 0, false);
    room.commandDice(playerId, dice[0]!, { type: 'confirm', rollId: initial.roll.id });
    const confirmed = [...dice[0]!.messages].reverse().find(message => message.type === 'state' && message.state.phase === 'placement');
    assert.ok(confirmed?.type === 'state' && confirmed.roll);
    const topazCell = definition.rows.flatMap((row, rowIndex) => {
      const cell = nextOpenCell(definition, new Set<string>(), row.id);
      return cell && requiredGemAt(definition, cell) === 'topaz'
        ? [{ rowIndex, column: definition.columns.findIndex(item => item.id === cell.columnId) }] : [];
    })[0];
    assert.ok(topazCell);
    room.commandDice(playerId, dice[0]!, { type: 'place', rollId: confirmed.roll.id, dieId: topaz[0]!.id,
      row: topazCell.rowIndex, column: topazCell.column, revision: confirmed.state.revision });
    const partial = [...dice[0]!.messages].reverse().find(message => message.type === 'state' && message.state.placements.length === 1);
    assert.ok(partial?.type === 'state');
    assert.equal(partial.state.hasLegalPlacement, false);
    assert.equal(partial.state.phase, 'placement', 'no candidate after a placement still permits REROLL or END TURN');
    assert.equal(partial.state.remaining.length, 4);

    room.commandDice(playerId, dice[0]!, { type: 'reroll', requestId: 'topaz-reroll', turnSequence: 1 });
    const rerolling = [...dice[0]!.messages].reverse().find(message => message.type === 'state' && message.state.phase === 'rolling');
    assert.ok(rerolling?.type === 'state' && rerolling.roll);
    assert.equal(rerolling.roll.kind, 'reroll');
    assert.deepEqual(rerolling.roll.latest.dice.map(die => die.id), partial.state.remaining);
    const rerolled = rerolling.roll.latest.dice.map(die => ({ id: die.id, gem: 'topaz' as const, approximate: false }));
    const rerolledFrame: Frame = { ...rerolling.roll.latest, phase: 'settled', seq: 1,
      dice: rerolling.roll.latest.dice.map(die => ({ ...die, stopped: true })) };
    assert.ok(completeRoll);
    completeRoll(rerolledFrame, rerolled, 0, false);
    room.commandDice(playerId, dice[0]!, { type: 'confirm', rollId: rerolling.roll.id });
    const afterNoMoves = [...dice[0]!.messages].reverse().find(message => message.type === 'state');
    assert.ok(afterNoMoves?.type === 'state');
    assert.equal(afterNoMoves.state.phase, 'ready');
    assert.equal(afterNoMoves.state.turnId, lobby[1]!.welcome.playerId);
    assert.equal(afterNoMoves.state.turnSequence, 2);
    assert.equal(afterNoMoves.state.turnNotice, 'no-legal-placement');
    assert.equal(afterNoMoves.match?.players[0]?.diceCount, 14, 'only the die placed in the first roll left the hand');

    room.commandDice(lobby[1]!.welcome.playerId, dice[1]!, { type: 'roll', requestId: 'clear-no-move', turnSequence: 2 });
    const nextRoll = [...dice[0]!.messages].reverse().find(message => message.type === 'state' && message.state.phase === 'rolling');
    assert.ok(nextRoll?.type === 'state');
    assert.equal(nextRoll.state.turnNotice, null, 'the no-placement notice remains until the next normal ROLL');
  } finally { noMoveRegistry.dispose(); }
});

test('a completed sub-500 board publishes its settlement then starts a fresh round from all thirty dice', async () => {
  const registry = new RoomRegistry(runtime, 5);
  try {
    const room = registry.create({ id: 'f011b0a2', name: '完成盤面' });
    assert.ok(room);
    const lobby = [new LobbyGuest(), new LobbyGuest()];
    lobby.forEach(peer => room.connectLobby(peer));
    lobby.forEach(peer => room.commandLobby(peer.welcome.playerId, peer, { type: 'ready', ready: true }));
    await delay(20);
    const dice = [new DiceGuest(), new DiceGuest()];
    dice.forEach((peer, index) => room.connectDice(peer, { token: lobby[index]!.welcome.token }));
    const ids = lobby.map(peer => peer.welcome.playerId);
    const definition = createGoalBoard(17);
    const targets = definition.rows.flatMap((row, rowIndex) => playableColumns(definition, row).flatMap(column => {
      const gem = requiredGemAt(definition, { rowId: row.id, columnId: column.id });
      return gem ? [{ rowIndex, column: definition.columns.findIndex(item => item.id === column.id), gem }] : [];
    }));
    assert.equal(targets.length, 21);

    const latest = (peer: DiceGuest) => {
      const message = [...peer.messages].reverse().find(item => item.type === 'state' || item.type === 'welcome');
      assert.ok(message && (message.type === 'state' || message.type === 'welcome'));
      return message.state;
    };
    let placed = 0;
    let rollNumber = 0;
    while (placed < targets.length) {
      const current = latest(dice[0]!);
      const playerIndex = ids.indexOf(current.turnId ?? '');
      assert.notEqual(playerIndex, -1);
      const peer = dice[playerIndex]!;
      const chunkSize = placed < 16 ? 4 : 5;
      const chunk = targets.slice(placed, placed + chunkSize);
      const sequence = current.turnSequence;
      room.commandDice(ids[playerIndex]!, peer, { type: 'roll', requestId: `complete-roll-${++rollNumber}`, turnSequence: sequence });
      const rolling = [...peer.messages].reverse().find(item => item.type === 'state' && item.state.phase === 'rolling');
      assert.ok(rolling?.type === 'state' && rolling.roll);
      const results = rolling.roll.latest.dice.map((die, index) => ({
        id: die.id, gem: chunk[index]?.gem ?? 'ruby' as const, approximate: false,
      }));
      const frame: Frame = { ...rolling.roll.latest, phase: 'settled', seq: 1,
        dice: rolling.roll.latest.dice.map(die => ({ ...die, stopped: true })) };
      assert.ok(completeRoll);
      completeRoll(frame, results, 0, false);
      room.commandDice(ids[playerIndex]!, peer, { type: 'confirm', rollId: rolling.roll.id });

      for (const target of chunk) {
        const state = latest(peer);
        const die = results.find(item => item.gem === target.gem && state.remaining.includes(item.id));
        assert.ok(die, `a die matches row ${target.rowIndex} column ${target.column}`);
        room.commandDice(ids[playerIndex]!, peer, { type: 'place', rollId: rolling.roll.id, dieId: die.id,
          row: target.rowIndex, column: target.column, revision: state.revision });
        placed += 1;
      }
      if (chunkSize === 4) {
        const currentState = latest(peer);
        room.commandDice(ids[playerIndex]!, peer, { type: 'end-turn', revision: currentState.revision, turnSequence: currentState.turnSequence });
      }
    }

    const finalState = latest(dice[0]!);
    assert.ok(finalState.turnId);
    assert.equal(finalState.placements.length, 0);
    assert.equal(finalState.phase, 'ready');
    assert.equal(finalState.turnSequence, 6, 'the next round starts at the seat after the final placer');
    assert.equal(finalState.revision, 31, 'revision remains monotonic across the new board');
    assert.equal(finalState.boardSeed, 18, 'a repeated runtime seed is advanced to make a fresh board identity');
    const finalRound = [...dice[0]!.messages].reverse().find(item => item.type === 'state' && item.match?.result?.status === 'continue');
    assert.ok(finalRound?.type === 'state' && finalRound.match);
    assert.equal(finalRound.state.placements.length, 21);
    assert.equal(finalRound.match.completedRows.length, 6);
    assert.equal(finalRound.match.roundNumber, 1);
    assert.equal(finalRound.match.result?.status, 'continue');
    assert.deepEqual(dice.map(peer => peer.messages.filter(item => item.type === 'state' && item.settlement).length), [6, 6]);
    assert.equal(finalState.turnId, ids[(ids.indexOf(finalRound.state.turnId ?? '') + 1) % ids.length],
      'the next round begins with the fixed seat after the previous final placer');
    const finalMatch = [...dice[0]!.messages].reverse().find(item => item.type === 'state' && item.match?.roundNumber === 2);
    assert.ok(finalMatch?.type === 'state' && finalMatch.match);
    assert.equal(finalMatch.match.roundNumber, 2);
    assert.equal(finalMatch.match.result, null);
    assert.deepEqual(finalMatch.match.players.map(player => player.diceCount), [15, 15]);
    assert.equal(finalMatch.match.unusedDiceCount, 0);
    assert.equal(finalMatch.match.placedDiceCount, 0);
    assert.deepEqual(finalMatch.match.players.map(player => player.score), finalRound.match.players.map(player => player.score));
    const stateMessagesBefore = dice.flatMap(peer => peer.messages).filter(item => item.type === 'state').length;
    const nextPlayerIndex = ids.indexOf(finalState.turnId);
    assert.notEqual(nextPlayerIndex, -1);
    const nextPeer = dice[nextPlayerIndex]!;
    const staleRoll = [...dice[0]!.messages].reverse().find(item => item.type === 'state' && item.state.boardSeed === 17 && item.roll);
    assert.ok(staleRoll?.type === 'state' && staleRoll.roll);
    room.commandDice(finalState.turnId, nextPeer, {
      type: 'end-turn', revision: finalRound.state.revision, turnSequence: finalRound.state.turnSequence,
    });
    room.commandDice(finalState.turnId, nextPeer, {
      type: 'place', rollId: staleRoll.roll.id, dieId: 'stale-die', row: 0, column: 0, revision: finalRound.state.revision,
    });
    room.commandDice(finalState.turnId, nextPeer, {
      type: 'roll', requestId: 'old-round-sequence', turnSequence: finalRound.state.turnSequence,
    });
    assert.equal(dice.flatMap(peer => peer.messages).filter(item => item.type === 'state').length, stateMessagesBefore);
  } finally { registry.dispose(); }
});

test('a four-player completed board redeals seven dice each, leaves two unused, and preserves scores', async () => {
  const registry = new RoomRegistry(runtime, 5);
  try {
    const room = registry.create({ id: '4d1ce004', name: '4人再配分' });
    assert.ok(room);
    const lobby = Array.from({ length: 4 }, () => new LobbyGuest());
    lobby.forEach(peer => room.connectLobby(peer));
    lobby.forEach(peer => room.commandLobby(peer.welcome.playerId, peer, { type: 'ready', ready: true }));
    await delay(20);
    const dice = lobby.map(() => new DiceGuest());
    dice.forEach((peer, index) => room.connectDice(peer, { token: lobby[index]!.welcome.token }));
    const ids = lobby.map(peer => peer.welcome.playerId);
    const definition = createGoalBoard(17);
    const targets = definition.rows.flatMap((row, rowIndex) => playableColumns(definition, row).flatMap(column => {
      const gem = requiredGemAt(definition, { rowId: row.id, columnId: column.id });
      return gem ? [{ rowIndex, column: definition.columns.findIndex(item => item.id === column.id), gem }] : [];
    }));
    const chunks = [3, 4, 2, 2, 2, 3, 2, 2, 1];
    const players = [0, 1, 2, 3, 0, 1, 2, 3, 0];
    let offset = 0;
    for (let turn = 0; turn < chunks.length; turn += 1) {
      const playerIndex = players[turn];
      const count = chunks[turn];
      assert.ok(playerIndex !== undefined && count !== undefined);
      const peer = dice[playerIndex]!;
      const chunk = targets.slice(offset, offset + count);
      const current = [...peer.messages].reverse().find(item => item.type === 'state' || item.type === 'welcome');
      assert.ok(current && (current.type === 'state' || current.type === 'welcome'));
      room.commandDice(ids[playerIndex]!, peer, { type: 'roll', requestId: `four-player-${turn}`, turnSequence: current.state.turnSequence });
      const rolling = [...peer.messages].reverse().find(item => item.type === 'state' && item.state.phase === 'rolling');
      assert.ok(rolling?.type === 'state' && rolling.roll);
      const results = rolling.roll.latest.dice.map((die, index) => ({
        id: die.id, gem: chunk[index]?.gem ?? 'ruby' as const, approximate: false,
      }));
      assert.ok(completeRoll);
      completeRoll({ ...rolling.roll.latest, phase: 'settled', seq: 1,
        dice: rolling.roll.latest.dice.map(die => ({ ...die, stopped: true })) }, results, 0, false);
      room.commandDice(ids[playerIndex]!, peer, { type: 'confirm', rollId: rolling.roll.id });
      for (const target of chunk) {
        const placedState = [...peer.messages].reverse().find(item => item.type === 'state' || item.type === 'welcome');
        assert.ok(placedState && (placedState.type === 'state' || placedState.type === 'welcome'));
        const die = results.find(item => item.gem === target?.gem && placedState.state.remaining.includes(item.id));
        assert.ok(target && die);
        room.commandDice(ids[playerIndex]!, peer, { type: 'place', rollId: rolling.roll.id, dieId: die.id,
          row: target.rowIndex, column: target.column, revision: placedState.state.revision });
      }
      offset += count;
      if (count < results.length) {
        const after = [...peer.messages].reverse().find(item => item.type === 'state' || item.type === 'welcome');
        assert.ok(after && (after.type === 'state' || after.type === 'welcome'));
        room.commandDice(ids[playerIndex]!, peer, { type: 'end-turn', revision: after.state.revision,
          turnSequence: after.state.turnSequence });
      }
      if (turn === 5) {
        const exhausted = [...peer.messages].reverse().find(item => item.type === 'state' && item.match?.roundNumber === 1);
        assert.ok(exhausted?.type === 'state' && exhausted.match);
        assert.equal(exhausted.match.players[1]?.diceCount, 0, 'seat two has no dice immediately before the final player');
      }
    }
    const continued = [...dice[0]!.messages].reverse().find(item => item.type === 'state' && item.match?.roundNumber === 1);
    assert.ok(continued?.type === 'state' && continued.match);
    const scoresAtRoundEnd = continued.match.players.map(player => player.score);
    assert.equal(continued.state.placements.length, 21);
    assert.equal(new Set(continued.state.placements.map(item => item.dieId)).size, 21);
    const next = [...dice[0]!.messages].reverse().find(item => item.type === 'state' && item.match?.roundNumber === 2);
    assert.ok(next?.type === 'state' && next.match);
    assert.equal(next.state.placements.length, 0);
    assert.equal(next.match.roundNumber, 2);
    assert.equal(next.match.unusedDiceCount, 2);
    assert.deepEqual(next.match.players.map(player => player.diceCount), [7, 7, 7, 7]);
    assert.deepEqual(next.match.players.map(player => player.score), scoresAtRoundEnd);
    assert.equal(next.match.placedDiceCount + next.match.unusedDiceCount
      + next.match.players.reduce((sum, player) => sum + player.diceCount, 0), 30);
    assert.equal(next.state.turnId, ids[1], 'the seat after the final placer starts, even if it had exhausted its previous hand');
    assert.deepEqual(next.match.players.map(player => player.wallet), continued.match.players.map(player => player.wallet));
  } finally { registry.dispose(); }
});

test('reaching 500 ends the match and players can return individually before a fresh match', async () => {
  const registry = new RoomRegistry(runtime, 5);
  try {
    const room = registry.create({ id: 'c0ffee22', name: '終局と再接続' });
    assert.ok(room);
    const lobby = [new LobbyGuest(), new LobbyGuest()];
    lobby.forEach(peer => room.connectLobby(peer));
    lobby.forEach(peer => room.commandLobby(peer.welcome.playerId, peer, { type: 'ready', ready: true }));
    await delay(20);
    const dice = [new DiceGuest(), new DiceGuest()];
    dice.forEach((peer, index) => room.connectDice(peer, { token: lobby[index]!.welcome.token }));
    const ids = lobby.map(peer => peer.welcome.playerId);
    const latest = (peer: DiceGuest) => {
      const message = [...peer.messages].reverse().find(item => item.type === 'state' || item.type === 'welcome');
      assert.ok(message && (message.type === 'state' || message.type === 'welcome'));
      return message;
    };
    const playTargets = (roundSeed: number, round: number) => {
      const definition = createGoalBoard(roundSeed);
      const positivePrefixes = definition.rows.flatMap((row, rowIndex) => row.score > 0
        ? playableColumns(definition, row).slice(0, -1).map(column => ({
          rowIndex, column: definition.columns.findIndex(item => item.id === column.id), gem: requiredGemAt(definition, { rowId: row.id, columnId: column.id }),
        })) : []);
      const positiveGoals = definition.rows.flatMap((row, rowIndex) => row.score > 0
        ? playableColumns(definition, row).slice(-1).map(column => ({
          rowIndex, column: definition.columns.findIndex(item => item.id === column.id), gem: requiredGemAt(definition, { rowId: row.id, columnId: column.id }),
        })) : []);
      const negativeGoal = definition.rows.flatMap((row, rowIndex) => row.score < 0
        ? playableColumns(definition, row).slice(-1).map(column => ({
          rowIndex, column: definition.columns.findIndex(item => item.id === column.id), gem: requiredGemAt(definition, { rowId: row.id, columnId: column.id }),
        })) : []);
      assert.equal(positivePrefixes.length, 15);
      assert.equal(positiveGoals.length, 5);
      assert.equal(negativeGoal.length, 1);
      const chunks = [
        { player: 0, cells: positivePrefixes.slice(0, 4), end: true },
        { player: 1, cells: positivePrefixes.slice(4, 9), end: false },
        { player: 0, cells: positivePrefixes.slice(9, 10), end: true },
        { player: 1, cells: positivePrefixes.slice(10, 15), end: false },
        { player: 0, cells: positiveGoals, end: false },
        ...(round === 1 ? [{ player: 1, cells: negativeGoal, end: false }] : []),
      ];
      let lastPlacement: { rollId: string; dieId: string; row: number; column: number; revision: number } | null = null;
      for (const [turnIndex, turn] of chunks.entries()) {
        const peer = dice[turn.player]!;
        const stateBefore = latest(peer);
        assert.ok(stateBefore.type === 'state' || stateBefore.type === 'welcome');
        assert.equal(stateBefore.state.turnId, ids[turn.player], `round ${round} turn ${turnIndex + 1} follows fixed order`);
        room.commandDice(ids[turn.player]!, peer, {
          type: 'roll', requestId: `winner-r${round}-roll-${turnIndex}`, turnSequence: stateBefore.state.turnSequence,
        });
        const rolling = [...peer.messages].reverse().find(item => item.type === 'state' && item.state.phase === 'rolling');
        assert.ok(rolling?.type === 'state' && rolling.roll);
        const results = rolling.roll.latest.dice.map((die, index) => ({
          id: die.id, gem: turn.cells[index]?.gem ?? 'ruby' as const, approximate: false,
        }));
        assert.ok(completeRoll);
        completeRoll({ ...rolling.roll.latest, phase: 'settled', seq: 1,
          dice: rolling.roll.latest.dice.map(die => ({ ...die, stopped: true })) }, results, 0, false);
        room.commandDice(ids[turn.player]!, peer, { type: 'confirm', rollId: rolling.roll.id });
        for (const target of turn.cells) {
          const placedState = latest(peer);
          assert.ok(placedState.type === 'state' || placedState.type === 'welcome');
          const die = results.find(item => item.gem === target.gem && placedState.state.remaining.includes(item.id));
          assert.ok(die, `round ${round} turn ${turnIndex + 1} has the matching die`);
          lastPlacement = { rollId: rolling.roll.id, dieId: die.id, row: target.rowIndex, column: target.column,
            revision: placedState.state.revision };
          room.commandDice(ids[turn.player]!, peer, { type: 'place', ...lastPlacement });
        }
        if (turn.end) {
          const afterTurn = latest(peer);
          assert.ok(afterTurn.type === 'state' || afterTurn.type === 'welcome');
          room.commandDice(ids[turn.player]!, peer, { type: 'end-turn', revision: afterTurn.state.revision,
            turnSequence: afterTurn.state.turnSequence });
        }
      }
      assert.ok(lastPlacement);
      return lastPlacement;
    };

    playTargets(17, 1);
    const afterFirstRound = latest(dice[0]!);
    assert.equal(afterFirstRound.type === 'state' || afterFirstRound.type === 'welcome' ? afterFirstRound.match?.roundNumber : 0, 2);
    const secondRoundLast = playTargets(18, 2);
    const finished = latest(dice[0]!);
    assert.ok(finished.type === 'state');
    assert.equal(finished.state.phase, 'finished');
    assert.equal(finished.state.turnId, null);
    assert.equal(finished.roll, null);
    assert.equal(finished.match?.roundNumber, 2);
    assert.deepEqual(finished.match?.result, { status: 'won', highestScore: 500, winners: [ids[0]] });
    assert.equal(finished.state.placements.length, 20, 'the empty penalty goal does not delay victory');
    assert.equal(finished.match?.completedRows.length, 5);
    const finalEvents = dice[0]!.messages.filter(item => item.type === 'state' && item.settlement?.gameEnded);
    assert.equal(finalEvents.length, 1, 'one final goal emits one terminal settlement event');
    assert.deepEqual(dice.map(peer => peer.messages.filter(item => item.type === 'state' && item.settlement?.gameEnded).length), [1, 1]);
    const eventMessage = finalEvents[0];
    assert.ok(eventMessage?.type === 'state' && eventMessage.settlement);
    if (eventMessage?.type === 'state' && eventMessage.settlement) {
      assert.equal(eventMessage.settlement.roundNumber, 2);
      assert.equal(eventMessage.settlement.playerId, ids[0], 'the player who reached 500 triggers victory');
      assert.equal(eventMessage.settlement.afterRanks.find(item => item.rank === 1)?.id, ids[0]);
      assert.deepEqual(settlementStages(eventMessage.settlement, createGoalBoard(eventMessage.settlement.boardSeed))
        .map(stage => stage.kind === 'effect' ? stage.request.kind : stage.kind),
      ['placement', 'score', 'bank', 'JACKPOT_VICTORY'], 'the actual terminal settlement plays score and bank before the winner effect');
    }
    const replacement = new DiceGuest();
    room.connectDice(replacement, { token: lobby[0]!.welcome.token });
    const resumed = replacement.messages.find(item => item.type === 'welcome');
    assert.ok(resumed?.type === 'welcome');
    if (resumed?.type === 'welcome') {
      assert.equal(resumed.state.phase, 'finished');
      assert.equal(resumed.state.turnId, null, 'reconnect cannot restore a finished turn');
      assert.equal(resumed.roll, null, 'the final reconnect has no stale tray');
      assert.deepEqual(resumed.match?.result, finished.match?.result);
    }
    const beforeFinishedCommands = dice.flatMap(peer => peer.messages).filter(item => item.type === 'state').length;
    room.commandDice(ids[0]!, replacement, { type: 'roll', requestId: 'finished-roll', turnSequence: finished.state.turnSequence });
    room.commandDice(ids[0]!, replacement, { type: 'place', ...secondRoundLast });
    room.commandDice(ids[0]!, replacement, { type: 'end-turn', revision: finished.state.revision,
      turnSequence: finished.state.turnSequence });
    assert.equal(dice.flatMap(peer => peer.messages).filter(item => item.type === 'state').length, beforeFinishedCommands,
      'a finished game rejects stale, duplicate, and new turn commands');

    const revision = finished.state.revision;
    room.commandDice(ids[0]!, replacement, { type: 'return-lobby', ready: true, revision: revision - 1 });
    assert.equal(replacement.messages.at(-1)?.type, 'error');
    assert.equal(room.started, true);

    room.commandDice(ids[0]!, replacement, { type: 'return-lobby', ready: true, revision });
    assert.ok(replacement.messages.some(message => message.type === 'lobby-returned' && message.revision === revision));
    const replay = new LobbyGuest();
    room.connectLobby(replay, lobby[0]!.welcome.token);
    assert.equal(replay.welcome.playerId, ids[0]);
    assert.equal(replay.state.seats.find(seat => seat.id === ids[0])?.ready, true);
    const otherFinished = latest(dice[1]!);
    assert.equal(otherFinished.state.phase, 'finished');
    assert.deepEqual(otherFinished.match?.result, finished.match?.result, 'returning does not clear the other player’s result');

    const visitor = new LobbyGuest();
    room.connectLobby(visitor);
    room.commandLobby(visitor.welcome.playerId, visitor, { type: 'ready', ready: true });
    assert.equal(replay.state.phase, 'waiting', 'a connected player still viewing results keeps the next countdown from starting');
    room.exitLobby(visitor.welcome.playerId, visitor);

    const otherDice = new DiceGuest();
    room.connectDice(otherDice, { token: lobby[1]!.welcome.token });
    assert.deepEqual(latest(otherDice).match?.result, finished.match?.result, 'a player can reconnect to their result after the lobby reopens');
    room.commandDice(ids[1]!, otherDice, { type: 'return-lobby', ready: false, revision });
    assert.ok(otherDice.messages.some(message => message.type === 'lobby-returned'));
    const returning = new LobbyGuest();
    room.connectLobby(returning, lobby[1]!.welcome.token);
    assert.equal(returning.state.seats.find(seat => seat.id === ids[1])?.ready, false);
    assert.equal(returning.state.phase, 'waiting');
    room.commandLobby(ids[1]!, returning, { type: 'ready', ready: true });
    assert.equal(returning.state.phase, 'countdown');
    await delay(20);
    assert.equal(replay.state.phase, 'started');

    const rematch = new DiceGuest();
    room.connectDice(rematch, { token: lobby[0]!.welcome.token });
    const reset = latest(rematch);
    assert.equal(reset.state.phase, 'ready');
    assert.equal(reset.state.turnId, ids[0]);
    assert.ok(reset.state.revision > revision);
    assert.ok(reset.state.turnSequence > finished.state.turnSequence);
    assert.notEqual(reset.state.boardSeed, finished.state.boardSeed);
    assert.deepEqual(reset.state.placements, []);
    assert.equal(reset.match?.result, null);
    assert.equal(reset.match?.roundNumber, 1);
    assert.deepEqual(reset.match?.players.map(player => [player.score, player.diceCount]), [[80, 15], [80, 15]]);
  } finally { registry.dispose(); }
});
