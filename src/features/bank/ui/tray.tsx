import { useLayoutEffect, useRef } from 'react';
import { DEMO_PLAYER } from '../model/bank-model';
import type { Coin } from '../model/bank-model';
import type { BankSnapshot } from '../application/bank-player';
import { GoldCoin } from './coin';

function Balance({ score, animate }: { score: number; animate: boolean }) {
  const value = useRef<HTMLOutputElement>(null);
  const shown = useRef(score);

  useLayoutEffect(() => {
    const element = value.current;
    if (!element) return;
    const start = shown.current;
    if (!animate || start === score) {
      element.value = String(score);
      shown.current = score;
      return;
    }
    let frame = 0;
    const now = performance.now();
    const duration = 258;
    function update(time: number) {
      if (!element) return;
      const progress = Math.min(1, (time - now) / duration);
      const number = Math.round(start + (score - start) * (1 - (1 - progress) ** 3));
      shown.current = number;
      element.value = String(number);
      if (progress < 1) frame = requestAnimationFrame(update);
    }
    element.value = String(start);
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [score, animate]);

  return <output className="score-value" ref={value} aria-hidden="true">{score}</output>;
}

interface PlayerTrayProps {
  snapshot: BankSnapshot;
  initialWallet: readonly Coin[];
  incoming: readonly Coin[];
}

export function PlayerTray({ snapshot, initialWallet, incoming }: PlayerTrayProps) {
  const { wallet, balance, run, mode } = snapshot;
  const deposit = mode === 'deposit';
  const incomingIds = new Set(incoming.map(coin => coin.id));
  const reserved = new Set(!deposit && run?.playing ? run.payment.map(coin => coin.id) : []);
  const remaining = new Set(wallet.map(coin => coin.id));
  const byValue = new Map<number, Coin[]>();
  for (const coin of [...initialWallet, ...incoming]) {
    const group = byValue.get(coin.value);
    if (group) group.push(coin);
    else byValue.set(coin.value, [coin]);
  }
  const groups = [...byValue.entries()].sort((left, right) => right[0] - left[0]);
  return (
    <section className="player-area" aria-label="プレイヤーの得点と所持コイン" data-paying={Boolean(run?.playing)} data-direction={mode}>
      <div className="wallet-score" data-balance={balance}>
        <span className="player-name">{DEMO_PLAYER.name}</span>
        <div className="wallet-value">
          <Balance score={balance} animate={Boolean(run?.playing && !run.reduced)} />
          <span className="wallet-unit" aria-hidden="true">点</span>
          <span className="sr-only" aria-live="polite">現在の得点 {balance}点</span>
        </div>
        {run?.playing && <strong className="payment-delta" lang="en">{deposit ? '+' : '−'}{run.transaction.amount} POINTS</strong>}
      </div>
      <div className="wallet-tray">
        <div className="tray-inset">
          {groups.map(([value, coins]) => (
            <div className="coin-group" data-small={value < 50} data-dense={coins.length > (value < 50 ? 5 : 3)} key={value}>
              <div className="coin-positions" aria-hidden="true">
                {coins.map(coin => {
                  const present = remaining.has(coin.id);
                  const flying = Boolean(run && !run.reduced && run.flights.has(coin.id));
                  const chosen = reserved.has(coin.id) && present;
                  const lifted = chosen && Boolean(run?.reached.has('lift'));
                  const pending = incomingIds.has(coin.id) && !present;
                  const landed = deposit && Boolean(run?.playing && run.received.has(coin.id));
                  return (
                    <div className="coin-anchor" data-coin-id={coin.id} data-coin-value={coin.value} data-present={present} data-in-flight={flying} data-chosen={chosen} data-lifted={lifted} data-pending={pending} data-landed={landed} key={coin.id}>
                      <span className="coin-in-tray"><GoldCoin coin={coin} /></span>
                      {landed && <i className="tray-receipt" />}
                    </div>
                  );
                })}
              </div>
              <span className="coin-group-label">{value}点 <span>× {coins.filter(coin => remaining.has(coin.id)).length}枚</span></span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
