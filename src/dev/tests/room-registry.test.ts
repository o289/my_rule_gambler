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
import { nextOpenCell, requiredGemAt } from '../../features/board/model/board-model';

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
    room.commandDice(firstId, dice[0]!, { type: 'roll', requestId: 'first-roll' });
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
    if (placed?.type === 'state') {
      assert.equal(placed.match?.players[0]?.score, 70, 'the negative goal charges only ten points once');
      assert.deepEqual(placed.match?.players[0]?.wallet, [{ denomination: 50, count: 1 }, { denomination: 10, count: 2 }]);
      assert.deepEqual(placed.match?.completedRows, [scoredRow.id]);
      room.commandDice(firstId, dice[0]!, place);
      const afterDuplicate = [...dice[0]!.messages].reverse().find(message => message.type === 'state');
      assert.ok(afterDuplicate?.type === 'state');
      assert.equal(afterDuplicate.match?.players[0]?.score, 70, 'a stale duplicate placement cannot settle twice');
    }
    const replacement = new DiceGuest();
    room.connectDice(replacement, { token: lobby[0]!.welcome.token });
    const resumed = replacement.messages.find(message => message.type === 'welcome');
    assert.ok(resumed?.type === 'welcome');
    if (resumed?.type === 'welcome' && placed?.type === 'state') {
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
