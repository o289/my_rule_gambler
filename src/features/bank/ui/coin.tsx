import type { CSSProperties, Ref } from 'react';
import type { Coin } from '../model/bank-model';
import goldFifty from '../../../shared/assets/bank/coin-50.webp';
import goldTen from '../../../shared/assets/bank/coin-10.webp';
import coinBack from '../../../shared/assets/bank/coin-back.webp';

const RIM_SEGMENTS = Array.from({ length: 32 }, (_, index) => index * (360 / 32));
type EdgeStyle = CSSProperties & { '--segment-angle': string };

export function GoldCoin({ coin, rotor }: { coin: Coin; rotor?: Ref<HTMLSpanElement> }) {
  const appearance = coin.value >= 50 ? 'amber' : 'champagne';

  return (
    <span className="coin-shell" data-alloy={appearance} aria-hidden="true">
      <span className="coin-solid" ref={rotor}>
        <span className="coin-face coin-front">
          <img src={appearance === 'amber' ? goldFifty : goldTen} alt="" draggable={false} />
          <span className="coin-denomination">{coin.value}</span>
          <i className="coin-sheen" />
        </span>
        <span className="coin-face coin-back">
          <img src={coinBack} alt="" draggable={false} />
          <i className="coin-sheen" />
        </span>
        {RIM_SEGMENTS.map(angle => {
          const style: EdgeStyle = { '--segment-angle': `${angle}deg` };
          return <i key={angle} className="coin-edge" style={style} />;
        })}
      </span>
    </span>
  );
}
