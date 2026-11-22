import type { CSSProperties, Ref } from 'react';
import type { Coin, CoinValue } from '../model/bank-model';
import goldHundred from '../../../shared/assets/bank/coin-100.webp';
import goldFifty from '../../../shared/assets/bank/coin-50.webp';
import goldTen from '../../../shared/assets/bank/coin-10.webp';
import coinBack from '../../../shared/assets/bank/coin-back.webp';
import './coin.css';

const FACES = {
  10: { image: goldTen, alloy: 'champagne' },
  50: { image: goldFifty, alloy: 'amber' },
  100: { image: goldHundred, alloy: 'royal' },
} satisfies Record<CoinValue, { image: string; alloy: string }>;

const RIM_SEGMENTS = Array.from({ length: 32 }, (_, index) => index * (360 / 32));
type EdgeStyle = CSSProperties & { '--segment-angle': string };

export function GoldCoin({ coin, rotor }: { coin: Coin; rotor?: Ref<HTMLSpanElement> }) {
  const { image, alloy } = FACES[coin.value];

  return (
    <span className="coin-shell" data-alloy={alloy} aria-hidden="true">
      <span className="coin-solid" ref={rotor}>
        <span className="coin-face coin-front">
          <img src={image} alt="" draggable={false} />
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
