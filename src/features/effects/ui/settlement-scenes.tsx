import { CrownIcon } from '../../players/ui/vip-icons';
import { CurrentTurnHighlight } from '../../players/ui/turn-highlight';
import type { EffectPlayback } from '../application/effect-player';
import { turnLabel } from '../model/effect-model';
import type { EffectParams, EffectScenario } from '../model/effect-model';
import { BoardScene } from './board-scene';
import './settlement-scenes.css';

export function TurnAnnouncement({ player, pulse }: { player: EffectParams['TURN_CHANGE']; pulse: boolean }) {
  return (
    <div className="turn-announcement" role="status">
      {pulse && <CurrentTurnHighlight once />}
      <CrownIcon />
      <div>
        {player.isLocal && <span className="turn-announcement-name">{player.playerName}</span>}
        <strong>{turnLabel(player)}</strong>
      </div>
    </div>
  );
}

export function TurnChangeEffect({ playback, params, scenario }: {
  playback: EffectPlayback;
  params: EffectParams['TURN_CHANGE'];
  scenario: EffectScenario;
}) {
  return (
    <div className="turn-scene turn-change-scene">
      <BoardScene definition={scenario.board} />
      <section className="turn-panel" aria-label="手番の案内">
        <TurnAnnouncement player={params} pulse={!playback.skipped && !playback.reduced} />
        {params.isLocal && (playback.playing
          ? <span className="turn-roll-button" lang="en" aria-disabled="true">ROLL DICE</span>
          : <a className="turn-roll-button" href="/?preview=dice" lang="en">ROLL DICE</a>)}
      </section>
    </div>
  );
}
