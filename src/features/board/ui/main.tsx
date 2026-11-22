import { StrictMode, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import { GamblerBoard } from './GamblerBoard';
import { cellKey, formatScore, initialState, updateBoard } from '../model/board-model';
import type { BoardAction, BoardDefinition } from '../model/board-model';
import { REDUCED_SCORE_MS, scoreTimings } from '../../effects/ui/board-score/board-motion';
import { GEMS, GEM_IDS } from '../model/gems';
import './style.css';
import '../../effects/ui/board-score/score-effect.css';

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const NARROW_QUERY = '(max-width: 920px)';

function subscribeToReducedMotion(update: () => void) {
  const media = matchMedia(MOTION_QUERY);
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}

function getReducedMotion() {
  return matchMedia(MOTION_QUERY).matches;
}

function ScoreEditor({ score, disabled, onSubmit }: { score: number; disabled: boolean; onSubmit: (score: number) => void }) {
  const [draft, setDraft] = useState(String(score));
  const [invalid, setInvalid] = useState(false);

  function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = draft.trim().replace(/^−/, '-');
    const number = Number(normalized);
    if (!/^[+-]?\d+$/.test(normalized) || !Number.isSafeInteger(number)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(String(number));
    onSubmit(number);
  }

  return (
    <form className="score-editor" onSubmit={update}>
      <label htmlFor="row-score">行の得点</label>
      <div className="score-editor-fields">
        <input id="row-score" type="text" value={draft} disabled={disabled} onChange={event => { setDraft(event.target.value); setInvalid(false); }} autoComplete="off" aria-invalid={invalid || undefined} aria-describedby={invalid ? 'score-error' : undefined} />
        <button className="quiet-button" type="submit" disabled={disabled}>更新</button>
      </div>
      {invalid && <p id="score-error" role="alert">得点は整数で入力してください。</p>}
    </form>
  );
}

function App({ board }: { board: BoardDefinition }) {
  const [state, dispatch] = useReducer((current: ReturnType<typeof initialState>, action: BoardAction) => updateBoard(board, current, action), board, initialState);
  const reducedMotion = useSyncExternalStore(subscribeToReducedMotion, getReducedMotion);
  const boardArea = useRef<HTMLElement>(null);
  const selection = state.selection;
  const column = board.columns.find(column => column.id === selection?.columnId);
  const rowScore = selection ? state.scores.get(selection.rowId) : undefined;
  const selectedGem = selection ? state.occupied.get(cellKey(selection)) : undefined;
  const award = state.award;
  const awardDuration = scoreTimings(board.columns.length).total;

  useEffect(() => {
    if (!award) return;
    const timeout = window.setTimeout(() => {
      dispatch({ type: 'finish-award', id: award.id });
    }, reducedMotion ? REDUCED_SCORE_MS : awardDuration);
    return () => window.clearTimeout(timeout);
  }, [award, awardDuration, reducedMotion]);

  function revealTarget(selector: string) {
    if (!matchMedia(NARROW_QUERY).matches) return;
    const element = boardArea.current?.querySelector(selector);
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    if (bounds.top < 12 || bounds.bottom > innerHeight - 12 || bounds.left < 0 || bounds.right > innerWidth) {
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }

  function place() {
    revealTarget('.board-cell[aria-pressed="true"]');
    dispatch({ type: 'place' });
  }

  function reset() {
    boardArea.current?.querySelector('.board-scroll')?.scrollTo({ left: 0 });
    dispatch({ type: 'reset' });
  }

  function runAward() {
    revealTarget('.score-plate[data-selected="true"]');
    dispatch({ type: 'award' });
  }

  return (
    <main className="salon">
      <header className="masthead">
        <div className="wordmark" aria-label="Atelier Noir">
          <svg viewBox="0 0 32 32" width="32" height="32" fill="none" aria-hidden="true">
            <path d="M16 1.5 30.5 16 16 30.5 1.5 16 16 1.5Z M16 7l9 9-9 9-9-9Z M16 11.5l4.5 4.5-4.5 4.5-4.5-4.5Z" stroke="currentColor" />
            <path d="M16 1.5v10m0 9v10M1.5 16h10m9 0h10" stroke="currentColor" />
          </svg>
          <span>ATELIER NOIR</span>
        </div>
      </header>
      <div className="page-title">
        <h1>ギャンブラーボード</h1>
        <p>マスを選び、宝石を配置して得点演出を試せます。</p>
      </div>
      <div className="table-layout">
        <GamblerBoard board={board} state={state} viewportRef={boardArea} onSelect={cell => dispatch({ type: 'select-cell', cell })} />
        <aside className="controls" aria-labelledby="controls-title">
          <div className="controls-heading">
            <h2 id="controls-title">ボード操作</h2>
            <button className="text-button" type="button" onClick={reset}>リセット</button>
          </div>
          <div className="selection-card" aria-live="polite" aria-atomic="true">
            <span className="small-label">選択中のマス</span>
            <strong>{rowScore !== undefined && column ? `${formatScore(rowScore)}点の行 · ${GEMS[column.gem].name}列` : 'マスを選択してください'}</strong>
            {selection && <span className="selection-state">{selectedGem ? `${GEMS[selectedGem].name}を配置済み` : '配置可能'}</span>}
          </div>
          <fieldset className="gem-field">
            <legend>配置する宝石</legend>
            <div className="gem-options">
              {GEM_IDS.map(id => (
                <label key={id}>
                  <input type="radio" name="placement-gem" value={id} checked={id === state.gem} onChange={() => dispatch({ type: 'select-gem', gem: id })} />
                  <span className="gem-option">
                    <img src={GEMS[id].image} alt="" draggable={false} />
                    <span>{GEMS[id].name}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="cell-actions">
            <button type="button" className="primary-button" onClick={place} disabled={!selection || Boolean(selectedGem)}>宝石を配置</button>
            <button type="button" className="quiet-button" onClick={() => dispatch({ type: 'remove' })} disabled={!selectedGem}>取り除く</button>
          </div>
          <section className="score-controls" aria-label="得点の設定と演出">
            {selection && rowScore !== undefined && (
              <ScoreEditor key={JSON.stringify([state.resetId, selection.rowId])} score={rowScore} disabled={Boolean(award)} onSubmit={score => dispatch({ type: 'change-score', rowId: selection.rowId, score })} />
            )}
            <button type="button" className="award-button" onClick={runAward} disabled={!selection || Boolean(award)}>
              <span aria-hidden="true">✦</span> {award ? '演出中…' : '得点演出を再生'}
            </button>
            <div className="score-result" role="status" aria-live="polite" aria-atomic="true">
              <span>演出結果</span>
              <strong data-negative={Boolean(state.result && state.result.amount < 0)}>{state.result ? `${formatScore(state.result.amount)}点` : '—'}</strong>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

export default function BoardPreview({ board }: { board: BoardDefinition }) {
  return <StrictMode><App board={board} /></StrictMode>;
}
