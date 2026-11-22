import {
  applyCompression, bankBalance, collectionPlan, compressionTiming, planCompression, readBankTransaction, selectExchange, transferCoins,
} from '../model/bank-model';
import type { BankBeat, BankCue, BankDirection, BankTransaction, Coin, CoinCompression, CoinValue } from '../model/bank-model';

export interface Flight {
  readonly coin: Coin;
  readonly index: number;
  readonly startedAt: number;
  readonly direction: BankDirection;
}

export interface BankRun {
  readonly id: number;
  readonly transaction: BankTransaction;
  readonly payment: readonly Coin[];
  readonly change: readonly Coin[];
  readonly beforeWallet: readonly Coin[];
  readonly beforeReserve: readonly Coin[];
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

export interface BankCompression {
  readonly id: number;
  readonly steps: readonly CoinCompression[];
  readonly index: number;
  readonly beforeWallet: readonly Coin[];
  readonly cue: 'merge' | 'mint' | 'finish';
  readonly reduced: boolean;
  readonly manual: boolean;
  readonly playing: boolean;
}

export interface BankSnapshot {
  readonly mode: BankDirection;
  readonly reserve: readonly Coin[];
  readonly balance: number;
  readonly wallet: readonly Coin[];
  readonly run: BankRun | null;
  readonly compression: BankCompression | null;
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

function receivedCoins(run: BankRun) {
  return run.transaction.type === 'deposit' ? run.payment : run.change;
}

export class BankPlayer {
  private sequence = 0;
  private minted = 0;
  private timers = new Set<number>();
  private listeners = new Set<() => void>();
  private readonly initialCoinIds: Set<string>;
  private snapshot: BankSnapshot;

  constructor(
    private playerId: string,
    private initialWallet: readonly Coin[],
    private audio: BankAudioPort,
    private initialReserve: readonly Coin[],
    private clock = browserClock,
  ) {
    const coins = [...initialWallet, ...initialReserve];
    this.initialCoinIds = new Set(coins.map(coin => coin.id));
    if (this.initialCoinIds.size !== coins.length) {
      throw new RangeError('コイン ID はプレイヤーと銀行で重複しないように指定してください。');
    }
    this.snapshot = this.initial('withdraw');
  }

  private initial(mode: BankDirection): BankSnapshot {
    return { mode, wallet: this.initialWallet, reserve: this.initialReserve, balance: bankBalance(this.initialWallet), run: null, compression: null };
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

  private after(at: number, callback: () => void) {
    const timer = this.clock.schedule(() => {
      this.timers.delete(timer);
      callback();
    }, Math.max(0, at - this.clock.now()));
    this.timers.add(timer);
  }

  private mintCoin(value: CoinValue): Coin {
    let id = `compressed-${++this.minted}`;
    while (this.initialCoinIds.has(id)) id = `compressed-${++this.minted}`;
    return { id, value };
  }

  private prepareCompression(wallet: readonly Coin[], reduced: boolean, manual: boolean): BankCompression | null {
    const steps = planCompression(wallet, value => this.mintCoin(value));
    return steps.length ? { id: ++this.sequence, steps, index: 0, beforeWallet: wallet, cue: 'merge', reduced, manual, playing: true } : null;
  }

  private animateCompression(id: number) {
    const current = this.snapshot.compression;
    if (!current?.playing || current.id !== id || current.cue !== 'merge') return;
    const step = current.steps[current.index];
    if (!step) return;
    const { gather, mint } = compressionTiming(current.reduced);
    const started = this.clock.now();
    this.audio.cue({ cue: 'merge', at: 0 }, current.reduced, 'deposit');
    this.after(started + gather, () => {
      const active = this.snapshot.compression;
      if (!active?.playing || active.id !== id) return;
      const wallet = applyCompression(this.snapshot.wallet, step);
      this.publish({ ...this.snapshot, wallet, compression: { ...active, cue: 'mint' } });
      if (this.snapshot.compression?.id === id && this.snapshot.compression.playing) {
        this.audio.cue({ cue: 'mint', coin: step.output, at: gather }, active.reduced, 'deposit');
      }
    });
    this.after(started + gather + mint, () => {
      const active = this.snapshot.compression;
      if (!active?.playing || active.id !== id) return;
      const hasNext = active.index + 1 < active.steps.length;
      this.publish({
        ...this.snapshot,
        compression: hasNext ? { ...active, index: active.index + 1, cue: 'merge' } : { ...active, cue: 'finish', playing: false },
      });
      if (hasNext) this.animateCompression(id);
    });
  }

  private enact(runId: number, beat: BankBeat, scheduledAt: number) {
    const { run, wallet, reserve } = this.snapshot;
    if (!run?.playing || run.id !== runId) return;
    const direction = beat.direction ?? run.transaction.type;
    let accounts = { wallet, reserve };
    let flights = run.flights;
    let received = run.received;
    let lastReceipt = run.lastReceipt;

    if (beat.cue === 'launch' && beat.coin && beat.index !== undefined) {
      const launch = { coin: beat.coin, index: beat.index, startedAt: scheduledAt, direction };
      flights = new Map(flights).set(beat.coin.id, launch);
    }
    if (beat.cue === 'absorb' && beat.coin && !received.has(beat.coin.id)) {
      const coin = beat.coin;
      const remaining = new Map(flights);
      remaining.delete(coin.id);
      flights = remaining;
      received = new Set([...received, coin.id]);
      accounts = transferCoins(wallet, reserve, direction, [coin]);
      lastReceipt = coin;
    }

    const compression = beat.cue === 'finish' && receivedCoins(run).length
      ? this.prepareCompression(accounts.wallet, run.reduced, false) : null;
    this.publish({
      ...this.snapshot,
      ...accounts,
      balance: bankBalance(accounts.wallet),
      compression,
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
    if (this.snapshot.run?.id === runId && !this.snapshot.run.skipped) this.audio.cue(beat, run.reduced, direction);
    if (compression) this.animateCompression(compression.id);
  }

  play(value: unknown, reduced: boolean) {
    const transaction = readBankTransaction(value, this.playerId);
    if (this.snapshot.run || this.snapshot.compression?.playing) return false;
    const { wallet, reserve } = this.snapshot;
    const { payment, change } = selectExchange(wallet, reserve, transaction);
    const plan = collectionPlan(payment, reduced, transaction.type, change);
    const id = ++this.sequence;
    const started = this.clock.now();
    const duration = plan.at(-1)?.at ?? 0;
    this.clearPending();
    this.publish({
      ...this.snapshot,
      mode: transaction.type,
      compression: null,
      run: {
        id, transaction, payment, change, beforeWallet: wallet, beforeReserve: reserve, duration, reduced,
        cue: 'confirm', reached: new Set(['confirm']),
        flights: new Map(), received: new Set(), lastReceipt: null,
        playing: true, skipped: false,
      },
    });
    for (const beat of plan) {
      const current = this.getSnapshot().run;
      if (current?.id !== id || !current.playing) break;
      if (beat.at === 0) this.enact(id, beat, started);
      else this.after(started + beat.at, () => this.enact(id, beat, started + beat.at));
    }
    return true;
  }

  compress(reduced: boolean) {
    if (this.snapshot.run?.playing || this.snapshot.compression?.playing) return false;
    const compression = this.prepareCompression(this.snapshot.wallet, reduced, true);
    if (!compression) return false;
    this.clearPending();
    this.publish({ ...this.snapshot, compression });
    this.animateCompression(compression.id);
    return true;
  }

  private finishCompression(wallet: readonly Coin[], compression: BankCompression) {
    const nextIndex = compression.index + (compression.cue === 'mint' ? 1 : 0);
    const merged = compression.steps.slice(nextIndex).reduce<readonly Coin[]>(applyCompression, wallet);
    return {
      wallet: merged,
      compression: { ...compression, index: compression.steps.length - 1, cue: 'finish' as const, playing: false },
    };
  }

  skip() {
    const { wallet, reserve, run, compression } = this.snapshot;
    if (compression?.playing) {
      this.clearPending();
      this.publish({ ...this.snapshot, ...this.finishCompression(wallet, compression) });
      return;
    }
    if (!run?.playing) return;

    this.clearPending();
    const outstanding = run.payment.filter(coin => !run.received.has(coin.id));
    const amounts = transferCoins(wallet, reserve, run.transaction.type, outstanding);
    const outstandingChange = run.change.filter(coin => !run.received.has(coin.id));
    const accounts = transferCoins(amounts.wallet, amounts.reserve, 'deposit', outstandingChange);
    const merge = receivedCoins(run).length ? this.prepareCompression(accounts.wallet, run.reduced, false) : null;
    this.publish({
      ...this.snapshot,
      ...accounts,
      ...(merge ? this.finishCompression(accounts.wallet, merge) : {}),
      balance: bankBalance(accounts.wallet),
      run: {
        ...run, cue: 'finish', playing: false, skipped: true,
        received: new Set([...run.payment, ...run.change].map(coin => coin.id)), flights: new Map(), lastReceipt: null,
      },
    });
  }

  replay(reduced: boolean) {
    const { run, mode, compression } = this.snapshot;
    if (compression?.manual) {
      this.clearPending();
      this.publish({ ...this.snapshot, wallet: compression.beforeWallet, compression: null });
      return this.compress(reduced);
    }
    if (!run) return false;
    this.clearPending();
    this.publish({
      ...this.initial(mode), wallet: run.beforeWallet, reserve: run.beforeReserve, balance: bankBalance(run.beforeWallet),
    });
    return this.play(run.transaction, reduced);
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
