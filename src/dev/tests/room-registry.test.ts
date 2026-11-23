import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { RoomRegistry } from '../../platform/server/core/room-registry';
import type { RoomRuntime } from '../../platform/server/core/ports';
import type { LobbyPeer, DicePeer } from '../../platform/server/core/room';
import type { ServerMessage as LobbyMessage } from '../../shared/contracts/casino-entry';
import { parseJson, readServerMessage } from '../../shared/contracts/dice';
import type { ServerMessage as DiceMessage } from '../../shared/contracts/dice';
import type { Frame, DiceResult } from '../../shared/contracts/dice';
import { createGoalBoard } from '../../features/board/model/goal-layout';
import { cellKey, nextOpenCell, playableColumns, requiredGemAt } from '../../features/board/model/board-model';

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

test('a complete board publishes its result without advancing the turn and rejects the next roll', async () => {
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
    assert.equal(finalState.placements.length, 21);
    assert.equal(finalState.phase, 'placement');
    assert.equal(finalState.remaining.length, 0);
    assert.equal(finalState.turnSequence, 5, 'the last placement does not begin another turn');
    const finalMatch = [...dice[0]!.messages].reverse().find(item => item.type === 'state' && item.match?.result !== null);
    assert.ok(finalMatch?.type === 'state' && finalMatch.match);
    assert.equal(finalMatch.match.completedRows.length, 6);
    assert.equal(finalMatch.match.result?.status, 'continue');
    const stateMessagesBefore = dice.flatMap(peer => peer.messages).filter(item => item.type === 'state').length;
    const finalPlayerIndex = ids.indexOf(finalState.turnId);
    assert.notEqual(finalPlayerIndex, -1);
    const finalPeer = dice[finalPlayerIndex]!;
    room.commandDice(finalState.turnId, finalPeer, {
      type: 'end-turn', revision: finalState.revision, turnSequence: finalState.turnSequence,
    });
    room.commandDice(finalState.turnId, finalPeer, {
      type: 'roll', requestId: 'after-completed-board', turnSequence: finalState.turnSequence,
    });
    assert.equal(dice.flatMap(peer => peer.messages).filter(item => item.type === 'state').length, stateMessagesBefore);
  } finally { registry.dispose(); }
});
