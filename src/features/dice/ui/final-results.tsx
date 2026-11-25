import type { MatchPlayerSetup } from '../../../shared/contracts/dice';

export function FinalResults({ players, winners, pending = false, connected = true, problem, onReturn }: {
  players: readonly Pick<MatchPlayerSetup, 'id' | 'name' | 'rank' | 'score' | 'slot'>[];
  winners: readonly string[];
  pending?: boolean;
  connected?: boolean;
  problem?: string;
  onReturn: (ready: boolean) => void;
}) {
  const ranking = [...players].sort((left, right) => left.rank - right.rank || left.slot - right.slot);
  const winnerNames = winners.map(id => players.find(player => player.id === id)?.name ?? id).join('、');

  return <section className="final-results-screen" aria-labelledby="final-results-title">
    <h1 id="final-results-title">最終結果</h1>
    <ol aria-label="最終順位">
      {ranking.map(player => <li key={player.id}>
        <span>{player.rank}位</span><span>{player.name}</span><strong>{player.score}点</strong>
      </li>)}
    </ol>
    <p>{winners.length > 1 ? '同率優勝' : '優勝'}：{winnerNames}</p>
    <div className="final-results-actions">
      <button type="button" className="gold-button" disabled={pending || !connected} onClick={() => onReturn(true)}>もう一度プレイする</button>
      <button type="button" className="quiet" disabled={pending || !connected} onClick={() => onReturn(false)}>部屋に戻る</button>
    </div>
    {problem ? <p className="notice" role="alert">{problem}</p>
      : pending ? <p className="turn-note" role="status">待機室へ移動しています…</p>
        : !connected && <p className="turn-note" role="status">ルームに再接続しています…</p>}
  </section>;
}
