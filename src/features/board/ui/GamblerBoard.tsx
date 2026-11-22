import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';
import type { BoardDefinition, BoardState, CellAddress } from '../model/board-model';
import { cellKey, formatScore } from '../model/board-model';
import { SCORE_BEAM_MS, SCORE_PLATE_MS, SCORE_STAGGER_MS, scoreTimings } from './board-motion';
import { GEMS } from '../model/gems';
import type { GemId } from '../model/gems';

type CellState = 'empty' | 'available' | 'occupied' | 'blocked';

interface BoardCellProps {
  address: CellAddress;
  label: string;
  state: CellState;
  selected: boolean;
  gem?: GemId;
  placementId?: number;
  awardId?: number;
  scoreDelay: number;
  onSelect: (cell: CellAddress) => void;
}

export function BoardCell({ address, label, state, selected, gem, placementId, awardId, scoreDelay, onSelect }: BoardCellProps) {
  const blocked = state === 'blocked';
  return (
    <div className="grid-cell" role="cell">
      <button
        type="button"
        className="board-cell"
        data-state={state}
        data-awarded={awardId !== undefined || undefined}
        data-row={address.rowId}
        data-column={address.columnId}
        aria-label={label}
        aria-pressed={selected}
        aria-disabled={blocked || undefined}
        onClick={() => { if (!blocked) onSelect(address); }}
      >
        {placementId !== undefined && <span key={`flash-${placementId}`} className="placement-flash" aria-hidden="true" />}
        {gem && <img key={`gem-${placementId ?? gem}`} className={placementId === undefined ? 'cell-gem' : 'cell-gem cell-gem--placed'} src={GEMS[gem].image} alt="" draggable={false} />}
        {blocked && <span className="blocked-mark" aria-hidden="true">×</span>}
        {awardId !== undefined && <span key={awardId} className="score-flash" aria-hidden="true" style={{ animationDelay: `${scoreDelay}ms` }} />}
      </button>
    </div>
  );
}

interface BoardProps {
  board: BoardDefinition;
  state: BoardState;
  viewportRef: Ref<HTMLElement>;
  onSelect: (cell: CellAddress) => void;
}

type BoardStyle = CSSProperties & {
  '--columns': number;
  '--beam-delay': string;
  '--plate-delay': string;
  '--beam-duration': string;
  '--plate-duration': string;
};

type GemStyle = CSSProperties & { '--gem-color': string };
type ScoreStyle = CSSProperties & { '--score-length': number };

function formatShortState(state: CellState, gem?: GemId) {
  if (state === 'blocked') return '配置不可';
  if (gem) return `${GEMS[gem].name}を配置済み`;
  return state === 'available' ? '配置可能' : '未配置';
}

export function GamblerBoard({ board, state, viewportRef, onSelect }: BoardProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const cabinet = useRef<HTMLDivElement>(null);
  const [isOverflowing, setOverflowing] = useState(false);
  const { beamDelay, plateDelay } = scoreTimings(board.columns.length);
  const style: BoardStyle = {
    '--columns': board.columns.length,
    '--beam-delay': `${beamDelay}ms`,
    '--plate-delay': `${plateDelay}ms`,
    '--beam-duration': `${SCORE_BEAM_MS}ms`,
    '--plate-duration': `${SCORE_PLATE_MS}ms`,
  };

  useEffect(() => {
    const viewport = scroller.current;
    const frame = cabinet.current;
    if (!viewport || !frame) return;
    const update = () => setOverflowing(viewport.scrollWidth > viewport.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="board-area" aria-label="ボード" ref={viewportRef}>
      <div className="board-scroll" ref={scroller} tabIndex={isOverflowing ? 0 : undefined} role="region" aria-label="ギャンブラーボード">
        <div className="board-cabinet" ref={cabinet} style={style}>
          <div className="board-stone" aria-hidden="true" />
          <div className="board-rim" aria-hidden="true" />
          <div className="board-grid" role="table" aria-label="得点と配置マス">
            <div className="board-row heading-row" role="row">
              <div className="score-heading" role="columnheader">得点</div>
              {board.columns.map(column => {
                const gem = GEMS[column.gem];
                const gemStyle: GemStyle = { '--gem-color': gem.color };
                return (
                  <div className="gem-heading" role="columnheader" key={column.id} style={gemStyle} aria-label={gem.name}>
                    <img src={gem.image} alt="" draggable={false} />
                  </div>
                );
              })}
            </div>
            {board.rows.map(row => {
              const score = state.scores.get(row.id) ?? row.score;
              const scoreLabel = formatScore(score);
              const scoreStyle: ScoreStyle = { '--score-length': scoreLabel.length };
              const isSelectedRow = state.selection?.rowId === row.id;
              const awardId = state.award?.rowId === row.id ? state.award.id : undefined;
              return (
                <div className="board-row" role="row" key={row.id}>
                  <div className="score-plate" style={scoreStyle} data-negative={score < 0} data-selected={isSelectedRow} data-active={awardId !== undefined} role="rowheader" aria-label={`${scoreLabel}点`}>
                    <span className="score-value" key={awardId ?? 'score'}>{scoreLabel}</span>
                  </div>
                  {board.columns.map((column, index) => {
                    const address = { rowId: row.id, columnId: column.id };
                    const key = cellKey(address);
                    const gem = state.occupied.get(key);
                    const selected = isSelectedRow && state.selection?.columnId === column.id;
                    const blocked = row.cells?.[column.id]?.blocked === true;
                    const cellState = blocked ? 'blocked' : gem ? 'occupied' : isSelectedRow ? 'available' : 'empty';
                    return (
                      <BoardCell
                        key={column.id}
                        address={address}
                        label={`${scoreLabel}点の行、${GEMS[column.gem].name}列、${formatShortState(cellState, gem)}`}
                        state={cellState}
                        selected={selected}
                        gem={gem}
                        placementId={state.placement?.cell === key ? state.placement.id : undefined}
                        awardId={awardId}
                        scoreDelay={index * SCORE_STAGGER_MS}
                        onSelect={onSelect}
                      />
                    );
                  })}
                  {awardId !== undefined && <div className="score-beam" key={awardId} aria-hidden="true" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {isOverflowing && <p className="board-scroll-hint">横にスクロールしてすべての列を表示</p>}
    </section>
  );
}
