import { StrictMode, useReducer, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { GamblerBoard } from './GamblerBoard';
import { cellKey, formatScore, initialState, updateBoard } from '../model/board-model';
import type { BoardAction, BoardDefinition } from '../model/board-model';
import { GEMS, GEM_IDS } from '../model/gems';
import './style.css';

const NARROW_QUERY = '(max-width: 920px)';

function ScoreEditor({ score, onSubmit }: { score: number; onSubmit: (score: number) => void }) {
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
        <input id="row-score" type="text" value={draft} onChange={event => { setDraft(event.target.value); setInvalid(false); }} autoComplete="off" aria-invalid={invalid || undefined} aria-describedby={invalid ? 'score-error' : undefined} />
        <button className="quiet-button" type="submit">更新</button>
      </div>
      {invalid && <p id="score-error" role="alert">得点は整数で入力してください。</p>}
    </form>
  );
}

function App({ board }: { board: BoardDefinition }) {
  const [state, dispatch] = useReducer((current: ReturnType<typeof initialState>, action: BoardAction) => updateBoard(board, current, action), board, initialState);
  const boardArea = useRef<HTMLElement>(null);
  const selection = state.selection;
  const column = board.columns.find(column => column.id === selection?.columnId);
  const rowScore = selection ? state.scores.get(selection.rowId) : undefined;
  const selectedGem = selection ? state.occupied.get(cellKey(selection)) : undefined;

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
        <p>マスを選び、行の得点を編集して宝石を配置できます。</p>
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
          <section className="score-controls" aria-label="行の得点設定">
            {selection && rowScore !== undefined && (
              <ScoreEditor key={JSON.stringify([state.resetId, selection.rowId])} score={rowScore} onSubmit={score => dispatch({ type: 'change-score', rowId: selection.rowId, score })} />
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

export default function BoardPreview({ board }: { board: BoardDefinition }) {
  return <StrictMode><App board={board} /></StrictMode>;
}
