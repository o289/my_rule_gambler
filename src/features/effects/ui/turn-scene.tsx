import { useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { GemDie3D } from '../../dice/ui/3d/GemDie3D';
import { GEMS } from '../../board/model/gems';
import {
  COMEBACK_BOARD, COMEBACK_GEM, COMEBACK_SCORE, CURRENT_PLAYER, LAST_CELL, NEXT_PLAYER, RETAINED_GEM,
  rerollTargets, TURN_PLAYERS,
} from '../model/effect-turn';
import { reached } from '../application/effect-player';
import type { EffectPlayback } from '../application/effect-player';
import type { EffectRequest } from '../model/effect-model';
import { BoardScene, GemFlight } from './board-scene';

type TurnRequest = Extract<EffectRequest, { kind: 'ONE_CELL_COMEBACK' | 'REROLL_THROW' }>;

const aimCells = [LAST_CELL];
const noCells = [] as const;

export function TurnScene({ playback, request, stage, settleRoll, ranking = false }: {
  playback: EffectPlayback;
  request: TurnRequest;
  stage: RefObject<HTMLDivElement | null>;
  settleRoll: (id: number) => void;
  ranking?: boolean;
}) {
  const board = useRef<HTMLElement>(null);
  const source = useRef<HTMLDivElement>(null);
  const comeback = request.kind === 'ONE_CELL_COMEBACK';
  const { gem } = request.params;
  const attempt = GEMS[gem];
  const rolling = reached(playback, 'roll');
  const settled = reached(playback, 'roll-stop');
  const hit = comeback && gem === COMEBACK_GEM;
  const placed = hit && reached(playback, 'place');
  const flying = hit && reached(playback, 'flight') && !placed && !playback.reduced;
  const pulse = hit && settled && !placed && !playback.reduced && !playback.skipped;
  const lanes = useMemo(() => comeback ? noCells : rerollTargets(gem), [comeback, gem]);
  const marked = comeback ? aimCells : settled ? lanes : noCells;
  const tone: 'aim' | 'available' = comeback ? 'aim' : 'available';
  const turnCue = useMemo(() => ({ cells: marked, tone, pulse }), [marked, tone, pulse]);
  const passed = !comeback && !lanes.length && reached(playback, 'handoff');
  const player = passed ? NEXT_PLAYER : CURRENT_PLAYER;
  const retain = !comeback && !rolling;
  const score = CURRENT_PLAYER.score + (placed ? COMEBACK_SCORE : 0);

  return <>
    <div className="turn-scene" data-turn-kind={comeback ? 'comeback' : 'reroll'} data-ranking={ranking} aria-hidden={ranking || undefined}>
      <BoardScene viewportRef={board} definition={comeback ? COMEBACK_BOARD : undefined}
        turnCue={turnCue} target={comeback ? LAST_CELL : undefined} placed={placed ? gem : undefined} />
      <section className="turn-panel" aria-label="一投の状況">
        <div className="turn-player" data-next={passed}><span>{player.name}</span><span>の手番</span></div>
        {comeback && (
          <>
            <p className="turn-objective">アメジストで <strong>＋{COMEBACK_SCORE}点 → 1位</strong></p>
            <ul className="turn-points" aria-label="各プレイヤーの得点">
              {TURN_PLAYERS.map(member => (
                <li key={member.name} data-current={member.name === CURRENT_PLAYER.name}>
                  <span>{member.name}</span><strong>{member.name === CURRENT_PLAYER.name ? score : member.score}点</strong>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="turn-die-bay" aria-hidden="true" data-rolling={rolling && !settled}>
          <div className="turn-die-seat" ref={source} data-consumed={placed || flying}>
            {retain && <span className="turn-retained-die"><img src={GEMS[RETAINED_GEM].image} alt="" /></span>}
            {rolling && !ranking && !placed && !flying && <GemDie3D gem={gem} animate={!playback.reduced && !playback.skipped}
              forceSettled={settled} onSettled={() => settleRoll(playback.id)} />}
            {comeback && !rolling && <img className="turn-gem-preview" src={GEMS[COMEBACK_GEM].image} alt="" />}
            {placed && <img className="turn-gem-preview" src={attempt.image} alt="" />}
          </div>
          {retain && <span className="turn-reroll-ring" />}
        </div>
        <p className="turn-result" role="status">
          {placed ? <strong>＋{COMEBACK_SCORE}点獲得</strong>
            : comeback ? settled ? <><img src={attempt.image} alt="" /><span>{attempt.name}{hit ? '　狙いどおり' : '　逆転ならず'}</span></>
              : rolling ? '投擲中' : `＋${COMEBACK_SCORE}点の行　あと1マス`
            : settled ? lanes.length ? <><img src={attempt.image} alt="" /><span>{attempt.name}を配置できるマス {lanes.length}か所</span></>
              : '配置できるマスなし'
              : rolling ? '振り直し中' : '未配置ダイス 1個'}
        </p>
      </section>
    </div>
    {flying && <GemFlight stage={stage} board={board} source={source} gem={gem} target={LAST_CELL} />}
  </>;
}
