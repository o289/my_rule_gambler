import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { Ref, RefObject } from 'react';
import { GamblerBoard } from '../../board/ui/GamblerBoard';
import { cellKey, initialState } from '../../board/model/board-model';
import type { BoardAward, BoardDefinition, CellAddress } from '../../board/model/board-model';
import { GEMS, GEM_IDS } from '../../board/model/gems';
import type { GemId } from '../../board/model/gems';
import { centerWithin } from './visuals';
import type { Point } from './visuals';

const noSelection = () => undefined;

export function locateCell(board: HTMLElement | null, target?: CellAddress) {
  if (!board || !target) return null;
  return board.querySelector<HTMLElement>(`[data-row="${CSS.escape(target.rowId)}"][data-column="${CSS.escape(target.columnId)}"]`);
}

interface BoardSceneProps {
  viewportRef?: Ref<HTMLElement>;
  target?: CellAddress;
  definition: BoardDefinition;
  award?: BoardAward | null;
  scoreNotice?: { rowId: string; label: string };
  aim?: 'outline' | 'pulse';
  placed?: GemId;
  placementId?: number;
  tone?: 'gold' | 'gem';
}

export const BoardScene = memo(function BoardScene({ viewportRef, target, definition, award, scoreNotice, aim, placed, placementId, tone }: BoardSceneProps) {
  const board = useRef<HTMLElement>(null);
  const state = useMemo(() => {
    const base = initialState(definition);
    const occupied = new Map(base.occupied);
    if (target) {
      const key = cellKey(target);
      if (placed) occupied.set(key, placed);
      else occupied.delete(key);
    }
    const placement = target && placed && placementId !== undefined ? { cell: cellKey(target), id: placementId } : null;
    return { ...base, occupied, selection: target ?? null, award: award ?? null, placement };
  }, [definition, target, placed, award, placementId]);

  useLayoutEffect(() => {
    const cell = locateCell(board.current, target);
    if (!cell || !tone) return;
    cell.dataset.fxTarget = tone;
    const scroll = board.current?.querySelector('.board-scroll');
    if (scroll) {
      const bounds = cell.getBoundingClientRect();
      const visible = scroll.getBoundingClientRect();
      if (bounds.right > visible.right) scroll.scrollLeft += bounds.right - visible.right + 4;
      else if (bounds.left < visible.left) scroll.scrollLeft += bounds.left - visible.left - 4;
    }
    return () => { delete cell.dataset.fxTarget; };
  }, [target, tone]);

  useLayoutEffect(() => {
    const cell = locateCell(board.current, target);
    if (!cell || !aim) return;
    cell.dataset.turnTarget = 'aim';
    if (aim === 'pulse') cell.dataset.turnPulse = 'true';
    return () => {
      delete cell.dataset.turnTarget;
      delete cell.dataset.turnPulse;
    };
  }, [aim, target]);

  function shareViewport(element: HTMLElement | null) {
    board.current = element;
    if (typeof viewportRef === 'function') viewportRef(element);
    else if (viewportRef) viewportRef.current = element;
  }

  return (
    <div className="shared-board" data-light={tone} inert aria-hidden="true">
      <GamblerBoard board={definition} state={state} onSelect={noSelection} viewportRef={shareViewport} scoreNotice={scoreNotice} />
    </div>
  );
});

interface GemFlightProps {
  stage: RefObject<HTMLDivElement | null>;
  board: RefObject<HTMLElement | null>;
  source: RefObject<HTMLDivElement | null>;
  gem: GemId;
  target: CellAddress;
}

export function GemFlight({ stage, board, source, gem, target }: GemFlightProps) {
  const image = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const shell = stage.current;
    const from = source.current;
    const to = locateCell(board.current, target);
    const moving = image.current;
    if (!shell || !from || !to || !moving) return;
    const start = centerWithin(from, shell);
    const finish = centerWithin(to, shell);
    const middle = { x: start.x + (finish.x - start.x) * .46, y: start.y + (finish.y - start.y) * .37 - 26 };
    const half = moving.offsetWidth / 2;
    const transform = (x: number, y: number, scale: number, turn: number) => `translate3d(${x - half}px,${y - half}px,0) rotate(${turn}deg) scale(${scale})`;
    const settle = Math.min(.78, to.offsetWidth / Math.max(1, moving.offsetWidth) * .77);
    const motion = moving.animate([
      { transform: transform(start.x, start.y, .68, -12), opacity: 1 },
      { offset: .41, transform: transform(middle.x, middle.y, 1.02, 4), opacity: 1 },
      { transform: transform(finish.x, finish.y, settle, 0), opacity: .96 },
    ], { duration: 575, easing: 'cubic-bezier(.28,.62,.3,1)', fill: 'both' });
    return () => motion.cancel();
  }, [stage, board, source, target]);
  return <img ref={image} className="flying-gem" style={{ color: GEMS[gem].color }} src={GEMS[gem].image} alt="" aria-hidden="true" />;
}

export function ConvergingLights({ stage, board, target }: {
  stage: RefObject<HTMLDivElement | null>;
  board: RefObject<HTMLElement | null>;
  target?: Point;
}) {
  const lights = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const shell = stage.current;
    const source = board.current;
    if (!shell || !source || !lights.current) return;
    const animations: Animation[] = [];
    const starts = [...source.querySelectorAll<HTMLElement>('.board-cell[data-required-gem]')];
    for (const [index, light] of Array.from(lights.current.children).entries()) {
      const gem = light.getAttribute('data-gem');
      const origin = starts.find(cell => cell.dataset.requiredGem === gem) ?? starts[index % starts.length];
      if (!origin) continue;
      const point = centerWithin(origin, shell);
      const endX = target?.x ?? shell.clientWidth * .5;
      const endY = target?.y ?? shell.clientHeight * .46;
      const middleX = endX + Math.cos((index / 6) * Math.PI * 2) * endX * .48;
      const middleY = endY + Math.sin((index / 6) * Math.PI * 2) * Math.min(100, endY * .5);
      const pose = (x: number, y: number, scale: number) => `translate3d(${x}px,${y}px,0) scale(${scale})`;
      animations.push(light.animate([
        { transform: pose(point.x, point.y, .5), opacity: .96 },
        { offset: .57, transform: pose(middleX, middleY, 1.6), opacity: 1 },
        { offset: .89, opacity: 1 },
        { transform: pose(endX, endY, .38), opacity: 0 },
      ], { duration: 985, delay: index * 15, fill: 'both', easing: 'cubic-bezier(.41,.08,.55,1)' }));
    }
    return () => animations.forEach(animation => animation.cancel());
  }, [stage, board, target]);

  return <div ref={lights} className="converging-lights" aria-hidden="true">
    {GEM_IDS.map(id => <i key={id} data-gem={id} style={{ color: target ? '#ffda8a' : GEMS[id].color }} />)}
  </div>;
}
