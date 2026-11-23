import { useRef } from 'react';
import type { RefObject } from 'react';
import { GemDie3D } from '../../dice/ui/3d/GemDie3D';
import { GEMS } from '../../board/model/gems';
import type { GemId } from '../../board/model/gems';
import { reached } from '../application/effect-player';
import type { EffectPlayback } from '../application/effect-player';
import type { EffectTurnScenario } from '../model/effect-model';
import { BoardScene, GemFlight } from './board-scene';

export function TurnScene({ playback, gem, stage, settleRoll, scenario, ranking }: {
  playback: EffectPlayback;
  gem: GemId;
  stage: RefObject<HTMLDivElement | null>;
  settleRoll: (id: number) => void;
  scenario: EffectTurnScenario;
  ranking: boolean;
}) {
  const board = useRef<HTMLElement>(null);
  const source = useRef<HTMLDivElement>(null);
  const attempt = GEMS[gem];
  const rolling = reached(playback, 'roll');
  const settled = reached(playback, 'roll-stop');
  const hit = gem === scenario.comebackGem;
  const placed = hit && reached(playback, 'place');
  const flying = hit && reached(playback, 'flight') && !placed && !playback.reduced;
  const pulse = hit && settled && !placed && !playback.reduced && !playback.skipped;
  const score = scenario.currentPlayer.score + (placed ? scenario.comebackScore : 0);

  return <>
    <div className="turn-scene" data-turn-kind="comeback" data-ranking={ranking} aria-hidden={ranking || undefined}>
      <BoardScene viewportRef={board} definition={scenario.comebackBoard}
        aim={pulse ? 'pulse' : 'outline'} target={scenario.lastCell} placed={placed ? gem : undefined} />
      <section className="turn-panel" aria-label="一投の状況">
        <div className="turn-player"><span>{scenario.currentPlayer.name}</span><span>の手番</span></div>
        <p className="turn-objective">{GEMS[scenario.comebackGem].name}で <strong>＋{scenario.comebackScore}点 → 1位</strong></p>
        <ul className="turn-points" aria-label="各プレイヤーの得点">
          {scenario.players.map(member => (
            <li key={member.name} data-current={member.name === scenario.currentPlayer.name}>
              <span>{member.name}</span><strong>{member.name === scenario.currentPlayer.name ? score : member.score}点</strong>
            </li>
          ))}
        </ul>
        <div className="turn-die-bay" aria-hidden="true" data-rolling={rolling && !settled}>
          <div className="turn-die-seat" ref={source} data-consumed={placed || flying}>
            {rolling && !ranking && !placed && !flying && <GemDie3D gem={gem} animate={!playback.reduced && !playback.skipped}
              forceSettled={settled} onSettled={() => settleRoll(playback.id)} />}
            {!rolling && <img className="turn-gem-preview" src={GEMS[scenario.comebackGem].image} alt="" />}
            {placed && <img className="turn-gem-preview" src={attempt.image} alt="" />}
          </div>
        </div>
        <p className="turn-result" role="status">
          {placed ? <strong>＋{scenario.comebackScore}点獲得</strong>
            : settled ? <><img src={attempt.image} alt="" /><span>{attempt.name}{hit ? '　狙いどおり' : '　逆転ならず'}</span></>
              : rolling ? '投擲中' : `＋${scenario.comebackScore}点の行　あと1マス`}
        </p>
      </section>
    </div>
    {flying && <GemFlight stage={stage} board={board} source={source} gem={gem} target={scenario.lastCell} />}
  </>;
}
