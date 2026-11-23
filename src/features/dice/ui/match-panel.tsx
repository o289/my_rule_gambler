import { useRef, useState, useMemo } from 'react';
import type { Player, PlayerSnapshot } from '../../players/model/player-data';
import type { PlayerModalHandle } from '../../players/ui/player-modal';
import type { MatchSetup } from '../../../shared/contracts/dice';
import { PlayerInfoModal } from '../../players/ui/player-modal';
import { VIPPlayersButton } from '../../players/ui/main';
import { PlayerTray } from '../../bank/ui/tray';
import { Vault } from '../../bank/ui/vault';
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

export function MatchPanel({ room, match, turnId, playerId, revision }: {
  room: string;
  match: MatchSetup | null;
  turnId: string | null;
  playerId: string | null;
  revision: number;
}) {
  const opener = useRef<HTMLButtonElement>(null);
  const modal = useRef<PlayerModalHandle>(null);
  const [open, setOpen] = useState(false);
  const players = useMemo(() => match?.players.map(toPlayer) ?? [], [match]);
  const wallets = useMemo(() => match?.players.map(player => walletCoins(room, player)) ?? [], [match, room]);
  const snapshot = useMemo<PlayerSnapshot>(() => ({
    players,
    currentTurnId: turnId ?? '',
    youId: playerId ?? '',
    turnVersion: revision,
  }), [players, turnId, playerId, revision]);

  if (!match) return null;
  return <section className="match-initial-state" aria-label="対戦の初期状態">
    <div className="match-bank">
      <div className="match-state-heading">
        <h2>銀行</h2>
        <VIPPlayersButton buttonRef={opener} open={open} onClick={() => modal.current?.open()} />
      </div>
      <div className="match-vault bank-stage" aria-label="銀行の金庫"><Vault run={null} /></div>
    </div>
    <div className="match-wallets" aria-label="プレイヤー別の金貨トレー">
      {match.players.map((player, index) => <PlayerTray key={player.id}
        snapshot={traySnapshot(wallets[index] ?? [], player.score)} playerName={player.name} />)}
    </div>
    <p className="match-dice-pool">未使用ダイス：{match.unusedDiceCount}個</p>
    <PlayerInfoModal ref={modal} snapshot={snapshot} opener={opener} onVisibilityChange={setOpen} />
  </section>;
}
