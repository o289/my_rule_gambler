import { useRef, useState, useMemo } from 'react';
import type { Player, PlayerSnapshot } from '../../players/model/player-data';
import type { PlayerModalHandle } from '../../players/ui/player-modal';
import type { MatchSettlementEvent, MatchSetup } from '../../../shared/contracts/dice';
import { PlayerInfoModal } from '../../players/ui/player-modal';
import { VIPPlayersButton } from '../../players/ui/main';
import { PlayerTray } from '../../bank/ui/tray';
import { Vault } from '../../bank/ui/vault';
import { CoinFlights } from '../../bank/ui/coin-flight';
import { settlementCoinMoves } from '../../bank/model/settlement-coins';
import type { Flight } from '../../bank/application/bank-player';
import { CurrentTurnHighlight } from '../../players/ui/turn-highlight';
import type { BankSnapshot } from '../../bank/application/bank-player';
import type { Coin } from '../../bank/model/bank-model';
import '../../players/ui/style.css';
import '../../bank/ui/style.css';
import './match-panel.css';

function walletCoins(room: string, player: MatchSetup['players'][number]): Coin[] {
  return player.wallet.flatMap(group => Array.from({ length: group.count }, (_, index) => ({
    id: `${room}-${player.id}-${group.denomination}-${index + 1}`,
    value: group.denomination,
  })));
}

function toPlayer(player: MatchSetup['players'][number]): Player {
  return {
    id: player.id,
    name: player.name,
    turnOrder: player.slot,
    remainingDice: player.diceCount,
    coins: player.wallet,
    score: player.score,
  };
}

function traySnapshot(wallet: readonly Coin[], balance: number): Pick<BankSnapshot, 'mode' | 'balance' | 'wallet' | 'run' | 'compression'> {
  return { mode: 'withdraw', balance, wallet, run: null, compression: null };
}

export function MatchPanel({ room, match, turnId, playerId, turnSequence, settlement, coinActive = false, coinStartedAt = 0 }: {
  room: string;
  match: MatchSetup | null;
  turnId: string | null;
  playerId: string | null;
  turnSequence: number;
  settlement?: MatchSettlementEvent;
  coinActive?: boolean;
  coinStartedAt?: number;
}) {
  const opener = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const modal = useRef<PlayerModalHandle>(null);
  const [open, setOpen] = useState(false);
  const players = useMemo(() => match?.players.map(toPlayer) ?? [], [match]);
  const wallets = useMemo(() => match?.players.map(player => walletCoins(room, player)) ?? [], [match, room]);
  const settledPlayer = match?.players.find(player => player.id === settlement?.playerId);
  const prefix = settlement ? `${room}-${settlement.boardSeed}-${settlement.revision}-${settlement.playerId}` : '';
  const moves = useMemo(() => settlement ? settlementCoinMoves(prefix, settlement.points) : null, [prefix, settlement]);
  const flights = useMemo(() => {
    const values = new Map<string, Flight>();
    if (!moves || !settlement || !coinActive) return values;
    moves.outgoing.forEach((coin, index) => values.set(coin.id, { coin, index, startedAt: coinStartedAt, direction: 'withdraw' }));
    moves.incoming.forEach((coin, index) => values.set(coin.id, { coin, index: moves.outgoing.length + index, startedAt: coinStartedAt, direction: 'deposit' }));
    return values;
  }, [moves, settlement, coinActive, coinStartedAt]);
  const snapshot = useMemo<PlayerSnapshot>(() => ({
    players,
    currentTurnId: turnId ?? '',
    youId: playerId ?? '',
    turnVersion: turnSequence,
  }), [players, turnId, playerId, turnSequence]);

  if (!match) return null;
  const movingCoins = coinActive && Boolean(moves?.outgoing.length || moves?.incoming.length);
  const incomingTargets = settledPlayer && moves && coinActive ? moves.incoming : [];
  const outgoingSources = settledPlayer && moves && coinActive ? moves.outgoing : [];
  return <section ref={stage} className="match-initial-state" aria-label="対戦の初期状態">
    {movingCoins && <CoinFlights stage={stage} flights={flights} />}
    {!settlement && match.result && <p className="match-result" role="status">
      {match.result.status === 'won'
        ? `${match.result.winners.length > 1 ? '同率優勝' : '勝者'}：${match.result.winners.map(id => match.players.find(player => player.id === id)?.name ?? id).join('、')}（${match.result.highestScore}点）`
        : `盤面完成・最高${match.result.highestScore}点`}
    </p>}
    <div className="match-bank">
      <div className="match-state-heading">
        <h2>銀行</h2>
        <VIPPlayersButton buttonRef={opener} open={open} onClick={() => modal.current?.open()} />
      </div>
      <div className="match-vault bank-stage" aria-label="銀行の金庫"><Vault run={null} moving={movingCoins} /></div>
    </div>
    <div className="match-wallets" aria-label="プレイヤー別の金貨トレー">
      {match.players.map((player, index) => <div key={player.id} className="match-wallet-player">
        {player.id === turnId && <CurrentTurnHighlight key={turnSequence} once />}
        <PlayerTray snapshot={traySnapshot(wallets[index] ?? [], player.score)} playerName={player.name}
          flightSources={settledPlayer?.id === player.id ? outgoingSources : []}
          flightTargets={settledPlayer?.id === player.id ? incomingTargets : []} />
      </div>)}
    </div>
    <p className="match-dice-pool">未使用ダイス：{match.unusedDiceCount}個</p>
    <PlayerInfoModal ref={modal} snapshot={snapshot} opener={opener} onVisibilityChange={setOpen} />
  </section>;
}
