import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { FinalResults } from '../../features/dice/ui/final-results';

function resultButtons(onReturn: (ready: boolean) => void, connected = true, pending = false) {
  const view = FinalResults({
    players: [
      { id: 'p1', name: 'Player One', rank: 1, score: 510, slot: 0 },
      { id: 'p2', name: 'Player Two', rank: 2, score: 430, slot: 1 },
    ],
    winners: ['p1'], connected, pending, onReturn,
  });
  const section = Children.toArray(view.props.children);
  const actions = section.find(item => isValidElement<{ className?: string; children?: ReactNode }>(item)
    && item.props.className === 'final-results-actions');
  if (!isValidElement<{ children?: ReactNode }>(actions)) throw new Error('Expected result actions');
  return Children.toArray(actions.props.children).filter(isValidElement) as ReactElement<{
    disabled: boolean;
    onClick: () => void;
    children: ReactNode;
  }>[];
}

test('final result buttons request replay-ready or waiting-room states independently', () => {
  const requested: boolean[] = [];
  const buttons = resultButtons(ready => requested.push(ready));
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0]?.props.children, 'もう一度プレイする');
  assert.equal(buttons[1]?.props.children, '部屋に戻る');
  assert.equal(buttons[0]?.props.disabled, false);
  assert.equal(buttons[1]?.props.disabled, false);
  buttons[0]?.props.onClick();
  buttons[1]?.props.onClick();
  assert.deepEqual(requested, [true, false]);
});

test('final result actions remain disabled until the result connection is live', () => {
  for (const state of [{ connected: false, pending: false }, { connected: true, pending: true }]) {
    const buttons = resultButtons(() => {}, state.connected, state.pending);
    assert.equal(buttons[0]?.props.disabled, true);
    assert.equal(buttons[1]?.props.disabled, true);
  }
});
