import { StrictMode, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { audio, bank, bankActions as api } from '../application/bank-api';
import { DEMO_RESERVE, DEMO_TRANSACTIONS, DEMO_WALLET, selectPayment, VAULT_DOOR_MS } from '../model/bank-model';
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
  const snapshot = useSyncExternalStore(bank.subscribe, bank.getSnapshot);
  const { run, mode } = snapshot;
  const selected = MODES[mode];
  const transaction = DEMO_TRANSACTIONS[mode];
  const stage = useRef<HTMLDivElement>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [audioPending, setAudioPending] = useState(false);
  const [volume, setVolume] = useState(64);
  const [error, setError] = useState('');
  const defaultCoins = useMemo(
    () => selectPayment(mode === 'withdraw' ? DEMO_WALLET : DEMO_RESERVE, transaction.amount),
    [mode, transaction.amount],
  );
  const plannedCoins = run?.payment ?? defaultCoins;
  const style: CSSProperties & { '--door-ms': string; '--run-ms': string } = {
    '--door-ms': `${VAULT_DOOR_MS}ms`, '--run-ms': `${run?.duration ?? 0}ms`,
  };

  function showStage() {
    const scene = stage.current;
    if (!scene || !matchMedia('(max-width: 860px)').matches) return;
    const bounds = scene.getBoundingClientRect();
    if (bounds.top < 5 || bounds.bottom > innerHeight - 5) scene.scrollIntoView({ block: 'start' });
  }

  async function toggleAudio() {
    if (audioPending) return;
    setAudioPending(true);
    setError('');
    try {
      const status = await audio.enable(!soundOn);
      setSoundOn(status);
      if (!status && !soundOn) setError('このブラウザで効果音を有効にできませんでした。');
    } catch {
      setError('このブラウザで効果音を有効にできませんでした。');
    } finally {
      setAudioPending(false);
    }
  }

  function updateVolume(next: number) {
    setVolume(next);
    audio.setVolume(next / 100);
  }

  function pay() {
    showStage();
    api.playBankTransaction(transaction);
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
            <PlayerTray key={`tray-${run?.id ?? 'idle'}`} snapshot={snapshot} initialWallet={DEMO_WALLET} incoming={mode === 'deposit' ? plannedCoins : []} />
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
          <div className="payment-summary" data-direction={mode}>
            <div><strong>{run?.transaction.amount ?? transaction.amount}</strong><span>点</span></div>
            <span>{summarize(plannedCoins)}</span>
          </div>
          <button type="button" id="pay-button" className="pay-button" disabled={Boolean(run)} onClick={pay}>{transaction.amount}{selected.action}</button>
          <div className="reset-actions">
            <button type="button" className="quiet-button" id="replay-payment" disabled={!run} onClick={() => { showStage(); api.replay(); }}>もう一度再生</button>
            <button type="button" className="quiet-button" id="reset-payment" onClick={api.reset}>リセット</button>
          </div>
          <div className="audio-controls">
            <div className="audio-heading">
              <h2>効果音</h2>
              <button type="button" aria-pressed={soundOn} aria-label="効果音" className="quiet-button" id="sound-toggle" disabled={audioPending} onClick={toggleAudio}>{soundOn ? 'ON' : 'OFF'}</button>
            </div>
            <label className="volume-label" htmlFor="sound-volume">音量 <span>{volume}%</span></label>
            <input type="range" id="sound-volume" min="0" max="100" value={volume} onChange={event => updateVolume(event.currentTarget.valueAsNumber)} />
            {error && <p className="audio-error" role="alert">{error}</p>}
          </div>
        </aside>
      </div>
    </main>
  );
}

export default function BankPreview() {
  return <StrictMode><App /></StrictMode>;
}
