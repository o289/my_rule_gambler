import { useAudioActivation } from '../../../shared/audio/use-audio-activation';
import { StrictMode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import type { EffectsRuntime } from '../application/effects-api';
import '../../board/ui/style.css';
import './style.css';
import { BoardScene } from './board-scene';
import { EFFECT_LABELS } from '../model/effect-model';
import type { EffectKind } from '../model/effect-model';
import { EffectScene, EFFECT_ICONS, outcome } from './effects';
import { REDUCED_SCORE_MS, scoreTimings } from './board-score/board-motion';
import './board-score/score-effect.css';
import { playableColumns } from '../../board/model/board-model';
import type { BoardAward } from '../../board/model/board-model';

const keys: EffectKind[] = ['DICE_STOP', 'GEM_PLACEMENT', 'BIG_WIN', 'COMEBACK', 'JACKPOT_VICTORY', 'ONE_CELL_COMEBACK', 'REROLL_THROW'];

function App({ runtime }: { runtime: EffectsRuntime }) {
  useAudioActivation(runtime.audio.unlock);
  const playback = useSyncExternalStore(runtime.player.subscribe, runtime.player.getSnapshot);
  const stage = useRef<HTMLDivElement>(null);
  const scenario = runtime.scenario;
  const current = playback?.request.kind;
  const [reroll, setReroll] = useState<'available' | 'blocked'>('available');
  const [scoreAward, setScoreAward] = useState<BoardAward | null>(null);
  const [scoreResult, setScoreResult] = useState<BoardAward | null>(null);
  const [scoreReduced, setScoreReduced] = useState(false);
  const scoreSequence = useRef(0);
  const scoreRow = scenario.board.rows[0];
  const scoreLength = scoreRow ? playableColumns(scenario.board, scoreRow).length : 0;
  const reducedMotion = useSyncExternalStore(
    listener => {
      const media = matchMedia('(prefers-reduced-motion: reduce)');
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    },
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const status = playback ? (playback.playing ? '再生中' : '演出完了') : scoreAward ? '得点演出中' : scoreResult ? '得点演出完了' : '準備完了';
  const subtitle = playback && !playback.playing ? outcome(playback.request, scenario)
    : scoreAward ? `${scoreAward.amount > 0 ? '+' : ''}${scoreAward.amount}点`
      : scoreResult ? `${scoreResult.amount > 0 ? '+' : ''}${scoreResult.amount}点`
        : (current ? EFFECT_LABELS[current] : '演出を選んで再生');
  const progress: (CSSProperties & { '--play-duration': string }) | undefined = playback && { '--play-duration': `${playback.duration}ms` } || undefined;

  useEffect(() => {
    if (!scoreAward) return;
    const duration = scoreReduced ? REDUCED_SCORE_MS : scoreTimings(scoreLength).total;
    const timer = window.setTimeout(() => {
      setScoreResult(scoreAward);
      setScoreAward(null);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [scoreAward, scoreReduced, scoreLength]);

  function playScoreEffect() {
    if (!scoreRow || scoreAward) return;
    runtime.actions.reset();
    const award = { id: ++scoreSequence.current, rowId: scoreRow.id, amount: scoreRow.score };
    setScoreResult(null);
    setScoreReduced(reducedMotion);
    setScoreAward(award);
    showStage();
  }

  function showStage() {
    const display = stage.current;
    if (!display || !matchMedia('(max-width: 880px)').matches) return;
    const rect = display.getBoundingClientRect();
    if (rect.top < 10 || rect.bottom > innerHeight - 10) display.scrollIntoView({ block: 'start' });
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
              settleRoll={id => runtime.player.settleRoll(id)} /> : <BoardScene definition={scenario.board} award={scoreAward} />}
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
              <button type="button" onClick={() => { setScoreAward(null); setScoreResult(null); runtime.actions.reset(); }}>リセット</button>
            </div>
          </div>
        </section>

        <aside className="effects-controls" aria-labelledby="controls-title">
          <h2 id="controls-title">演出を再生</h2>
          <div className="effect-buttons">
            {keys.map(kind => (
              <button key={kind} type="button" data-effect-button={kind} aria-pressed={current === kind} onClick={() => { setScoreAward(null); setScoreResult(null); showStage(); runtime.playDemo(kind, reroll); }}>
                <span className="effect-icon" aria-hidden="true">{EFFECT_ICONS[kind]}</span>
                <span>{EFFECT_LABELS[kind]}{kind === 'REROLL_THROW' && <small>続ける</small>}</span>
                <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true"><path d="m4 2 5 4-5 4Z" fill="currentColor" /></svg>
              </button>
            ))}
            <button type="button" data-effect-button="BOARD_SCORE" aria-pressed={Boolean(scoreAward)} disabled={!scoreRow || Boolean(scoreAward)} onClick={playScoreEffect}>
              <span className="effect-icon" aria-hidden="true">✦</span>
              <span>得点演出{scoreRow ? `（${scoreRow.score > 0 ? '+' : ''}${scoreRow.score}点）` : ''}</span>
              <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true"><path d="m4 2 5 4-5 4Z" fill="currentColor" /></svg>
            </button>
            <div className="score-result" role="status" aria-live="polite" aria-atomic="true">
              <span>得点演出の結果</span>
              <strong data-negative={Boolean(scoreResult && scoreResult.amount < 0)}>{scoreResult ? `${scoreResult.amount > 0 ? '+' : ''}${scoreResult.amount}点` : '—'}</strong>
            </div>
          </div>
          <label htmlFor="reroll-scenario" className="reroll-setting">
            振り直しの結果
            <select id="reroll-scenario" value={reroll} onChange={event => setReroll(event.currentTarget.value === 'blocked' ? 'blocked' : 'available')}>
              <option value="available">配置先あり</option>
              <option value="blocked">配置先なし</option>
            </select>
          </label>
        </aside>
      </div>
    </main>
  );
}

export default function EffectsScreen({ runtime }: { runtime: EffectsRuntime }) {
  return <StrictMode><App runtime={runtime} /></StrictMode>;
}
