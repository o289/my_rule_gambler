import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSelect, cellKey, initialState } from '../../features/board/model/board-model';
import { EffectPlayer } from '../../features/effects/application/effect-player';
import { beatsFor, readEffect } from '../../features/effects/model/effect-model';
import type { Cue, EffectKind } from '../../features/effects/model/effect-model';
import {
  COMEBACK_BOARD, COMEBACK_GEM, COMEBACK_SCORE, CURRENT_PLAYER, LAST_CELL,
  rerollTargets, REROLL_RESULTS, TURN_PLAYERS,
} from '../../features/effects/model/effect-turn';
import { SAMPLE_BOARD } from '../preview-data/sample-board';

function playbackFixture() {
  let now = 0;
  let sequence = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const sounded: [EffectKind, Cue][] = [];
  const player = new EffectPlayer({
    cut() {},
    playCue(kind, cue) { sounded.push([kind, cue]); },
  }, {
    now: () => now,
    schedule(callback, delay) {
      const id = ++sequence;
      pending.set(id, { at: now + delay, callback });
      return id;
    },
    cancel(id) { pending.delete(id); },
  });
  function advance(until: number) {
    while (pending.size) {
      const earliest = [...pending].sort((first, second) => first[1].at - second[1].at)[0];
      if (!earliest || earliest[1].at > until) break;
      const [id, { at, callback }] = earliest;
      pending.delete(id);
      now = at;
      callback();
    }
    now = until;
  }
  return { player, advance, sounded };
}

test('the amethyst demo has one eligible empty +100 cell and the award makes a unique leader', () => {
  const royal = COMEBACK_BOARD.rows.find(row => row.id === LAST_CELL.rowId);
  assert.equal(royal?.score, COMEBACK_SCORE);
  assert.equal(COMEBACK_SCORE, 100);
  const board = initialState(COMEBACK_BOARD);
  const cells = COMEBACK_BOARD.columns
    .map(column => ({ rowId: LAST_CELL.rowId, columnId: column.id }))
    .filter(cell => canSelect(COMEBACK_BOARD, cell) && !board.occupied.has(cellKey(cell)));
  assert.deepEqual(cells, [LAST_CELL]);
  assert.ok(canSelect(SAMPLE_BOARD, { rowId: LAST_CELL.rowId, columnId: 'topaz' }));
  for (const opponent of TURN_PLAYERS.slice(1)) {
    assert.ok(CURRENT_PLAYER.score < opponent.score);
    assert.ok(CURRENT_PLAYER.score + COMEBACK_SCORE > opponent.score);
  }
});

test('the observed roll stop fires once and placement precedes reuse of the COMEBACK cues', () => {
  const { player, advance, sounded } = playbackFixture();
  const request = readEffect('ONE_CELL_COMEBACK', { gem: COMEBACK_GEM });
  const beats = beatsFor(request, false);
  const stop = beats.find(beat => beat.cue === 'roll-stop');
  const placement = beats.find(beat => beat.cue === 'place');
  const comeback = beats.find(beat => beat.cue === 'comeback');
  assert.ok(stop && placement && comeback);

  player.play(request, false);
  const first = player.getSnapshot();
  assert.ok(first);
  player.settleRoll(first.id);
  assert.equal(player.getSnapshot()?.phase, 'start');
  advance(stop.at + 15);
  assert.equal(player.getSnapshot()?.phase, 'roll');
  player.settleRoll(first.id);
  player.settleRoll(first.id);
  assert.equal(player.getSnapshot()?.phase, 'roll-stop');
  assert.equal(sounded.filter(([, cue]) => cue === 'roll-stop').length, 1);
  assert.ok(!player.getSnapshot()?.cues.has('place'));
  advance(placement.at + 15);
  assert.equal(player.getSnapshot()?.phase, 'place');
  assert.ok(!player.getSnapshot()?.cues.has('comeback'));
  advance(comeback.at + 15);
  assert.equal(player.getSnapshot()?.phase, 'comeback');
  advance(10_000);
  assert.ok(sounded.some(([kind, cue]) => kind === 'COMEBACK' && cue === 'impact'));
  assert.equal(player.getSnapshot()?.phase, 'finish');
});

test('reroll targets the leftmost playable empty cells and passes only when none match', () => {
  assert.deepEqual(rerollTargets(REROLL_RESULTS.available), [
    { rowId: 'twenty', columnId: 'ruby' }, { rowId: 'ten', columnId: 'ruby' }, { rowId: 'penalty', columnId: 'ruby' },
  ]);
  assert.deepEqual(rerollTargets(REROLL_RESULTS.blocked), []);
  for (const gem of Object.values(REROLL_RESULTS)) {
    const { player, advance, sounded } = playbackFixture();
    player.play(readEffect('REROLL_THROW', { gem }), true);
    assert.deepEqual(sounded[0], ['REROLL_THROW', 'start']);
    advance(4_000);
    assert.equal(player.getSnapshot()?.phase, 'finish');
    assert.ok(player.getSnapshot()?.cues.has('roll-stop'));
    assert.equal(player.getSnapshot()?.cues.has('handoff'), gem === REROLL_RESULTS.blocked);
  }
});

test('a missed amethyst never places or activates COMEBACK, and a stale roll cannot affect a replacement', () => {
  const { player, advance, sounded } = playbackFixture();
  const miss = readEffect('ONE_CELL_COMEBACK', { gem: 'sapphire' });
  player.play(miss, true);
  advance(2_900);
  assert.equal(player.getSnapshot()?.phase, 'finish');
  assert.ok(!player.getSnapshot()?.cues.has('place'));
  assert.ok(!sounded.some(([kind]) => kind === 'COMEBACK'));
  player.replay(false);
  const previous = player.getSnapshot();
  assert.ok(previous);
  advance(4_500);
  player.play(readEffect('REROLL_THROW', { gem: REROLL_RESULTS.available }), false);
  player.settleRoll(previous.id);
  assert.equal(player.getSnapshot()?.phase, 'start');
  player.skip();
  advance(12_000);
  assert.ok(player.getSnapshot()?.skipped);
  assert.equal(player.getSnapshot()?.phase, 'finish');
  player.reset();
  assert.equal(player.getSnapshot(), null);
});
