import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';
import type { BoardDefinition, BoardState, CellAddress } from '../model/board-model';
import { cellKey, formatScore, nextOpenCell, playableColumns, requiredGemAt } from '../model/board-model';
import { SCORE_BEAM_MS, SCORE_PLATE_MS, SCORE_STAGGER_MS, scoreTimings } from '../../effects/ui/board-score/board-motion';
import { GEMS } from '../model/gems';
import type { GemId } from '../model/gems';

type CellState = 'empty' | 'available' | 'occupied' | 'blocked';

interface BoardCellProps {
  address: CellAddress;
  label: string;
  state: CellState;
  selected: boolean;
  expected?: GemId;
  gem?: GemId;
  goal?: number;
  goalLabel?: string;
  placementId?: number;
  awardId?: number;
  hinted?: boolean;
  scoreDelay: number;
  onSelect: (cell: CellAddress) => void;
}

export function BoardCell({ address, label, state, selected, expected, gem, goal, goalLabel, placementId, awardId, hinted, scoreDelay, onSelect }: BoardCellProps) {
  const placed = gem !== undefined;
  const blocked = state === 'blocked';
  const displayed = gem ?? expected;
  const scoreLabel = goalLabel ?? (goal === undefined ? undefined : formatScore(goal));
  const scoreStyle: CSSProperties & { '--score-length': number } = { '--score-length': scoreLabel?.length ?? 1 };
  return (
    <div className="grid-cell" role="cell">
      <button
        type="button"
        className="board-cell"
        data-state={state}
        data-awarded={awardId !== undefined || undefined}
        data-comeback-hint={hinted || undefined}
        data-row={address.rowId}
        data-column={address.columnId}
        data-goal={goal !== undefined || undefined}
        data-required-gem={expected}
        aria-label={label}
        aria-pressed={blocked ? undefined : selected}
        disabled={blocked}
        onClick={() => onSelect(address)}
      >
        {placementId !== undefined && <span key={`flash-${placementId}`} className="placement-flash" aria-hidden="true" />}
        {displayed && <img key={`gem-${placementId ?? displayed}`} className={placed
          ? placementId === undefined ? 'cell-gem' : 'cell-gem cell-gem--placed'
          : 'cell-gem cell-gem--required'} src={GEMS[displayed].image} alt="" draggable={false} />}
        {awardId !== undefined && <span key={awardId} className="score-flash" aria-hidden="true" style={{ animationDelay: `${scoreDelay}ms` }} />}
      </button>
      {goal !== undefined && (
        <span className="score-plate" data-negative={goal < 0} data-active={awardId !== undefined} data-notice={Boolean(goalLabel) || undefined} style={scoreStyle} aria-hidden="true">
          <span className="score-value" key={awardId ?? 'score'}>{scoreLabel}</span>
        </span>
      )}
    </div>
  );
}

interface BoardProps {
  board: BoardDefinition;
  state: BoardState;
  viewportRef: Ref<HTMLElement>;
  onSelect: (cell: CellAddress) => void;
  scoreNotice?: { rowId: string; label: string };
  candidates?: ReadonlySet<string>;
  hintCell?: CellAddress;
}

type BoardStyle = CSSProperties & {
  '--columns': number;
  '--beam-duration': string;
  '--plate-duration': string;
};
type RowStyle = CSSProperties & { '--beam-delay': string; '--plate-delay': string };

function formatShortState(state: CellState, gem?: GemId) {
  if (state === 'blocked') return '配置不可';
  if (gem) return `${GEMS[gem].name}を配置済み`;
  return state === 'available' ? '次に配置できるマス' : '未配置';
}

export function GamblerBoard({ board, state, viewportRef, onSelect, scoreNotice, candidates, hintCell }: BoardProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const cabinet = useRef<HTMLDivElement>(null);
  const [isOverflowing, setOverflowing] = useState(false);
  const style: BoardStyle = {
    '--columns': board.columns.length,
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
            {board.rows.map(row => {
              const score = state.scores.get(row.id) ?? row.score;
              const scoreLabel = formatScore(score);
              const playable = playableColumns(board, row);
              const goal = playable.at(-1);
              const goalIndex = board.columns.findIndex(column => column.id === goal?.id);
              const next = nextOpenCell(board, state.occupied, row.id);
              const awardId = state.award?.rowId === row.id ? state.award.id : undefined;
              const { beamDelay, plateDelay } = scoreTimings(playable.length);
              const rowStyle: RowStyle = { '--beam-delay': `${beamDelay}ms`, '--plate-delay': `${plateDelay}ms` };
              return (
                <div className="board-row" role="row" data-board-row={row.id} style={rowStyle} key={row.id}>
                  {board.columns.map(column => {
                    const address = { rowId: row.id, columnId: column.id };
                    const key = cellKey(address);
                    const playableIndex = playable.indexOf(column);
                    const blocked = playableIndex < 0;
                    const expected = blocked ? undefined : requiredGemAt(board, address);
                    const gem = blocked ? undefined : state.occupied.get(key);
                    const selected = candidates
                      ? candidates.has(key)
                      : !blocked && state.selection?.rowId === row.id && state.selection.columnId === column.id;
                    const cellState = blocked ? 'blocked' : gem ? 'occupied' : next?.columnId === column.id ? 'available' : 'empty';
                    const isGoal = goal?.id === column.id;
                    const gemName = expected ? `、指定 ${GEMS[expected].name}` : '';
                    return (
                      <BoardCell
                        key={column.id}
                        address={address}
                        label={`${scoreLabel}点の行${isGoal ? 'のゴール' : ''}${gemName}、${formatShortState(cellState, gem)}`}
                        state={cellState}
                        selected={selected}
                        expected={expected}
                        gem={gem}
                        goal={isGoal ? score : undefined}
                        goalLabel={isGoal && scoreNotice?.rowId === row.id ? scoreNotice.label : undefined}
                        placementId={!blocked && state.placement?.cell === key ? state.placement.id : undefined}
                        awardId={blocked ? undefined : awardId}
                        hinted={!blocked && hintCell?.rowId === row.id && hintCell.columnId === column.id}
                        scoreDelay={playableIndex * SCORE_STAGGER_MS}
                        onSelect={onSelect}
                      />
                    );
                  })}
                  {awardId !== undefined && goalIndex >= 0 && (
                    <div className="score-beam" style={{ gridColumn: `1 / ${goalIndex + 2}` }} key={awardId} aria-hidden="true" />
                  )}
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
