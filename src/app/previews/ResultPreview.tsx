import { useState } from 'react';
import { VipLobby } from '../../features/casino-entry/ui/casino-flow';
import type { ConnectionView } from '../../features/casino-entry/ui/connection';
import { FinalResults } from '../../features/dice/ui/final-results';
import '../../features/dice/ui/style.css';

const room = { id: '00000000', name: 'プレビュー卓' };
const players = [
  { id: 'player-one', slot: 0, name: 'PLAYER 1', rank: 1, score: 510 },
  { id: 'player-two', slot: 1, name: 'PLAYER 2', rank: 2, score: 350 },
];
const playerId = 'player-one';

export default function ResultPreview() {
  const [ready, setReady] = useState<boolean | null>(null);
  if (ready !== null) {
    const info: ConnectionView = {
      status: 'online', playerId, room, problem: '', clockOffset: 0,
      lobby: {
        phase: 'waiting', startedPlayers: null, hostId: playerId, startAt: null, serverTime: 0,
        seats: players.map(({ id, name, slot }) => ({ id, name, slot, online: true, ready: id === playerId && ready })),
      },
    };
    return <div className="casino-flow">
      <VipLobby info={info} room={room} setReady={setReady} leave={() => setReady(null)} blocked={false} deadline={null} enteringGame={false} />
    </div>;
  }
  return <main className="dice-salon">
    <header className="salon-header">
      <div className="salon-mark"><span aria-hidden="true">◇</span>ATELIER NOIR</div>
      <span className="room-chip">{room.id}</span>
    </header>
    <FinalResults players={players} winners={[playerId]} onReturn={setReady} />
  </main>;
}
