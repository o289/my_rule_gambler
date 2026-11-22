import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BankPlayer } from '../../features/bank/application/bank-player';
import { bankBalance, collectionPlan, readBankTransaction, selectPayment } from '../../features/bank/model/bank-model';
import { DEMO_PLAYER, DEMO_RESERVE, DEMO_WALLET } from '../preview-data/bank-demo';
import type { BankDirection, Coin } from '../../features/bank/model/bank-model';

function transaction(type: BankDirection, amount: number) {
  return { type, playerId: DEMO_PLAYER.id, amount };
}

function fixture() {
  let time = 0;
  let sequence = 0;
  const timers = new Map<number, { callback: () => void; at: number }>();
  const clock = {
    now: () => time,
    schedule(callback: () => void, milliseconds: number) {
      const timer = ++sequence;
      timers.set(timer, { callback, at: time + milliseconds });
      return timer;
    },
    cancel: (timer: number) => timers.delete(timer),
  };
  const audio = { cue() {}, cut() {} };
  const bank = new BankPlayer(DEMO_PLAYER.id, DEMO_WALLET, audio, DEMO_RESERVE, clock);
  function advance(until: number) {
    for (const [id, timer] of [...timers].sort((left, right) => left[1].at - right[1].at)) {
      if (timer.at > until || !timers.delete(id)) continue;
      time = timer.at;
      timer.callback();
    }
    time = until;
  }
  return { bank, advance, timers };
}

test('both inventories provide exact minimum-coin combinations for demo amounts', () => {
  for (const wallet of [DEMO_WALLET, DEMO_RESERVE]) {
    for (const [amount, values] of [[100, [100]], [150, [100, 50]], [70, [50, 10, 10]]] as const) {
      const first = selectPayment(wallet, amount);
      assert.deepEqual(first.map(coin => coin.value), values);
      assert.deepEqual(first, selectPayment(wallet, amount));
    }

    const limit = bankBalance(wallet);
    for (let amount = 10; amount <= limit; amount += 10) {
      const payment = selectPayment(wallet, amount);
      assert.equal(bankBalance(payment), amount);
      assert.equal(new Set(payment.map(coin => coin.id)).size, payment.length);
    }
    assert.throws(() => selectPayment(wallet, limit + 10), /残高/);
  }

  const onlyFifties: readonly Coin[] = [{ id: 'a', value: 50 }, { id: 'b', value: 50 }];
  assert.throws(() => selectPayment(onlyFifties, 70), /指定額を用意できません/);
  assert.deepEqual(selectPayment(onlyFifties, 50).map(coin => coin.id), ['a']);
});

test('the API validates amounts and updates the ledger only when each coin lands', () => {
  const { bank, advance } = fixture();
  for (const bad of [0, -10, 15, 12.5, Infinity, NaN, '100']) {
    assert.throws(() => readBankTransaction({ ...transaction('withdraw', 0), amount: bad }, DEMO_PLAYER.id), /10点単位/);
  }
  assert.throws(() => bank.play(transaction('deposit', 310), false), /300点/);
  assert.equal(bank.getSnapshot().run, null);

  for (const [type, delta] of [['withdraw', -1], ['deposit', 1]] as const) {
    const item = fixture();
    assert.equal(item.bank.play(transaction(type, 150), false), true);
    assert.equal(item.bank.play(transaction(type, 10), false), false);
    const run = item.bank.getSnapshot().run;
    assert.ok(run);
    const beats = collectionPlan(run.payment, false);
    const arrivals = beats.filter(beat => beat.cue === 'absorb');
    const first = arrivals[0];
    const second = arrivals[1];
    assert.ok(first?.coin && second?.coin);
    item.advance(first.at - 1);
    assert.equal(item.bank.getSnapshot().balance, 200);
    if (type === 'deposit') assert.ok(!item.bank.getSnapshot().wallet.includes(first.coin));
    item.advance(first.at);
    assert.equal(item.bank.getSnapshot().balance, 200 + delta * 100);
    item.advance(second.at);
    const completed = item.bank.getSnapshot();
    assert.equal(completed.balance, 200 + delta * 150);
    assert.equal(bankBalance(completed.wallet) + bankBalance(completed.reserve), 500);
  }

  assert.equal(bank.play(transaction('deposit', 300), false), true);
  advance(10000);
  assert.equal(bank.getSnapshot().balance, 500);
});

test('skipping after an arrival, replaying, and switching direction keep coin IDs and balances consistent', () => {
  const { bank, advance, timers } = fixture();
  assert.ok(bank.play(transaction('deposit', 150), true));
  advance(905);
  assert.equal(bank.getSnapshot().balance, 300);
  bank.skip();
  bank.skip();
  assert.equal(bank.getSnapshot().balance, 350);
  assert.equal(timers.size, 0);
  assert.equal(new Set(bank.getSnapshot().wallet.map(coin => coin.id)).size, bank.getSnapshot().wallet.length);
  assert.ok(bank.replay(true));
  assert.equal(bank.getSnapshot().run?.transaction.amount, 150);
  assert.equal(bank.getSnapshot().balance, 200);
  bank.setMode('withdraw');
  assert.equal(bank.getSnapshot().mode, 'withdraw');
  assert.equal(bank.getSnapshot().run, null);
  assert.equal(timers.size, 0);
  assert.ok(bank.play(transaction('withdraw', 200), true));
  bank.skip();
  assert.equal(bank.getSnapshot().balance, 0);
  assert.deepEqual(bank.getSnapshot().wallet, []);
  bank.reset();
  assert.equal(bank.getSnapshot().balance, 200);
});
