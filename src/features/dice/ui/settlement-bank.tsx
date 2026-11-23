import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import type { MatchPlayerSetup, MatchSettlementEvent } from '../../../shared/contracts/dice';
import { BankPlayer } from '../../bank/application/bank-player';
import type { BankAudioPort } from '../../bank/application/bank-player';
import { VAULT_DOOR_MS } from '../../bank/model/bank-model';
import { settlementPlaybackCoins } from '../../bank/model/settlement-coins';
import { CoinFlights } from '../../bank/ui/coin-flight';
import { PlayerTray } from '../../bank/ui/tray';
import { Vault } from '../../bank/ui/vault';
import { scoreLabel } from '../../effects/model/effect-model';
import '../../bank/ui/style.css';

const cabinetStyle: CSSProperties & { '--door-ms': string } = { '--door-ms': `${VAULT_DOOR_MS}ms` };

export function SettlementBank({ event, player, audio, reduced, onComplete }: {
  event: MatchSettlementEvent;
  player: MatchPlayerSetup;
  audio: BankAudioPort;
  reduced: boolean;
  onComplete: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const direction = event.points > 0 ? 'deposit' : 'withdraw';
  const bank = useMemo(() => {
    const { wallet, reserve } = settlementPlaybackCoins(player.score, event.points);
    return new BankPlayer(player.id, wallet, audio, reserve);
  }, [audio, event.points, player.id, player.score]);
  const snapshot = useSyncExternalStore(bank.subscribe, bank.getSnapshot);
  const { run, compression } = snapshot;

  useEffect(() => {
    bank.play({ type: direction, playerId: player.id, amount: Math.abs(event.points) }, reduced);
    return () => bank.reset();
  }, [bank, direction, event.points, player.id, reduced]);

  useEffect(() => {
    if (run && !run.playing && !compression?.playing) onComplete();
  }, [run, compression, onComplete]);

  return <section className="bank-cabinet settlement-bank-cabinet" style={cabinetStyle} aria-labelledby="settlement-bank-title">
    <header className="settlement-bank-heading">
      <h2 id="settlement-bank-title">金庫</h2>
      <p>{player.name}　<strong>{scoreLabel(event.points)}</strong></p>
    </header>
    <div className="bank-stage" ref={stage} data-direction={direction} data-playing={Boolean(run?.playing || compression?.playing)}>
      <Vault run={run} />
      <PlayerTray snapshot={snapshot} playerName={player.name} />
      {run && !run.reduced && <CoinFlights stage={stage} flights={run.flights} />}
    </div>
  </section>;
}
