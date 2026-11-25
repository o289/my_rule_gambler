import { CrownIcon } from '../../players/ui/vip-icons';
import { CurrentTurnHighlight } from '../../players/ui/turn-highlight';
import type { EffectPlayback } from '../application/effect-player';
import { turnLabel } from '../model/effect-model';
import type { EffectParams, EffectScenario } from '../model/effect-model';
import { BoardScene } from './board-scene';
import './settlement-scenes.css';
import frame from './media/victory-frame.webp';
import filigree from './media/title-filigree.webp';

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

export function TurnChangeMainScene({ player, reduced }: { player: EffectParams['TURN_CHANGE']; reduced: boolean }) {
  return <section className="turn-change-main-scene" data-reduced={reduced} aria-label="手番の切り替え">
    <div className="turn-main-halo" aria-hidden="true" />
    <img className="turn-main-frame turn-main-frame--left" src={frame} alt="" aria-hidden="true" />
    <img className="turn-main-frame turn-main-frame--right" src={frame} alt="" aria-hidden="true" />
    <div className="turn-main-card">
      <img className="turn-main-flourish" src={filigree} alt="" aria-hidden="true" />
      <span className="turn-main-kicker">THE NEXT TURN</span>
      <TurnAnnouncement player={player} pulse={!reduced} />
      <img className="turn-main-flourish turn-main-flourish--bottom" src={filigree} alt="" aria-hidden="true" />
    </div>
  </section>;
}

export function TurnChangeEffect({ playback, params, scenario }: {
  playback: EffectPlayback;
  params: EffectParams['TURN_CHANGE'];
  scenario: EffectScenario;
}) {
  return (
    <div className="turn-scene turn-change-scene">
      <BoardScene definition={scenario.board} />
      <TurnChangeMainScene player={params} reduced={playback.reduced || playback.skipped} />
    </div>
  );
}
