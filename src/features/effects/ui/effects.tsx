import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { SAMPLE_BOARD } from '../../../dev/preview-data/sample-board';
import { GEMS } from '../../board/model/gems';
import { GemDie3D } from '../../dice/ui/3d/GemDie3D';
import { BoardScene, ConvergingLights, GemFlight, locateCell } from './board-scene';
import { FEATURED_CELL, rankOrder } from '../model/effect-model';
import type { EffectKind, EffectParams, EffectRequest } from '../model/effect-model';
import { reached } from '../application/effect-player';
import type { EffectPlayback } from '../application/effect-player';
import { centerWithin, CountUp, GoldParticles, GoldText, ScreenFlash, Shockwave, useScreenShake } from './visuals';
import type { Point } from './visuals';
import crest from './media/victory-crest.webp';
import frame from './media/victory-frame.webp';
import pillars from './media/gold-columns.webp';
import filigree from './media/title-filigree.webp';

interface SharedSceneProps {
  playback: EffectPlayback;
  stage: RefObject<HTMLDivElement | null>;
}

export function DiceStopEffect({ playback, params }: SharedSceneProps & { params: EffectParams['DICE_STOP'] }) {
  return (
    <div className="dice-scene">
      <div className="dice-inlay" aria-hidden="true" />
      <GemDie3D gem={params.gem} animate={!playback.skipped} />
      {reached(playback, 'glow') && <div className="dice-gem-label" style={{ color: GEMS[params.gem].color }}>
        <img src={GEMS[params.gem].image} alt="" />{GEMS[params.gem].name}
      </div>}
    </div>
  );
}

export function GemPlacementEffect({ playback, params, stage }: SharedSceneProps & { params: EffectParams['GEM_PLACEMENT'] }) {
  const board = useRef<HTMLElement>(null);
  const source = useRef<HTMLDivElement>(null);
  const [landing, setLanding] = useState<Point>();
  const launched = reached(playback, 'flight');
  const placed = reached(playback, 'impact');
  const animate = playback.playing && !playback.reduced;
  useLayoutEffect(() => {
    const target = locateCell(board.current, params.target);
    if (placed && target && stage.current) setLanding(centerWithin(target, stage.current));
  }, [placed, params.target, stage]);

  return (
    <>
      <BoardScene viewportRef={board} target={params.target} placed={placed ? params.gem : undefined} tone="gold" />
      <div className="placement-source" ref={source} data-spent={placed || (launched && animate)} aria-hidden="true">
        <img src={GEMS[params.gem].image} alt="" />
      </div>
      {animate && launched && !placed && <GemFlight stage={stage} board={board} source={source} gem={params.gem} target={params.target} />}
      {animate && placed && landing && <Shockwave point={landing} className="fx-shockwave--local" />}
    </>
  );
}

function TitleFlourish() {
  return <img src={filigree} className="title-flourish" alt="" aria-hidden="true" />;
}

export function BigWinEffect({ playback, params, stage }: SharedSceneProps & { params: EffectParams['BIG_WIN'] }) {
  const target = params.target ?? FEATURED_CELL;
  const board = useRef<HTMLElement>(null);
  const [focusPoint, setFocusPoint] = useState<Point>();
  const gem = SAMPLE_BOARD.columns.find(column => column.id === target.columnId)?.gem ?? 'amethyst';
  const impact = reached(playback, 'impact');
  const active = playback.playing && !playback.reduced;
  const focused = reached(playback, 'focus');
  useScreenShake(stage, active && impact);
  useLayoutEffect(() => {
    const cell = locateCell(board.current, target);
    if (cell && stage.current && focused) setFocusPoint(centerWithin(cell, stage.current));
  }, [stage, target, focused]);
  return (
    <>
      <BoardScene viewportRef={board} target={target} placed={gem} tone={playback.phase === 'start' ? undefined : 'gold'} />
      <div className="big-vignette" aria-hidden="true" />
      {!impact && <div className="big-charge" data-phase={playback.phase} style={focusPoint ? { left: focusPoint.x, top: focusPoint.y } : undefined} aria-hidden="true" />}
      {active && focusPoint && reached(playback, 'gather') && !reached(playback, 'silence') && <ConvergingLights stage={stage} board={board} target={focusPoint} />}
      {impact && (
        <div className="win-slate" data-animate={active} data-complete={!playback.playing}>
          <div className="win-halo" aria-hidden="true" />
          {active && <Shockwave />}
          <div className="big-title-card">
            <TitleFlourish />
            <h2 lang="en"><GoldText>BIG WIN</GoldText></h2>
            <div className="big-points"><CountUp points={params.points} immediate={!active} /><span>点</span></div>
            <span className="champion-name">{params.playerName}</span>
          </div>
        </div>
      )}
      {impact && active && <><ScreenFlash grand={false} /><GoldParticles kind="big" stage={stage} /></>}
    </>
  );
}

function Lightning() {
  return <svg className="fx-lightning" viewBox="0 0 800 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <path className="bolt bolt--red" d="M-35 14 221 49 172 93 389 118 313 166 552 225 505 268 853 401" />
    <path className="bolt bolt--gold" d="M850 6 655 80 687 106 544 140 571 176 412 229 437 269 307 342 315 372 -5 443" />
    <path className="bolt bolt--red" d="M-11 370 120 314 99 282 245 240 206 202 324 184" />
  </svg>;
}

function Ranking({ params, after, highlight, reduced }: { params: EffectParams['COMEBACK']; after: boolean; highlight: boolean; reduced: boolean }) {
  const list = useRef<HTMLOListElement>(null);
  const previous = useRef(new Map<string, number>());
  const order = useMemo(() => rankOrder(params, after), [params, after]);
  useLayoutEffect(() => {
    if (!list.current) return;
    const next = new Map<string, number>();
    const animations: Animation[] = [];
    for (const item of list.current.querySelectorAll<HTMLElement>('[data-player]')) {
      const id = item.dataset.player;
      if (!id) continue;
      const top = item.getBoundingClientRect().top;
      next.set(id, top);
      const old = previous.current.get(id);
      if (old === undefined || reduced || Math.abs(old - top) < 1) continue;
      animations.push(item.animate([
        { transform: `translate3d(0,${old - top}px,0) scale(.96)` },
        { offset: .68, transform: 'translate3d(0,0,0) scale(1.025)' },
        { transform: 'translate3d(0,0,0) scale(1)' },
      ], { duration: 630, easing: 'cubic-bezier(.2,.77,.2,1)' }));
    }
    previous.current = next;
    return () => animations.forEach(animation => animation.cancel());
  }, [order, reduced]);

  return (
    <ol className="leaderboard" ref={list} aria-label="順位表">
      {order.map((name, index) => (
        <li key={name} data-player={name} data-rank={index + 1} data-contender={name === params.playerName} data-winner={name === params.playerName && highlight}>
          <span className="rank-number">{index + 1}<span className="sr-only">位</span></span>
          <span className="rank-name">{name}</span>
          {after && name === params.playerName && <span className="rank-change">↑ {params.fromRank - params.toRank}</span>}
        </li>
      ))}
    </ol>
  );
}

export function ComebackEffect({ playback, params, stage }: SharedSceneProps & { params: EffectParams['COMEBACK'] }) {
  const impact = reached(playback, 'impact');
  const highlight = reached(playback, 'reveal');
  const active = playback.playing && !playback.reduced;
  useScreenShake(stage, active && impact);
  return (
    <div className="comeback-scene" data-dark={playback.phase === 'silence'} data-impact={impact}>
      {active && impact && <Lightning />}
      <div className="comeback-content">
        {impact ? (
          <h2 className="comeback-title" data-animate={active} lang="en"><GoldText>COMEBACK</GoldText></h2>
        ) : (
          <div className="rank-heading">順位表</div>
        )}
        <Ranking params={params} after={impact} highlight={highlight} reduced={!active} />
      </div>
      {impact && active && <GoldParticles kind="comeback" stage={stage} />}
    </div>
  );
}

export function JackpotVictoryEffect({ playback, params, stage }: SharedSceneProps & { params: EffectParams['JACKPOT_VICTORY'] }) {
  const board = useRef<HTMLElement>(null);
  const target = params.target ?? FEATURED_CELL;
  const impact = reached(playback, 'impact');
  const revealed = reached(playback, 'reveal');
  const active = playback.playing && !playback.reduced;
  useScreenShake(stage, active && impact, true);
  return (
    <>
      <BoardScene viewportRef={board} target={target} placed={params.gem} tone="gem" />
      <div className="jackpot-vignette" data-phase={playback.phase} aria-hidden="true" />
      {active && reached(playback, 'gather') && !reached(playback, 'silence') && <ConvergingLights stage={stage} board={board} />}
      {!impact && reached(playback, 'gather') && <div className="jackpot-energy" data-phase={playback.phase} aria-hidden="true" />}
      {impact && (
        <div className="jackpot-slate" data-animate={active} data-complete={!playback.playing}>
          <div className="jackpot-halo" aria-hidden="true" />
          <img className="jackpot-column" src={pillars} alt="" aria-hidden="true" />
          <img className="jackpot-frame jackpot-frame--left" src={frame} alt="" aria-hidden="true" />
          <img className="jackpot-frame jackpot-frame--right" src={frame} alt="" aria-hidden="true" />
          {active && <Shockwave className="fx-shockwave--grand" />}
          <div className="jackpot-title-card">
            <div className="winner-crest-slot">
              {revealed && <img className="winner-crest" src={crest} alt="" aria-hidden="true" />}
            </div>
            <TitleFlourish />
            <h2 lang="en"><GoldText>JACKPOT<br className="jackpot-break" /> VICTORY</GoldText></h2>
            {revealed && <div className="winner-display">
              <span>勝者</span>
              <GoldText className="winner-name">{params.playerName}</GoldText>
            </div>}
          </div>
        </div>
      )}
      {impact && active && <><ScreenFlash grand /><GoldParticles kind="grand" stage={stage} /></>}
    </>
  );
}

export function EffectScene({ playback, stage }: SharedSceneProps) {
  const { request } = playback;
  switch (request.kind) {
    case 'DICE_STOP': return <DiceStopEffect playback={playback} params={request.params} stage={stage} />;
    case 'GEM_PLACEMENT': return <GemPlacementEffect playback={playback} params={request.params} stage={stage} />;
    case 'BIG_WIN': return <BigWinEffect playback={playback} params={request.params} stage={stage} />;
    case 'COMEBACK': return <ComebackEffect playback={playback} params={request.params} stage={stage} />;
    case 'JACKPOT_VICTORY': return <JackpotVictoryEffect playback={playback} params={request.params} stage={stage} />;
  }
}

export function outcome({ kind, params }: EffectRequest) {
  switch (kind) {
    case 'DICE_STOP': return GEMS[params.gem].name;
    case 'GEM_PLACEMENT': return `${GEMS[params.gem].name}を配置しました`;
    case 'BIG_WIN': return `${params.playerName}　+${params.points.toLocaleString('ja-JP')}点`;
    case 'COMEBACK': return `${params.playerName}　${params.fromRank}位 → ${params.toRank}位`;
    case 'JACKPOT_VICTORY': return `勝者　${params.playerName}`;
  }
}

export const EFFECT_ICONS: Record<EffectKind, string> = {
  DICE_STOP: '◇', GEM_PLACEMENT: '◈', BIG_WIN: '✦', COMEBACK: 'ϟ', JACKPOT_VICTORY: '♛',
};
