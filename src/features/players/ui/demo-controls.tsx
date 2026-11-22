import { useEffect, useRef, useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS, SCORE_GAIN, SCORE_LOSS } from '../model/player-data';
import type { PlayerInfoStore, PlayerSnapshot } from '../model/player-data';

interface Props {
  store: PlayerInfoStore;
  snapshot: PlayerSnapshot;
  onReset: () => void;
}

export function PlayerInfoDemoControls({ store, snapshot, onReset }: Props) {
  const { players, youId } = snapshot;
  const [target, setTarget] = useState('');
  const [queued, setQueued] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const selectedTarget = players.some(player => player.id === target) ? target : players[0]?.id ?? '';

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function stopQueued() {
    if (timer.current === undefined) return;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setQueued(false);
  }

  function queueTurn() {
    stopQueued();
    setQueued(true);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setQueued(false);
      store.advanceTurn();
    }, 3000);
  }

  function reset() {
    stopQueued();
    setTarget('');
    onReset();
  }

  return (
    <details className="vip-demo-controls">
      <summary>テスト操作</summary>
      <div className="vip-demo-fields">
        <label className="demo-select">プレイヤー人数
          <select id="player-count" value={players.length} onChange={event => store.setCount(Number(event.currentTarget.value))}>
            {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, index) => MIN_PLAYERS + index).map(value => <option key={value} value={value}>{value}人</option>)}
          </select>
        </label>
        <label className="demo-select">自分のプレイヤー
          <select id="you-player" value={youId} onChange={event => store.setYou(event.currentTarget.value)}>
            {players.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}
          </select>
        </label>
        <label className="demo-select">得点操作の対象
          <select id="score-player" value={selectedTarget} onChange={event => setTarget(event.currentTarget.value)}>
            {players.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}
          </select>
        </label>
        <fieldset className="demo-actions">
          <legend>手番の切り替え</legend>
          <button type="button" id="next-turn" onClick={() => { stopQueued(); store.advanceTurn(); }}>次の手番へ</button>
          <button type="button" id="queue-turn" onClick={queueTurn}>{queued ? '手番切替を予約済み' : '3秒後に次の手番へ'}</button>
        </fieldset>
        <fieldset className="demo-actions">
          <legend>得点を変更</legend>
          <button type="button" id="score-up" onClick={() => store.adjustScore(selectedTarget, SCORE_GAIN)}>+100 PT</button>
          <button type="button" id="score-down" onClick={() => store.adjustScore(selectedTarget, SCORE_LOSS)}>−50 PT</button>
        </fieldset>
        <fieldset className="demo-actions">
          <legend>通知を試す</legend>
          <button type="button" id="preview-gain" onClick={() => store.previewScore(selectedTarget, SCORE_GAIN)}>+100 の通知</button>
          <button type="button" id="preview-loss" onClick={() => store.previewScore(selectedTarget, SCORE_LOSS)}>−50 の通知</button>
        </fieldset>
        <button type="button" className="demo-reset" id="reset-players" onClick={reset}>初期状態へリセット</button>
      </div>
    </details>
  );
}
