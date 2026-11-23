import { useEffect, useRef, useState, useMemo } from 'react';
import type { Player, PlayerSnapshot } from '../../players/model/player-data';
import type { PlayerModalHandle } from '../../players/ui/player-modal';
import type { MatchSettlementEvent, MatchSetup } from '../../../shared/contracts/dice';
import { PlayerInfoModal } from '../../players/ui/player-modal';
import { VIPPlayersButton } from '../../players/ui/main';
import '../../players/ui/style.css';
import './match-panel.css';

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

export function MatchPanel({ match, turnId, playerId, turnSequence, settlement, effectsPlaying }: {
  match: MatchSetup | null;
  turnId: string | null;
  playerId: string | null;
  turnSequence: number;
  settlement?: MatchSettlementEvent;
  effectsPlaying: boolean;
}) {
  const opener = useRef<HTMLButtonElement>(null);
  const modal = useRef<PlayerModalHandle>(null);
  const [open, setOpen] = useState(false);
  const players = useMemo(() => match?.players.map(toPlayer) ?? [], [match]);
  const snapshot = useMemo<PlayerSnapshot>(() => ({
    players,
    currentTurnId: turnId ?? '',
    youId: playerId ?? '',
    turnVersion: turnSequence,
  }), [players, turnId, playerId, turnSequence]);
  useEffect(() => { if (effectsPlaying) modal.current?.close(); }, [effectsPlaying]);

  if (!match) return null;
  return <section className="match-status-panel" aria-label="対戦状態">
    <p className="match-round-number">ラウンド {settlement?.roundNumber ?? match.roundNumber}</p>
    <p className="match-dice-pool">未使用ダイス：{match.unusedDiceCount}個</p>
    <VIPPlayersButton buttonRef={opener} open={open} disabled={effectsPlaying} onClick={() => modal.current?.open()} />
    <PlayerInfoModal ref={modal} snapshot={snapshot} opener={opener} onVisibilityChange={setOpen} />
  </section>;
}
