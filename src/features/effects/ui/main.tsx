import { StrictMode, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import '../../board/ui/style.css';
import './style.css';
import { BoardScene } from './board-scene';
import { EFFECT_LABELS } from '../model/effect-model';
import type { EffectKind } from '../model/effect-model';
import { EffectScene, EFFECT_ICONS, outcome } from './effects';
import { effectActions as api, playDemo, player, sound } from '../application/effects-api';

const keys: EffectKind[] = ['DICE_STOP', 'GEM_PLACEMENT', 'BIG_WIN', 'COMEBACK', 'JACKPOT_VICTORY'];

declare global {
  interface Window { gamblerEffects: typeof api; }
}
window.gamblerEffects = Object.freeze(api);

function App() {
  const playback = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const stage = useRef<HTMLDivElement>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [audioPending, setAudioPending] = useState(false);
  const [volume, setVolume] = useState(62);
  const [audioError, setAudioError] = useState('');
  const current = playback?.request.kind;
  const status = playback ? (playback.playing ? '再生中' : '演出完了') : '準備完了';
  const subtitle = playback && !playback.playing ? outcome(playback.request) : (current ? EFFECT_LABELS[current] : '演出を選んで再生');
  const progress: (CSSProperties & { '--play-duration': string }) | undefined = playback && { '--play-duration': `${playback.duration}ms` } || undefined;

  function showStage() {
    const display = stage.current;
    if (!display || !matchMedia('(max-width: 880px)').matches) return;
    const rect = display.getBoundingClientRect();
    if (rect.top < 10 || rect.bottom > innerHeight - 10) display.scrollIntoView({ block: 'start' });
  }

  async function toggleAudio() {
    if (audioPending) return;
    setAudioPending(true);
    setAudioError('');
    try {
      const active = await sound.enable(!audioOn);
      setAudioOn(active);
      if (!active && !audioOn) setAudioError('効果音を再生できませんでした。');
    } catch {
      setAudioError('効果音を再生できませんでした。');
    } finally {
      setAudioPending(false);
    }
  }

  function changeVolume(newVolume: number) {
    setVolume(newVolume);
    sound.setVolume(newVolume / 100);
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
            {playback ? <EffectScene key={playback.id} playback={playback} stage={stage} /> : <BoardScene />}
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
              <button type="button" onClick={() => { showStage(); api.replay(); }} disabled={!playback}>リプレイ</button>
              <button type="button" onClick={api.skip} disabled={!playback?.playing}>スキップ</button>
              <button type="button" onClick={api.reset}>リセット</button>
            </div>
          </div>
        </section>

        <aside className="effects-controls" aria-labelledby="controls-title">
          <h2 id="controls-title">演出を再生</h2>
          <div className="effect-buttons">
            {keys.map(kind => (
              <button key={kind} type="button" data-effect-button={kind} aria-pressed={current === kind} onClick={() => { showStage(); playDemo(kind); }}>
                <span className="effect-icon" aria-hidden="true">{EFFECT_ICONS[kind]}</span>
                <span>{EFFECT_LABELS[kind]}</span>
                <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true"><path d="m4 2 5 4-5 4Z" fill="currentColor" /></svg>
              </button>
            ))}
          </div>
          <div className="sound-panel">
            <div className="sound-header">
              <h2>効果音</h2>
              <button type="button" className="audio-toggle" aria-label="効果音" aria-pressed={audioOn} disabled={audioPending} onClick={toggleAudio}>{audioOn ? 'ON' : 'OFF'}</button>
            </div>
            <label className="volume-label" htmlFor="volume">音量 <output>{volume}%</output></label>
            <input id="volume" type="range" min="0" max="100" step="1" value={volume} onChange={event => changeVolume(event.currentTarget.valueAsNumber)} />
            {audioError && <p className="audio-error" role="alert">{audioError}</p>}
          </div>
        </aside>
      </div>
    </main>
  );
}

export default function EffectsPreview() {
  return <StrictMode><App /></StrictMode>;
}
