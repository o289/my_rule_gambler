import { useAudioActivation } from '../../../shared/audio/use-audio-activation';
import { StrictMode, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { audio, bank, bankActions as api } from '../application/bank-api';
import { BANK_AMOUNT_STEP, bankBalance, DEFAULT_BANK_AMOUNT, DEMO_PLAYER, DEMO_RESERVE, DEMO_WALLET, selectPayment, VAULT_DOOR_MS } from '../model/bank-model';
import type { BankCue, BankDirection, Coin } from '../model/bank-model';
import { CoinFlights } from './coin-flight';
import { PlayerTray } from './tray';
import { Vault } from './vault';
import './style.css';

declare global {
  interface Window { gamblerBank: typeof api; }
}

window.gamblerBank = Object.freeze(api);

const STAGE_STATUS: Record<BankCue, string> = {
  confirm: '支払い確定',
  wake: '金庫起動',
  unlock: '金庫解錠',
  open: '金庫開放',
  lift: 'コインを持ち上げています',
  launch: 'コインを移動しています',
  absorb: 'コインを回収しています',
  close: '金庫を閉めています',
  lock: '金庫施錠',
  finish: '回収完了',
};

const MODES = {
  withdraw: { label: '支払い', intro: '手元の金貨を、カジノの奥にある金庫へ。', action: '点支払う', result: '回収完了' },
  deposit: { label: '受け取り', intro: '金庫から届く金貨を、手元のトレーへ。', action: '点受け取る', result: '受け取り完了' },
} satisfies Record<BankDirection, { label: string; intro: string; action: string; result: string }>;

function stageStatus(cue: BankCue, mode: BankDirection) {
  if (mode === 'deposit') {
    if (cue === 'confirm') return '受け取り確定';
    if (cue === 'lift') return '金庫からコインを送り出します';
    if (cue === 'absorb') return 'コインを受け取っています';
  }
  return STAGE_STATUS[cue];
}

function summarize(coins: readonly Coin[]) {
  const grouped = new Map<number, number>();
  for (const coin of coins) grouped.set(coin.value, (grouped.get(coin.value) ?? 0) + 1);
  return [...grouped.entries()].map(([value, count]) => `${value}点コイン × ${count}枚`).join('、');
}

function App() {
  useAudioActivation(audio.unlock);
  const snapshot = useSyncExternalStore(bank.subscribe, bank.getSnapshot);
  const { run, mode } = snapshot;
  const selected = MODES[mode];
  const [amount, setAmount] = useState(String(DEFAULT_BANK_AMOUNT));
  const activeAmount = run?.playing ? String(run.transaction.amount) : amount;
  const points = Number(activeAmount);
  const startingCoins = mode === 'withdraw' ? DEMO_WALLET : DEMO_RESERVE;
  const source = run ? startingCoins : mode === 'withdraw' ? snapshot.wallet : snapshot.reserve;
  const limit = bankBalance(source);
  const completedAmount = run && !run.playing ? run.transaction.amount : null;
  const stage = useRef<HTMLDivElement>(null);
  const { plannedCoins, amountError } = useMemo(() => {
    try {
      return { plannedCoins: selectPayment(source, points), amountError: '' };
    } catch (exception) {
      return { plannedCoins: [], amountError: exception instanceof RangeError ? exception.message : '取引額を確認してください。' };
    }
  }, [source, points]);
  const plan = run?.playing ? run.payment : plannedCoins;
  const canPay = !run?.playing && !amountError && completedAmount !== points;
  const style: CSSProperties & { '--door-ms': string; '--run-ms': string } = {
    '--door-ms': `${VAULT_DOOR_MS}ms`, '--run-ms': `${run?.duration ?? 0}ms`,
  };

  function showStage() {
    const scene = stage.current;
    if (!scene || !matchMedia('(max-width: 860px)').matches) return;
    const bounds = scene.getBoundingClientRect();
    if (bounds.top < 5 || bounds.bottom > innerHeight - 5) scene.scrollIntoView({ block: 'start' });
  }

  function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = bank.getSnapshot();
    if (!canPay || current.mode !== mode || current.run?.playing || current.run?.transaction.amount === points) return;
    if (current.run) api.reset();
    if (api.playBankTransaction({ type: mode, playerId: DEMO_PLAYER.id, amount: points })) showStage();
  }

  function replay() {
    if (!run) return;
    setAmount(String(run.transaction.amount));
    showStage();
    api.replay();
  }

  return (
    <main className="bank-app">
      <header className="bank-masthead">
        <div className="bank-wordmark" aria-label="Atelier Noir">
          <svg viewBox="0 0 32 32" width="32" height="32" fill="none" aria-hidden="true">
            <path d="M16 1.5 L30.5 16 L16 30.5 L1.5 16 Z M16 7l9 9-9 9-9-9Z M16 11.5l4.5 4.5-4.5 4.5L11.5 16Z" stroke="currentColor" />
            <path d="M16 1.5v10m0 9v10M1.5 16h10m9 0h10" stroke="currentColor" />
          </svg>
          <span>ATELIER NOIR</span>
        </div>
      </header>
      <div className="bank-intro">
        <h1>銀行・コイン取引</h1>
        <p>{selected.intro}</p>
      </div>
      <div className="bank-layout">
        <section className="bank-cabinet" aria-label="銀行とプレイヤートレー" style={style}>
          <div className="bank-stage" ref={stage} data-cue={run?.cue ?? 'idle'} data-direction={mode} data-playing={Boolean(run?.playing)}>
            <div className="bank-matte" aria-hidden="true"><i /><i /><i /><i /></div>
            <Vault key={`vault-${run?.id ?? 'idle'}`} run={run} />
            <PlayerTray key={`tray-${run?.id ?? 'idle'}`} snapshot={snapshot} />
            {run && !run.reduced && <CoinFlights stage={stage} flights={run.flights} direction={run.transaction.type} />}
          </div>
          <div className="bank-footer">
            {run && <div className="progress-track" aria-hidden="true"><div key={run.id} className="progress-amount" data-running={run.playing} /></div>}
            <div className="bank-readout">
              <span>取引状況</span>
              <strong aria-live="polite">{run?.playing ? stageStatus(run.cue, mode) : run ? `${run.transaction.amount}点の${selected.result}` : `${selected.label}を開始できます`}</strong>
            </div>
            <button type="button" className="quiet-button" id="skip-payment" onClick={api.skip} disabled={!run?.playing}>演出スキップ</button>
          </div>
        </section>

        <aside className="bank-controls" aria-labelledby="controls-title">
          <h2 id="controls-title">取引</h2>
          <fieldset className="bank-modes">
            <legend className="sr-only">取引モード</legend>
            {(['withdraw', 'deposit'] as const).map(option => (
              <label key={option}>
                <input type="radio" name="bank-mode" value={option} checked={mode === option} onChange={() => bank.setMode(option)} />
                <span>{MODES[option].label}</span>
              </label>
            ))}
          </fieldset>
          <form className="bank-amount-form" onSubmit={pay} noValidate>
            <div className="bank-amount-row">
              <label htmlFor="bank-amount">取引額</label>
              <div className="bank-amount-field">
                <input id="bank-amount" type="number" inputMode="numeric" min={BANK_AMOUNT_STEP} max={limit} step={BANK_AMOUNT_STEP}
                  value={activeAmount} disabled={Boolean(run?.playing)} aria-invalid={Boolean(amountError)}
                  aria-describedby="bank-amount-note" onChange={event => setAmount(event.currentTarget.value)} />
                <span aria-hidden="true">点</span>
              </div>
            </div>
            <p className="bank-amount-note" id="bank-amount-note" data-invalid={Boolean(amountError)} aria-live="polite">
              {amountError || `${BANK_AMOUNT_STEP}点単位 · ${mode === 'withdraw' ? '所持' : '金庫'} ${limit}点まで`}
            </p>
            <div className="payment-summary" data-direction={mode}>
              <span className="payment-summary-label">コインの内訳</span>
              <span aria-live="polite">{plan.length ? summarize(plan) : '—'}</span>
            </div>
            <button type="submit" id="pay-button" className="pay-button" disabled={!canPay}>{amountError ? selected.label : `${points}${selected.action}`}</button>
            {canPay && completedAmount !== null && <p className="bank-amount-note">次の取引は初期残高から開始します。</p>}
          </form>
          <div className="reset-actions">
            <button type="button" className="quiet-button" id="replay-payment" disabled={!run} onClick={replay}>もう一度再生</button>
            <button type="button" className="quiet-button" id="reset-payment" onClick={api.reset}>リセット</button>
          </div>
        </aside>
      </div>
    </main>
  );
}

export default function BankPreview() {
  return <StrictMode><App /></StrictMode>;
}
