import { useMemo, useRef, useState } from 'react';
import { CoinFlights } from '../../bank/ui/coin-flight';
import { GoldCoin } from '../../bank/ui/coin';
import type { Flight } from '../../bank/application/bank-player';
import type { Coin } from '../../bank/model/bank-model';
import { requiredGemAt } from '../../board/model/board-model';
import { CrownIcon } from '../../players/ui/vip-icons';
import { CurrentTurnHighlight } from '../../players/ui/turn-highlight';
import { reached } from '../application/effect-player';
import type { EffectPlayback } from '../application/effect-player';
import { LOSS_COIN_STAGGER_MS, lossCoins, lossLabel, turnLabel } from '../model/effect-model';
import type { EffectParams, EffectScenario } from '../model/effect-model';
import { BoardScene } from './board-scene';
import hall from '../../../shared/assets/bank/vault-hall.webp';
import door from '../../../shared/assets/bank/vault-door.webp';
import './settlement-scenes.css';

export function TurnAnnouncement({ player, pulse }: { player: EffectParams['TURN_CHANGE']; pulse: boolean }) {
  return (
    <div className="turn-announcement" role="status">
      {pulse && <CurrentTurnHighlight once />}
      <CrownIcon />
      <div>
        {player.isLocal && <span className="turn-announcement-name">{player.playerName}</span>}
        <strong>{turnLabel(player)}</strong>
      </div>
    </div>
  );
}

export function TurnChangeEffect({ playback, params, scenario, onRoll }: {
  playback: EffectPlayback;
  params: EffectParams['TURN_CHANGE'];
  scenario: EffectScenario;
  onRoll: () => void;
}) {
  return (
    <div className="turn-scene turn-change-scene">
      <BoardScene definition={scenario.board} />
      <section className="turn-panel" aria-label="手番の案内">
        <TurnAnnouncement player={params} pulse={!playback.skipped && !playback.reduced} />
        {params.isLocal && <button className="turn-roll-button" type="button" lang="en" disabled={playback.playing} onClick={onRoll}>ROLL DICE</button>}
      </section>
    </div>
  );
}

function LossFlights({ coins, stage }: { coins: readonly Coin[]; stage: React.RefObject<HTMLDivElement | null> }) {
  const [startedAt] = useState(() => performance.now());
  const flights = useMemo(() => new Map<string, Flight>(coins.map((coin, index) => [coin.id, {
    coin, index, direction: 'withdraw', startedAt: startedAt + LOSS_COIN_STAGGER_MS * index,
  }])), [coins, startedAt]);
  return <CoinFlights flights={flights} stage={stage} />;
}

export function LossNoticeEffect({ playback, params, scenario }: {
  playback: EffectPlayback;
  params: EffectParams['LOSS_NOTICE'];
  scenario: EffectScenario;
}) {
  const { paidPoints, playerName, target } = params;
  const bank = useRef<HTMLDivElement>(null);
  const coins = useMemo(() => lossCoins(paidPoints), [paidPoints]);
  const placed = reached(playback, 'place');
  const settled = reached(playback, 'reveal');
  const open = reached(playback, 'charge') && !settled;
  const flying = reached(playback, 'flight') && !settled && !playback.reduced;
  const animatingScore = placed && playback.playing;
  const label = lossLabel(paidPoints);

  return (
    <div className="turn-scene loss-scene">
      <BoardScene definition={scenario.board} target={target} tone={placed ? undefined : 'gold'}
        placed={placed ? requiredGemAt(scenario.board, target) : undefined}
        award={animatingScore ? { id: playback.id, rowId: target.rowId, amount: -paidPoints } : null}
        scoreNotice={placed ? { rowId: target.rowId, label } : undefined} />
      <section className="turn-panel loss-panel" aria-label="失点と金庫">
        <div className="loss-score" data-confirmed={placed} data-paid={paidPoints > 0} role="status">
          <span>{playerName}</span>
          <strong>{placed ? label : 'マイナスの行　あと1マス'}</strong>
        </div>
        <div className="loss-bank" ref={bank} data-open={open} data-received={settled && paidPoints > 0 && !playback.skipped}>
          <img className="loss-bank-hall" src={hall} alt="" aria-hidden="true" />
          <div className="loss-bank-doorway" aria-hidden="true">
            <span className="loss-bank-mouth" data-vault-mouth="" />
            <img className="loss-bank-door" src={door} alt="" draggable={false} />
          </div>
          <span className="loss-bank-label">{open ? '金庫開放' : settled && paidPoints > 0 ? '金庫に支払い済み' : '金庫'}</span>
          <div className="loss-tray" aria-label="プレイヤーの金貨トレー">
            {!settled && coins.map(coin => (
              <span className="loss-coin-slot" data-coin-id={coin.id} data-flying={flying} key={coin.id}>
                <span className="coin-in-tray"><GoldCoin coin={coin} /></span>
              </span>
            ))}
            {(settled || !coins.length) && <span className="loss-tray-label">金貨トレー</span>}
          </div>
          {flying && <LossFlights coins={coins} stage={bank} />}
        </div>
      </section>
    </div>
  );
}
