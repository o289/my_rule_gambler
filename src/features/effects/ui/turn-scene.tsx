import { useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { GemDie3D } from '../../dice/ui/3d/GemDie3D';
import { GEMS } from '../../board/model/gems';
import { reached } from '../application/effect-player';
import type { EffectPlayback } from '../application/effect-player';
import type { EffectRequest, EffectTurnScenario } from '../model/effect-model';
import { BoardScene, GemFlight } from './board-scene';
import { TurnAnnouncement } from './settlement-scenes';

type TurnRequest = Extract<EffectRequest, { kind: 'ONE_CELL_COMEBACK' | 'REROLL_THROW' }>;

const noCells = [] as const;

export function TurnScene({ playback, request, stage, settleRoll, scenario, ranking = false }: {
  playback: EffectPlayback;
  request: TurnRequest;
  stage: RefObject<HTMLDivElement | null>;
  settleRoll: (id: number) => void;
  scenario: EffectTurnScenario;
  ranking?: boolean;
}) {
  const board = useRef<HTMLElement>(null);
  const source = useRef<HTMLDivElement>(null);
  const comeback = request.kind === 'ONE_CELL_COMEBACK';
  const { gem } = request.params;
  const attempt = GEMS[gem];
  const rolling = reached(playback, 'roll');
  const settled = reached(playback, 'roll-stop');
  const hit = comeback && gem === scenario.comebackGem;
  const placed = hit && reached(playback, 'place');
  const flying = hit && reached(playback, 'flight') && !placed && !playback.reduced;
  const pulse = hit && settled && !placed && !playback.reduced && !playback.skipped;
  const lanes = useMemo(() => comeback ? noCells : scenario.rerollTargets(gem), [comeback, scenario, gem]);
  const marked = comeback ? [scenario.lastCell] : settled ? lanes : noCells;
  const tone: 'aim' | 'available' = comeback ? 'aim' : 'available';
  const turnCue = useMemo(() => ({ cells: marked, tone, pulse }), [marked, tone, pulse]);
  const passed = !comeback && !lanes.length && reached(playback, 'handoff');
  const retain = !comeback && !rolling;
  const score = scenario.currentPlayer.score + (placed ? scenario.comebackScore : 0);

  return <>
    <div className="turn-scene" data-turn-kind={comeback ? 'comeback' : 'reroll'} data-ranking={ranking} aria-hidden={ranking || undefined}>
      <BoardScene viewportRef={board} definition={comeback ? scenario.comebackBoard : scenario.board}
        turnCue={turnCue} target={comeback ? scenario.lastCell : undefined} placed={placed ? gem : undefined} />
      <section className="turn-panel" aria-label="一投の状況">
        {passed
          ? <TurnAnnouncement player={{ playerName: scenario.nextPlayer.name, isLocal: false }} pulse={!playback.skipped && !playback.reduced} />
          : <div className="turn-player"><span>{scenario.currentPlayer.name}</span><span>の手番</span></div>}
        {comeback && (
          <>
            <p className="turn-objective">{GEMS[scenario.comebackGem].name}で <strong>＋{scenario.comebackScore}点 → 1位</strong></p>
            <ul className="turn-points" aria-label="各プレイヤーの得点">
              {scenario.players.map(member => (
                <li key={member.name} data-current={member.name === scenario.currentPlayer.name}>
                  <span>{member.name}</span><strong>{member.name === scenario.currentPlayer.name ? score : member.score}点</strong>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="turn-die-bay" aria-hidden="true" data-rolling={rolling && !settled}>
          <div className="turn-die-seat" ref={source} data-consumed={placed || flying}>
            {retain && <span className="turn-retained-die"><img src={GEMS[scenario.retainedGem].image} alt="" /></span>}
            {rolling && !ranking && !placed && !flying && <GemDie3D gem={gem} animate={!playback.reduced && !playback.skipped}
              forceSettled={settled} onSettled={() => settleRoll(playback.id)} />}
            {comeback && !rolling && <img className="turn-gem-preview" src={GEMS[scenario.comebackGem].image} alt="" />}
            {placed && <img className="turn-gem-preview" src={attempt.image} alt="" />}
          </div>
          {retain && <span className="turn-reroll-ring" />}
        </div>
        <p className="turn-result" role="status">
          {placed ? <strong>＋{scenario.comebackScore}点獲得</strong>
            : comeback ? settled ? <><img src={attempt.image} alt="" /><span>{attempt.name}{hit ? '　狙いどおり' : '　逆転ならず'}</span></>
              : rolling ? '投擲中' : `＋${scenario.comebackScore}点の行　あと1マス`
            : settled ? lanes.length ? <><img src={attempt.image} alt="" /><span>{attempt.name}を配置できるマス {lanes.length}か所</span></>
              : '配置できるマスなし'
              : rolling ? '振り直し中' : '未配置ダイス 1個'}
        </p>
      </section>
    </div>
    {flying && <GemFlight stage={stage} board={board} source={source} gem={gem} target={scenario.lastCell} />}
  </>;
}
