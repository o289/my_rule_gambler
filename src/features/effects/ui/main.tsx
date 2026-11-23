import { useAudioActivation } from '../../../shared/audio/use-audio-activation';
import { Fragment, StrictMode, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import type { EffectsRuntime } from '../application/effects-api';
import '../../board/ui/style.css';
import './style.css';
import { BoardScene } from './board-scene';
import { EFFECT_LABELS } from '../model/effect-model';
import type { EffectKind } from '../model/effect-model';
import { EffectScene, EFFECT_ICONS, outcome } from './effects';
import './board-score/score-effect.css';
import { goalColumn } from '../../board/model/board-model';

const keys: EffectKind[] = ['GEM_PLACEMENT', 'BOARD_SCORE', 'BIG_WIN', 'COMEBACK', 'JACKPOT_VICTORY', 'ONE_CELL_COMEBACK', 'TURN_CHANGE'];

function App({ runtime }: { runtime: EffectsRuntime }) {
  useAudioActivation(runtime.audio.unlock);
  const playback = useSyncExternalStore(runtime.player.subscribe, runtime.player.getSnapshot);
  const stage = useRef<HTMLDivElement>(null);
  const scenario = runtime.scenario;
  const current = playback?.request.kind;
  const [otherTurn, setOtherTurn] = useState(false);
  const [scoreMode, setScoreMode] = useState('rank-change');
  const penalty = scenario.board.rows.find(row => row.score < 0);
  const penaltyGoal = penalty && goalColumn(scenario.board, penalty);
  const status = playback ? (playback.playing ? '再生中' : '演出完了') : '準備完了';
  const subtitle = playback && !playback.playing ? outcome(playback.request, scenario)
    : current ? EFFECT_LABELS[current] : '演出を選んで再生';
  const progress: (CSSProperties & { '--play-duration': string }) | undefined = playback && { '--play-duration': `${playback.duration}ms` } || undefined;

  function playScoreEffect() {
    const gain = scenario.demo.BOARD_SCORE;
    if (penalty && penaltyGoal && (scoreMode === 'loss' || scoreMode === 'zero')) {
      runtime.actions.playSettlement({
        score: { ...gain, points: scoreMode === 'loss' ? penalty.score : 0,
          target: { rowId: penalty.id, columnId: penaltyGoal.id } },
      });
      return;
    }
    runtime.actions.playSettlement({
      score: gain,
      rankChange: scoreMode === 'rank-change' ? scenario.demo.COMEBACK : undefined,
    });
  }

  function showStage() {
    const display = stage.current;
    if (!display || !matchMedia('(max-width: 880px)').matches) return;
    const rect = display.getBoundingClientRect();
    if (rect.top < 10 || rect.bottom > innerHeight - 10) display.scrollIntoView({ block: 'start' });
  }

  function playDemo(kind: EffectKind) {
    showStage();
    if (kind === 'BOARD_SCORE') playScoreEffect();
    else runtime.playDemo(kind, { otherTurn });
  }

  return (
    <main className="effects-app">
      <header className="effects-masthead">
        <div className="effects-wordmark" aria-label="Atelier Noir">
          <svg viewBox="0 0 32 32" width="32" height="32" fill="none" aria-hidden="true">
            <path d="M16 1.5 30.5 16 16 30.5 1.5 16 16 1.5Z M16 7l9 9-9 9-9-9Z M16 11.5l4.5 4.5-4.5 4.5-4.5-4.5Z" stroke="currentColor" />
            <path d="M16 1.5v10m0 9v10M1.5 16h10m9 0h10" stroke="currentColor" />
          </svg>
          <span>ATELIER NOIR</span>
        </div>
      </header>

      <div className="effects-intro">
        <h1>ギャンブラー演出</h1>
        <p>宝石の着地から、黄金に包まれる最終勝利まで。</p>
      </div>

      <div className="effects-layout">
        <section className="stage-panel" aria-label="演出ステージ">
          <div className="effect-stage" ref={stage} data-effect={current ?? 'IDLE'} data-phase={playback?.phase ?? 'idle'}>
            <div className="stage-surface" aria-hidden="true" />
            <div className="stage-corners" aria-hidden="true"><i /><i /><i /><i /></div>
            {playback ? <EffectScene key={playback.id} playback={playback} stage={stage} scenario={scenario}
              settleRoll={id => runtime.player.settleRoll(id)} /> : <BoardScene definition={scenario.board} />}
          </div>
          <div className="stage-footer">
            {playback && <div className="progress-rail" aria-hidden="true">
              <div key={playback.id} className="progress-fill" data-running={playback.playing} style={progress} />
            </div>}
            <div className="stage-readout" role="status" aria-live="polite" aria-atomic="true">
              <span className="stage-status">{status}</span>
              <strong>{subtitle}</strong>
            </div>
            <div className="transport" aria-label="再生操作">
              <button type="button" onClick={() => { showStage(); runtime.actions.replay(); }} disabled={!playback}>リプレイ</button>
              <button type="button" onClick={runtime.actions.skip} disabled={!playback?.playing}>スキップ</button>
              <button type="button" onClick={runtime.actions.reset}>リセット</button>
            </div>
          </div>
        </section>

        <aside className="effects-controls" aria-labelledby="controls-title">
          <h2 id="controls-title">演出を再生</h2>
          <div className="effect-buttons">
            {keys.map(kind => (
              <Fragment key={kind}>
                <button type="button" data-effect-button={kind} aria-pressed={current === kind} onClick={() => playDemo(kind)}>
                  <span className="effect-icon" aria-hidden="true">{EFFECT_ICONS[kind]}</span>
                  <span>{EFFECT_LABELS[kind]}</span>
                  <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true"><path d="m4 2 5 4-5 4Z" fill="currentColor" /></svg>
                </button>
                {kind === 'TURN_CHANGE' && <label className="effect-setting">
                  表示場面
                  <select value={otherTurn ? 'other' : 'local'} onChange={event => setOtherTurn(event.currentTarget.value === 'other')}>
                    <option value="local">初回ロール前（自分）</option>
                    <option value="other">手番交代後（他の人）</option>
                  </select>
                </label>}
                {kind === 'BOARD_SCORE' && <label className="effect-setting">
                  得失点の例
                  <select value={scoreMode} onChange={event => setScoreMode(event.currentTarget.value)}>
                    <option value="rank-change">得点・順位変動あり</option>
                    <option value="gain">得点・順位変動なし</option>
                    {penaltyGoal && <>
                      <option value="loss">失点・支払いあり</option>
                      <option value="zero">失点・支払いなし</option>
                    </>}
                  </select>
                </label>}
              </Fragment>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}

export default function EffectsScreen({ runtime }: { runtime: EffectsRuntime }) {
  return <StrictMode><App runtime={runtime} /></StrictMode>;
}
