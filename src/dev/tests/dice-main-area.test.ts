import assert from 'node:assert/strict';
import test from 'node:test';
import { canShowPreviewEndTurn, canSwitchDiceMainPanel, panelForTurnChange } from '../../features/dice/model/main-area';

test('手番切替後は本人に操作画面、他の人にボードを表示する', () => {
  assert.equal(panelForTurnChange(true), 'operations');
  assert.equal(panelForTurnChange(false), 'board');
});

test('自分の手番で投擲・合法配置・振り直しが可能なときだけ画面切替を出す', () => {
  const base = {
    canAct: true,
    hasLegalPlacement: false,
    remainingDice: 0,
    placedThisRoll: false,
    devReroll: false,
  };
  assert.equal(canSwitchDiceMainPanel({ ...base, phase: 'ready' }), true);
  assert.equal(canSwitchDiceMainPanel({ ...base, phase: 'placement', hasLegalPlacement: true }), true);
  assert.equal(canSwitchDiceMainPanel({ ...base, phase: 'placement', remainingDice: 2, placedThisRoll: true }), true);
  assert.equal(canSwitchDiceMainPanel({ ...base, phase: 'placement', remainingDice: 2, devReroll: true }), true);
  assert.equal(canSwitchDiceMainPanel({ ...base, phase: 'placement' }), false);
  assert.equal(canSwitchDiceMainPanel({ ...base, canAct: false, phase: 'ready' }), false);
  assert.equal(canSwitchDiceMainPanel({ ...base, canAct: false, phase: 'placement', hasLegalPlacement: true }), false);
});

test('プレビューで標準自動終了がない場合は切替を増やさずEND TURNを残す', () => {
  const base = { preview: true, canAct: true, phase: 'placement' as const, panelCanSwitch: false };
  assert.equal(canShowPreviewEndTurn({ ...base, hasLegalPlacement: false, placedThisRoll: false }), true);
  assert.equal(canShowPreviewEndTurn({ ...base, hasLegalPlacement: true, placedThisRoll: true }), true);
  assert.equal(canShowPreviewEndTurn({ ...base, hasLegalPlacement: true, placedThisRoll: false }), false);
  assert.equal(canShowPreviewEndTurn({ ...base, preview: false, hasLegalPlacement: false, placedThisRoll: false }), false);
  assert.equal(canShowPreviewEndTurn({ ...base, canAct: false, hasLegalPlacement: false, placedThisRoll: false }), false);
});
