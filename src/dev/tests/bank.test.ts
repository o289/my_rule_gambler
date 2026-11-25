import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BankPlayer } from '../../features/bank/application/bank-player';
import { bankBalance, collectionPlan, compressionTiming, readBankTransaction, selectExchange, selectPayment } from '../../features/bank/model/bank-model';
import { DEMO_PLAYER, DEMO_RESERVE, DEMO_WALLET } from '../preview-data/bank-demo';
import type { BankDirection, Coin } from '../../features/bank/model/bank-model';

function transaction(type: BankDirection, amount: number) {
  return { type, playerId: DEMO_PLAYER.id, amount };
}

function fixture(wallet = DEMO_WALLET, reserve = DEMO_RESERVE) {
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
  const bank = new BankPlayer(DEMO_PLAYER.id, wallet, audio, reserve, clock);
  function advance(until: number) {
    while (timers.size) {
      const first = [...timers].sort((left, right) => left[1].at - right[1].at)[0];
      if (!first || first[1].at > until) break;
      const [id, timer] = first;
      timers.delete(id);
      time = timer.at;
      timer.callback();
    }
    time = until;
  }
  return { bank, advance, timers };
}

test('プレイヤーと金庫の在庫から、デモ金額ちょうどの支払いを最少枚数で組み立てる', () => {
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

test('取引金額を検証し、コインが到着するたびに帳簿を更新する', () => {
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

test('到着後のスキップ・再生・入出金切り替えでもコインIDと残高を保つ', () => {
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


const withChange = { ...transaction('withdraw', 70), tender: 100 } as const;

test('100点の支払いでは金庫にあるコインだけをお釣りとして確保する', () => {
  const { payment, change } = selectExchange(DEMO_WALLET, DEMO_RESERVE, withChange);
  assert.deepEqual(payment.map(coin => coin.value), [100]);
  assert.deepEqual(change.map(coin => coin.value), [10, 10, 10]);
  assert.ok(change.every(coin => DEMO_RESERVE.includes(coin)));
  const exact = selectExchange(DEMO_WALLET, DEMO_RESERVE, transaction('withdraw', 70));
  assert.deepEqual(exact.payment.map(coin => coin.value), [50, 10, 10]);
  assert.deepEqual(exact.change, []);
  const withoutTender = fixture(DEMO_WALLET.filter(coin => coin.value !== 100)).bank;
  assert.throws(() => withoutTender.play(withChange, false), /100点金貨を所持していません/);
  assert.equal(withoutTender.getSnapshot().run, null);
  const shortBank = fixture(DEMO_WALLET, DEMO_RESERVE.filter(coin => coin.value !== 10)).bank;
  assert.throws(() => shortBank.play(withChange, false), /30点のお釣りを用意できません/);
  assert.equal(shortBank.getSnapshot().balance, 200);
  assert.equal(shortBank.getSnapshot().run, null);
  assert.throws(() => shortBank.play({ ...withChange, type: 'deposit' }, false), /支払いに使う金貨/);
});

test('支払いのコイン到着後にお釣りが動き出し、到着ごとに10点を返す', () => {
  const { bank, advance } = fixture();
  assert.ok(bank.play(withChange, false));
  const run = bank.getSnapshot().run;
  assert.ok(run);
  const plan = collectionPlan(run.payment, false, run.transaction.type, run.change);
  const [payment, ...refunds] = plan.filter(beat => beat.cue === 'absorb');
  assert.ok(payment?.coin);
  const change = plan.find(beat => beat.cue === 'change');
  const firstReturn = plan.find(beat => beat.cue === 'launch' && beat.direction === 'deposit');
  assert.ok(change && firstReturn?.coin);
  assert.ok(change.at > payment.at && firstReturn.at > change.at);
  advance(payment.at - 1);
  assert.equal(bank.getSnapshot().balance, 200);
  advance(payment.at);
  assert.equal(bank.getSnapshot().balance, 100);
  assert.ok(bank.getSnapshot().reserve.includes(payment.coin));
  advance(firstReturn.at);
  assert.equal(bank.getSnapshot().run?.flights.get(firstReturn.coin.id)?.direction, 'deposit');
  assert.ok(!bank.getSnapshot().wallet.includes(firstReturn.coin));
  for (const [index, refund] of refunds.entries()) {
    advance(refund.at);
    assert.equal(bank.getSnapshot().balance, 110 + index * 10);
    assert.ok(refund.coin && bank.getSnapshot().wallet.includes(refund.coin));
    assert.equal(bank.getSnapshot().compression, null);
  }
  advance(20_000);
  const { wallet, reserve, balance, compression } = bank.getSnapshot();
  assert.equal(balance, 130);
  assert.equal(bankBalance(wallet) + bankBalance(reserve), 500);
  assert.deepEqual(wallet.map(coin => coin.value), [10, 10, 10, 100]);
  assert.deepEqual(reserve.filter(coin => coin.value === 10).map(coin => coin.id), ['bank-ten-d', 'bank-ten-e']);
  assert.equal(compression?.cue, 'finish');
  assert.ok(bank.replay(false));
  assert.equal(bank.getSnapshot().run?.transaction.tender, 100);
  assert.equal(bank.getSnapshot().balance, 200);
});

test('両方の額面でコインをまとめ直して再生しても得点・予備・端数が保たれる', () => {
  const extra: Coin = { id: 'tenth-remainder', value: 10 };
  const reserve = [...DEMO_RESERVE, { id: 'compressed-1', value: 100 } as const];
  const { bank, advance } = fixture([...DEMO_WALLET, extra], reserve);
  const { gather, mint } = compressionTiming(false);
  assert.ok(bank.compress(false));
  assert.equal(bank.compress(false), false);
  assert.equal(bank.play(withChange, false), false);
  assert.equal(bank.getSnapshot().balance, 210);
  assert.equal(bank.getSnapshot().compression?.steps[0]?.inputs.length, 5);
  advance(gather);
  const afterFirst = bank.getSnapshot();
  assert.equal(afterFirst.compression?.cue, 'mint');
  assert.deepEqual(afterFirst.wallet.map(coin => coin.value), [100, 50, 10, 50]);
  advance(gather + mint);
  assert.equal(bank.getSnapshot().compression?.steps[1]?.inputs.length, 2);
  advance(gather * 2 + mint);
  const afterSecond = bank.getSnapshot();
  assert.deepEqual(afterSecond.wallet.map(coin => coin.value), [100, 10, 100]);
  assert.ok(afterSecond.wallet.includes(extra));
  assert.deepEqual(afterSecond.reserve, reserve);
  assert.equal(bankBalance(afterSecond.wallet), 210);
  assert.equal(new Set([...afterSecond.wallet, ...afterSecond.reserve].map(coin => coin.id)).size, afterSecond.wallet.length + afterSecond.reserve.length);
  bank.skip();
  assert.equal(bank.getSnapshot().compression?.cue, 'finish');
  assert.ok(bank.replay(true));
  assert.equal(bank.getSnapshot().wallet.length, DEMO_WALLET.length + 1);
  bank.skip();
  assert.equal(bank.getSnapshot().balance, 210);
  assert.ok(bank.getSnapshot().wallet.includes(extra));
});

test('スキップや入出金切り替えでお釣りを二重に返したりまとめたりしない', () => {
  const { bank, advance, timers } = fixture();
  assert.ok(bank.play(withChange, true));
  const run = bank.getSnapshot().run;
  assert.ok(run);
  const plan = collectionPlan(run.payment, true, run.transaction.type, run.change);
  const firstReturn = plan.find(beat => beat.cue === 'absorb' && beat.direction === 'deposit');
  assert.ok(firstReturn);
  advance(firstReturn.at);
  assert.equal(bank.getSnapshot().balance, 110);
  bank.skip();
  bank.skip();
  assert.equal(timers.size, 0);
  const complete = bank.getSnapshot();
  assert.equal(complete.balance, 130);
  assert.equal(bankBalance(complete.wallet), 130);
  assert.equal(bankBalance(complete.reserve), 370);
  assert.equal(complete.compression?.playing, false);
  bank.setMode('deposit');
  assert.equal(bank.getSnapshot().balance, 200);
  assert.equal(bank.getSnapshot().compression, null);
  assert.ok(bank.play(transaction('deposit', 10), true));
  advance(10_000);
  assert.equal(bank.getSnapshot().balance, 210);
  assert.equal(bank.getSnapshot().compression?.cue, 'finish');
  assert.ok(bank.getSnapshot().wallet.some(coin => coin.value === 10));
});
