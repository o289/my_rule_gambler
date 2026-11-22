import { bankBalance, collectionPlan, DEMO_RESERVE, readBankTransaction, selectPayment, transferCoins } from '../model/bank-model';
import type { BankBeat, BankCue, BankDirection, BankTransaction, Coin } from '../model/bank-model';

export interface Flight {
  readonly coin: Coin;
  readonly index: number;
  readonly startedAt: number;
}

export interface BankRun {
  readonly id: number;
  readonly transaction: BankTransaction;
  readonly payment: readonly Coin[];
  readonly cue: BankCue;
  readonly reached: ReadonlySet<BankCue>;
  readonly flights: ReadonlyMap<string, Flight>;
  readonly received: ReadonlySet<string>;
  readonly lastReceipt: Coin | null;
  readonly duration: number;
  readonly reduced: boolean;
  readonly playing: boolean;
  readonly skipped: boolean;
}

export interface BankSnapshot {
  readonly mode: BankDirection;
  readonly reserve: readonly Coin[];
  readonly balance: number;
  readonly wallet: readonly Coin[];
  readonly run: BankRun | null;
}

export interface BankAudioPort {
  cue(beat: BankBeat, reduced: boolean, direction: BankDirection): void;
  cut(): void;
}

interface Clock {
  now(): number;
  schedule(callback: () => void, milliseconds: number): number;
  cancel(timer: number): void;
}

const browserClock: Clock = {
  now: () => performance.now(),
  schedule: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
  cancel: timer => window.clearTimeout(timer),
};

export class BankPlayer {
  private sequence = 0;
  private timers = new Set<number>();
  private listeners = new Set<() => void>();
  private snapshot: BankSnapshot;

  constructor(
    private playerId: string,
    private initialWallet: readonly Coin[],
    private audio: BankAudioPort,
    private clock = browserClock,
    private initialReserve: readonly Coin[] = DEMO_RESERVE,
  ) {
    const coins = [...initialWallet, ...initialReserve];
    if (new Set(coins.map(coin => coin.id)).size !== coins.length) {
      throw new RangeError('コイン ID はプレイヤーと銀行で重複しないように指定してください。');
    }
    this.snapshot = this.initial('withdraw');
  }

  private initial(mode: BankDirection): BankSnapshot {
    return { mode, wallet: this.initialWallet, reserve: this.initialReserve, balance: bankBalance(this.initialWallet), run: null };
  }

  getSnapshot = () => this.snapshot;

  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => { this.listeners.delete(notify); };
  };

  private publish(snapshot: BankSnapshot) {
    this.snapshot = snapshot;
    for (const notify of this.listeners) notify();
  }

  private clearPending() {
    for (const timer of this.timers) this.clock.cancel(timer);
    this.timers.clear();
    this.audio.cut();
  }

  private enact(runId: number, beat: BankBeat, scheduledAt: number) {
    const { run, wallet, reserve } = this.snapshot;
    if (!run?.playing || run.id !== runId) return;
    let accounts = { wallet, reserve };
    let flights = run.flights;
    let received = run.received;
    let lastReceipt = run.lastReceipt;

    if (beat.cue === 'launch' && beat.coin && beat.index !== undefined) {
      const launch = { coin: beat.coin, index: beat.index, startedAt: scheduledAt };
      flights = new Map(flights).set(beat.coin.id, launch);
    }
    if (beat.cue === 'absorb' && beat.coin && !received.has(beat.coin.id)) {
      const coin = beat.coin;
      const remaining = new Map(flights);
      remaining.delete(coin.id);
      flights = remaining;
      received = new Set([...received, coin.id]);
      accounts = transferCoins(wallet, reserve, run.transaction.type, [coin]);
      lastReceipt = coin;
    }

    this.publish({
      ...this.snapshot,
      ...accounts,
      balance: bankBalance(accounts.wallet),
      run: {
        ...run,
        cue: beat.cue,
        reached: new Set([...run.reached, beat.cue]),
        flights,
        received,
        lastReceipt,
        playing: beat.cue !== 'finish',
      },
    });
    if (this.snapshot.run?.id === runId && !this.snapshot.run.skipped) this.audio.cue(beat, run.reduced, run.transaction.type);
  }

  play(value: unknown, reduced: boolean) {
    const transaction = readBankTransaction(value, this.playerId);
    if (this.snapshot.run) return false;
    const source = transaction.type === 'withdraw' ? this.snapshot.wallet : this.snapshot.reserve;
    const payment = selectPayment(source, transaction.amount);
    const plan = collectionPlan(payment, reduced);
    const id = ++this.sequence;
    const started = this.clock.now();
    const duration = plan.at(-1)?.at ?? 0;
    this.clearPending();
    this.publish({
      ...this.snapshot,
      mode: transaction.type,
      run: {
        id, transaction, payment, duration, reduced,
        cue: 'confirm', reached: new Set(['confirm']),
        flights: new Map(), received: new Set(), lastReceipt: null,
        playing: true, skipped: false,
      },
    });
    for (const beat of plan) {
      const current = this.getSnapshot().run;
      if (current?.id !== id || !current.playing) break;
      if (beat.at === 0) {
        this.enact(id, beat, started + beat.at);
      } else {
        const timer = this.clock.schedule(() => {
          this.timers.delete(timer);
          this.enact(id, beat, started + beat.at);
        }, Math.max(0, started + beat.at - this.clock.now()));
        this.timers.add(timer);
      }
    }
    return true;
  }

  skip() {
    const { wallet, reserve, run } = this.snapshot;
    if (!run?.playing) return;
    this.clearPending();
    const received = new Set(run.payment.map(coin => coin.id));
    const outstanding = run.payment.filter(coin => !run.received.has(coin.id));
    const accounts = transferCoins(wallet, reserve, run.transaction.type, outstanding);
    this.publish({
      ...this.snapshot,
      ...accounts,
      balance: bankBalance(accounts.wallet),
      run: {
        ...run, cue: 'finish', playing: false, skipped: true,
        received, flights: new Map(), lastReceipt: null,
      },
    });
  }

  replay(reduced: boolean) {
    const transaction = this.snapshot.run?.transaction;
    if (!transaction) return false;
    this.reset();
    return this.play(transaction, reduced);
  }

  setMode(mode: BankDirection) {
    if (this.snapshot.mode === mode) return;
    this.clearPending();
    this.publish(this.initial(mode));
  }

  reset() {
    this.clearPending();
    this.publish(this.initial(this.snapshot.mode));
  }
}
