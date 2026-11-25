import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSelect, cellKey, initialState } from '../../features/board/model/board-model';
import { EffectPlayer } from '../../features/effects/application/effect-player';
import { beatsFor, CONVERGING_LIGHT_STAGGER_MS, CONVERGING_LIGHT_TRAVEL_MS, readEffect, scoreLabel, settlementEffects, turnLabel } from '../../features/effects/model/effect-model';
import { GEM_IDS } from '../../features/board/model/gem-ids';
import type { Cue, EffectKind } from '../../features/effects/model/effect-model';
import {
  COMEBACK_BOARD, COMEBACK_GEM, COMEBACK_SCORE, CURRENT_PLAYER, LAST_CELL,
  TURN_PLAYERS,
} from '../preview-data/effect-turn';
import { EFFECT_PREVIEW_SCENARIO } from '../preview-data/effect-turn';
import { SAMPLE_BOARD } from '../preview-data/sample-board';

function playbackFixture() {
  let now = 0;
  let sequence = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const sounded: [EffectKind, Cue][] = [];
  const player = new EffectPlayer({
    cut() {},
    playCue(kind, cue) { sounded.push([kind, cue]); },
  }, EFFECT_PREVIEW_SCENARIO, {
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

test('アメジストのデモには配置可能な空きの＋100点マスが1つあり、得点で単独首位になる', () => {
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

test('ダイス停止を一度だけ通知し、配置後に逆転演出の音を再生する', () => {
  const { player, advance, sounded } = playbackFixture();
  const request = readEffect('ONE_CELL_COMEBACK', { gem: COMEBACK_GEM });
  const beats = beatsFor(request, false, EFFECT_PREVIEW_SCENARIO);
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

test('アメジストが出ないと配置も逆転演出も始まらず、古い投擲が最新の投擲に干渉しない', () => {
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
  player.play(readEffect('TURN_CHANGE', { playerName: 'PLAYER 2', isLocal: false }), false);
  player.settleRoll(previous.id);
  assert.equal(player.getSnapshot()?.phase, 'start');
  player.skip();
  advance(12_000);
  assert.ok(player.getSnapshot()?.skipped);
  assert.equal(player.getSnapshot()?.phase, 'finish');
  player.reset();
  assert.equal(player.getSnapshot(), null);
});

test('手番案内は見る人に応じた文言を使い、開始音を一度だけ鳴らす', () => {
  assert.equal(turnLabel({ playerName: 'PLAYER 1', isLocal: true }), 'あなたの手番');
  assert.equal(turnLabel({ playerName: 'PLAYER 2', isLocal: false }), 'PLAYER 2の手番');
  const { player, advance, sounded } = playbackFixture();
  player.play(readEffect('TURN_CHANGE', { playerName: 'PLAYER 1', isLocal: true }), false);
  advance(2199);
  assert.equal(player.getSnapshot()?.playing, true);
  advance(2200);
  assert.equal(player.getSnapshot()?.playing, false);
  assert.deepEqual(sounded.filter(([, cue]) => cue === 'start'), [['TURN_CHANGE', 'start']]);
});

test('共通の得点演出は得点・残高を上限とする支払い・支払いなしを表示する', () => {
  const scenario = EFFECT_PREVIEW_SCENARIO;
  const penalty = { rowId: 'penalty', columnId: 'ruby' };
  const board = { ...SAMPLE_BOARD, rows: SAMPLE_BOARD.rows.map(row => row.id === penalty.rowId ? { ...row, score: -50 } : row) };
  const context = { board, featuredCell: scenario.featuredCell };
  const gain = readEffect('BOARD_SCORE', scenario.demo.BOARD_SCORE, context);
  assert.equal(gain.kind, 'BOARD_SCORE');
  assert.equal(scoreLabel(100), '+100点');
  for (const points of [-10, 0]) {
    const { player, advance, sounded } = playbackFixture();
    const request = readEffect('BOARD_SCORE', { playerName: CURRENT_PLAYER.name, target: penalty, points }, context);
    assert.equal(scoreLabel(points), points ? '−10点' : '支払いなし');
    player.play(request, false);
    advance(5000);
    assert.deepEqual(sounded, [['BOARD_SCORE', 'start'], ['BOARD_SCORE', 'finish']]);
    assert.equal(player.getSnapshot()?.playing, false);
  }
  const score = { playerName: CURRENT_PLAYER.name, target: penalty, points: -60 };
  assert.throws(() => readEffect('BOARD_SCORE', score, context), RangeError);
  assert.throws(() => readEffect('BOARD_SCORE', { ...score, target: scenario.featuredCell }, context), RangeError);
});

test('得失点と順位の境界条件を判定し、大当たり演出を順位変動演出より先に並べる', () => {
  const { BOARD_SCORE: score, COMEBACK: moved } = EFFECT_PREVIEW_SCENARIO.demo;
  const down = { ...moved, fromRank: 1, toRank: 2 };
  const unchanged = { ...moved, toRank: moved.fromRank };
  assert.deepEqual(settlementEffects({ score: { ...score, points: 99 }, rankChange: moved }).map(([kind]) => kind),
    ['BOARD_SCORE', 'COMEBACK']);
  assert.deepEqual(settlementEffects({ score, rankChange: moved }).map(([kind]) => kind),
    ['BOARD_SCORE', 'BIG_WIN', 'COMEBACK']);
  assert.deepEqual(settlementEffects({ score: { ...score, points: 125 }, rankChange: unchanged }).map(([kind]) => kind),
    ['BOARD_SCORE', 'BIG_WIN']);
  assert.deepEqual(settlementEffects({ score: { ...score, points: -10 }, rankChange: down }).map(([kind]) => kind),
    ['BOARD_SCORE', 'COMEBACK']);
  assert.deepEqual(settlementEffects({ score, rankChange: moved, gameEnded: true }).map(([kind]) => kind), ['BOARD_SCORE']);
  assert.doesNotThrow(() => readEffect('COMEBACK', down));
  assert.throws(() => readEffect('BIG_WIN', { ...score, points: 99 }), RangeError);
});

test('大当たり演出の終了またはスキップ後に逆転演出を流し、一連の再生をやり直せる', () => {
  const { player, advance, sounded } = playbackFixture();
  const { BOARD_SCORE: score, COMEBACK: rankChange } = EFFECT_PREVIEW_SCENARIO.demo;
  const effects = settlementEffects({ score, rankChange }).map(([kind, params]) => readEffect(kind, params));
  const scoreTime = beatsFor(effects[0]!, false, EFFECT_PREVIEW_SCENARIO).at(-1)!.at;
  const bigWin = effects[1];
  assert.ok(bigWin?.kind === 'BIG_WIN');
  const bigWinBeats = beatsFor(bigWin, false, EFFECT_PREVIEW_SCENARIO);
  const gather = bigWinBeats.find(beat => beat.cue === 'gather');
  const silence = bigWinBeats.find(beat => beat.cue === 'silence');
  const finish = bigWinBeats.at(-1);
  assert.ok(gather && silence && finish);
  assert.ok(silence.at > gather.at + CONVERGING_LIGHT_TRAVEL_MS + (GEM_IDS.length - 1) * CONVERGING_LIGHT_STAGGER_MS);
  player.playAll(effects, false);
  assert.equal(player.getSnapshot()?.request.kind, 'BOARD_SCORE');
  advance(scoreTime);
  assert.equal(player.getSnapshot()?.request.kind, 'BIG_WIN');
  advance(scoreTime + finish.at - 1);
  assert.equal(player.getSnapshot()?.request.kind, 'BIG_WIN');
  advance(scoreTime + finish.at);
  assert.equal(player.getSnapshot()?.request.kind, 'COMEBACK');
  assert.ok(sounded.findIndex(([kind, cue]) => kind === 'BIG_WIN' && cue === 'finish')
    < sounded.findIndex(([kind, cue]) => kind === 'COMEBACK' && cue === 'start'));

  player.replay(false);
  assert.equal(player.getSnapshot()?.request.kind, 'BOARD_SCORE');
  player.skip();
  assert.equal(player.getSnapshot()?.request.kind, 'BIG_WIN');
  player.skip();
  assert.equal(player.getSnapshot()?.request.kind, 'COMEBACK');
  player.reset();
  advance(20_000);
  assert.equal(player.getSnapshot(), null);
});
