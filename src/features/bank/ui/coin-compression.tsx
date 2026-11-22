import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { COMPRESSION_GATHER_MS } from '../model/bank-model';
import type { CoinCompression } from '../model/bank-model';
import { GoldCoin } from './coin';

export function CoinMerger({ step, tray }: { step: CoinCompression; tray: RefObject<HTMLDivElement | null> }) {
  const layer = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const parent = tray.current;
    const surface = layer.current;
    if (!surface || !parent) return;
    const started = performance.now();
    let animations: Animation[] = [];

    function measure() {
      if (!surface || !parent) return;
      animations.forEach(animation => animation.cancel());
      animations = [];
      const bounds = surface.getBoundingClientRect();
      const targetX = bounds.width * .5;
      const targetY = bounds.height * .12;
      const elapsed = performance.now() - started;
      for (const [index, coin] of step.inputs.entries()) {
        const source = parent.querySelector<HTMLElement>(`[data-coin-id="${CSS.escape(coin.id)}"] .coin-in-tray`);
        const clone = surface.querySelector<HTMLElement>(`[data-merge-from="${CSS.escape(coin.id)}"]`);
        if (!source || !clone) continue;
        const rect = source.getBoundingClientRect();
        clone.style.setProperty('--coin-size', `${source.offsetWidth}px`);
        const fromX = rect.left - bounds.left;
        const fromY = rect.top - bounds.top;
        const half = source.offsetWidth / 2;
        const endX = targetX - half;
        const endY = targetY - half - index * 2.5;
        const turn = index % 2 === 0 ? -1 : 1;
        const motion = clone.animate([
          { transform: `translate3d(${fromX}px,${fromY}px,0) rotate(${turn * 7}deg)`, opacity: 1 },
          { offset: .77, transform: `translate3d(${endX}px,${endY}px,0) rotate(${turn * 28}deg) scale(1.08)`, opacity: 1 },
          { offset: .92, transform: `translate3d(${endX}px,${endY}px,0) rotate(${turn * 14}deg) scale(.91)`, opacity: .9 },
          { transform: `translate3d(${endX}px,${endY}px,0) scale(.70)`, opacity: 0 },
        ], { duration: COMPRESSION_GATHER_MS, easing: 'cubic-bezier(.29,.62,.28,1)', fill: 'both' });
        motion.currentTime = Math.min(elapsed, COMPRESSION_GATHER_MS);
        animations.push(motion);
      }
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => {
      observer.disconnect();
      animations.forEach(animation => animation.cancel());
    };
  }, [step, tray]);

  return <div className="coin-merger" ref={layer} aria-hidden="true">
    <i className="coin-merge-halo" />
    {step.inputs.map(coin => <div className="coin-merge-actor" data-merge-from={coin.id} key={coin.id}><GoldCoin coin={coin} /></div>)}
  </div>;
}
