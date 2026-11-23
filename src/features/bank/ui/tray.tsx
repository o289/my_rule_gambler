import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Coin, CoinValue } from '../model/bank-model';
import type { BankSnapshot } from '../application/bank-player';
import { GoldCoin } from './coin';
import { CoinMerger } from './coin-compression';

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

function CoinGroups({ wallet, renderCoin }: { wallet: readonly Coin[]; renderCoin: (coin: Coin) => ReactNode }) {
  const byValue = new Map<CoinValue, Coin[]>();
  for (const coin of wallet) {
    const group = byValue.get(coin.value);
    if (group) group.push(coin);
    else byValue.set(coin.value, [coin]);
  }
  const groups = [...byValue.entries()].sort((left, right) => right[0] - left[0]);
  const style: CSSProperties & { '--tray-groups': number } = { '--tray-groups': Math.max(1, groups.length) };
  return (
    <div className="tray-inset" style={style}>
      {groups.length === 0 && <span className="empty-wallet">コインなし</span>}
      {groups.map(([value, coins]) => {
        const sizes: CSSProperties & { '--coin-count': number } = { '--coin-count': coins.length };
        return (
          <div className="coin-group" data-value={value} key={value}>
            <div className="coin-positions" style={sizes} aria-hidden="true">{coins.map(renderCoin)}</div>
            <span className="coin-group-label">{value}点 <span>× {coins.length}枚</span></span>
          </div>
        );
      })}
    </div>
  );
}

export function PlayerTray({ snapshot, playerName, flightSources = [], flightTargets = [] }: {
  snapshot: Pick<BankSnapshot, 'mode' | 'balance' | 'wallet' | 'run' | 'compression'>;
  playerName: string;
  flightSources?: readonly Coin[];
  flightTargets?: readonly Coin[];
}) {
  const tray = useRef<HTMLDivElement>(null);
  const { wallet, balance, run, mode, compression } = snapshot;
  const deposit = mode === 'deposit';
  const reserved = new Set(!deposit && run?.playing ? run.payment.map(coin => coin.id) : []);
  const incoming = run ? deposit ? run.payment : run.change : [];
  const arrivals = run && !run.reduced ? [...run.flights.values()].filter(flight => flight.direction === 'deposit') : [];
  const returning = Boolean(run?.playing && run.reached.has('change'));
  const step = compression?.playing ? compression.steps[compression.index] : undefined;
  const gathering = compression?.cue === 'merge' ? step : undefined;
  const minted = compression?.cue === 'mint' ? step?.output.id : undefined;
  const gatheringIds = new Set(gathering?.inputs.map(coin => coin.id));
  const animateMerge = Boolean(gathering && !compression?.reduced && typeof Element.prototype.animate === 'function');
  const outgoing = run?.transaction.tender ?? run?.transaction.amount;
  return (
    <section className="player-area" aria-label="プレイヤーの得点と所持コイン" data-paying={Boolean(run?.playing)} data-direction={mode} data-incoming={returning}>
      <div className="wallet-score" data-balance={balance}>
        <span className="player-name">{playerName}</span>
        <div className="wallet-value">
          <Balance score={balance} animate={Boolean(run?.playing && !run.reduced)} />
          <span className="wallet-unit" aria-hidden="true">点</span>
          <span className="sr-only" aria-live="polite">現在の得点 {balance}点</span>
        </div>
        {run?.playing && (returning
          ? <strong className="payment-delta">お釣り ＋{outgoing === undefined ? 0 : outgoing - run.transaction.amount}点</strong>
          : <strong className="payment-delta" lang="en">{deposit ? '+' : '−'}{outgoing} POINTS</strong>)}
      </div>
      <div className="wallet-tray" ref={tray} data-compression={compression?.cue ?? 'idle'}>
        <CoinGroups wallet={wallet} renderCoin={coin => {
          const flying = Boolean(run && !run.reduced && run.flights.has(coin.id));
          const chosen = reserved.has(coin.id);
          const lifted = chosen && Boolean(run?.reached.has('lift'));
          const landed = incoming.some(item => item.id === coin.id) && Boolean(run?.playing && run.received.has(coin.id));
          const merging = gatheringIds.has(coin.id);
          const justMinted = minted === coin.id;
          return (
            <div className="coin-anchor" data-coin-id={coin.id} data-coin-value={coin.value}
              data-in-flight={flying} data-chosen={chosen} data-lifted={lifted} data-landed={landed} data-merge={merging} data-merge-hidden={merging && animateMerge}
              data-minted={justMinted} key={coin.id}>
              <span className="coin-in-tray"><GoldCoin coin={coin} /></span>
              {(landed || justMinted) && <i className="tray-receipt" />}
            </div>
          );
        }} />
        {run && arrivals.map(({ coin, index }) => {
          const futureWallet = [...wallet, ...incoming.slice(0, index + 1).filter(item => !run.received.has(item.id))];
          return (
            <div className="tray-projection" aria-hidden="true" key={coin.id}>
              <CoinGroups wallet={futureWallet} renderCoin={item => (
                <div className="coin-anchor" key={item.id}>
                  {item.id === coin.id && <span className="coin-in-tray" data-flight-target={coin.id} />}
                </div>
              )} />
            </div>
          );
        })}
        {gathering && animateMerge && <CoinMerger key={gathering.output.id} tray={tray} step={gathering} />}
        {(flightSources.length > 0 || flightTargets.length > 0) && <div className="tray-flight-anchors" aria-hidden="true">
          <CoinGroups wallet={[...flightSources, ...flightTargets]} renderCoin={coin => <div className="coin-anchor"
            data-coin-id={flightSources.some(source => source.id === coin.id) ? coin.id : undefined}
            data-flight-target={flightTargets.some(target => target.id === coin.id) ? coin.id : undefined} key={coin.id}>
            <span className="coin-in-tray"><GoldCoin coin={coin} /></span>
          </div>} />
        </div>}
      </div>
    </section>
  );
}
