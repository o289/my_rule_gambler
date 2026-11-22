import type { Player, PlayerSnapshot } from '../model/player-data';
import { CrownIcon, ChevronIcon, DiceIcon } from './vip-icons';
import crest from '../../../shared/assets/effects/victory-crest.webp';
import filigree from '../../../shared/assets/effects/title-filigree.webp';
import coinFifty from '../../../shared/assets/bank/coin-50.webp';
import coinTen from '../../../shared/assets/bank/coin-10.webp';
import coinReverse from '../../../shared/assets/bank/coin-back.webp';

function PlayerLabels({ current, you, detail = false }: { current: boolean; you: boolean; detail?: boolean }) {
  return (
    <span className="player-labels">
      {you && <span className="you-badge" lang="en">YOU</span>}
      {current && <span className="current-turn" lang="en"><CrownIcon />CURRENT TURN</span>}
      {detail && !current && <span className="waiting-turn">手番待ち</span>}
    </span>
  );
}

export function CurrentTurnHighlight() {
  return <span className="turn-highlight" aria-hidden="true"><i /></span>;
}

interface PlayerListItemProps {
  player: Player;
  current: boolean;
  you: boolean;
  turnVersion: number;
  onSelect: (id: string, element: HTMLButtonElement) => void;
}

export function PlayerListItem({ player, current, you, turnVersion, onSelect }: PlayerListItemProps) {
  const label = `${player.name}、${player.score}点、残りのサイコロ${player.remainingDice}個${you ? '、自分' : ''}${current ? '、現在の手番' : ''}、詳細を表示`;
  return (
    <li>
      <button type="button" className="vip-list-card" data-player-id={player.id} data-current={current}
        data-you={you} aria-label={label} onClick={event => onSelect(player.id, event.currentTarget)}>
        {current && <CurrentTurnHighlight key={turnVersion} />}
        <span className="player-cell">
          <span className="player-name">{player.name}</span>
          <PlayerLabels current={current} you={you} />
        </span>
        <span className="player-score">{player.score.toLocaleString('ja-JP')}<small>PT</small></span>
        <span className="player-dice"><DiceIcon />{player.remainingDice}</span>
        <ChevronIcon />
      </button>
    </li>
  );
}

export function PlayerList({ snapshot, onSelect }: { snapshot: PlayerSnapshot; onSelect: PlayerListItemProps['onSelect'] }) {
  return (
    <ul className="vip-list" aria-label="プレイヤー一覧・手番順">
      {snapshot.players.map(player => (
        <PlayerListItem key={player.id} player={player}
          current={snapshot.currentTurnId === player.id} you={snapshot.youId === player.id}
          turnVersion={snapshot.turnVersion} onSelect={onSelect} />
      ))}
    </ul>
  );
}

export function PlayerCoinWallet({ player }: { player: Player }) {
  return (
    <section className="member-wallet" aria-label="所持コイン">
      <h4>所持コイン</h4>
      <div className="member-coin-groups">
        {player.coins.map(({ denomination, count }) => (
          <div key={denomination} className="member-coin-group">
            <div className="coin-portrait" aria-hidden="true">
              {count > 1 && <img className="coin-portrait-back" src={coinReverse} alt="" />}
              <img src={denomination >= 50 ? coinFifty : coinTen} alt="" />
              <span>{denomination}</span>
            </div>
            <div className="coin-count">
              <span>{denomination}点コイン</span><strong>× {count}<small>枚</small></strong>
            </div>
          </div>
        ))}
      </div>
      <div className="wallet-total"><span>合計</span><strong>{player.score.toLocaleString('ja-JP')}<small> 点</small></strong></div>
    </section>
  );
}

interface DetailProps {
  player: Player;
  rank: number | undefined;
  current: boolean;
  turnVersion: number;
  you: boolean;
}

export function PlayerDetail({ player, rank, current, turnVersion, you }: DetailProps) {
  return (
    <article className="vip-member-card" data-player-detail={player.id} data-current={current} aria-labelledby="member-name">
      {current && <CurrentTurnHighlight key={turnVersion} />}
      <img className="member-filigree" src={filigree} alt="" />
      <div className="member-hero">
        <img className="member-crest" src={crest} alt="" />
        <div className="member-identity">
          <h3 id="member-name">{player.name}</h3>
          <PlayerLabels current={current} you={you} detail />
        </div>
        <div className="member-score" aria-label={`得点 ${player.score}点`}>
          <span className="member-score-number">{player.score.toLocaleString('ja-JP')}</span><small>PT</small>
        </div>
      </div>
      <dl className="member-stats">
        <div><dt>現在の順位</dt><dd>{rank ?? '—'}<small>位</small></dd></div>
        <div><dt>残りのサイコロ</dt><dd><DiceIcon />{player.remainingDice}<small>個</small></dd></div>
      </dl>
      <p className="rank-note">同点は同順位（例：1位、1位、3位）</p>
      <PlayerCoinWallet player={player} />
    </article>
  );
}
