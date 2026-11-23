import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { EffectPlayer } from '../../effects/application/effect-player';
import { BigWinEffect, ComebackEffect, JackpotVictoryEffect } from '../../effects/ui/effects';
import type { SoundManager } from '../../effects/ui/sound';
import type { BoardDefinition } from '../../board/model/board-model';
import type { MatchSettlementEvent } from '../../../shared/contracts/dice';
import { settlementFollowups } from '../model/settlement-presentation';
import '../../effects/ui/style.css';
import '../../effects/ui/board-score/score-effect.css';

export function SettlementOverlay({ event, board, boardRef, audio, onComplete }: {
  event: MatchSettlementEvent;
  board: BoardDefinition;
  boardRef: RefObject<HTMLElement | null>;
  audio: SoundManager;
  onComplete: () => void;
}) {
  const scenario = useMemo(() => ({ board }), [board]);
  const requests = useMemo(() => settlementFollowups(event, board), [event, board]);
  const player = useMemo(() => new EffectPlayer(audio, scenario), [audio, scenario]);
  const playback = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const stage = useRef<HTMLDivElement>(null);
  const completed = useRef(false);

  useEffect(() => {
    player.playAll(requests, matchMedia('(prefers-reduced-motion: reduce)').matches);
    return () => player.reset();
  }, [player, requests]);
  useEffect(() => {
    if (playback && !playback.playing && playback.phase === 'finish' && !completed.current) {
      completed.current = true;
      onComplete();
    }
  }, [playback, onComplete]);

  if (!playback) return null;
  return <div className="live-effects-layer">
    <div className="effect-stage live-effect-stage" ref={stage} data-effect={playback.request.kind} data-phase={playback.phase}>
      <div className="stage-surface" aria-hidden="true" />
      <div className="stage-corners" aria-hidden="true"><i /><i /><i /><i /></div>
      {playback.request.kind === 'BIG_WIN'
        ? <BigWinEffect key={playback.id} playback={playback} params={playback.request.params} stage={stage}
          scenario={{ board, featuredCell: playback.request.params.target ?? { rowId: event.rowId, columnId: event.columnId } }} liveBoard={boardRef} />
        : playback.request.kind === 'JACKPOT_VICTORY'
          ? <JackpotVictoryEffect key={playback.id} playback={playback} params={playback.request.params} stage={stage}
            scenario={{ board, featuredCell: playback.request.params.target ?? { rowId: event.rowId, columnId: event.columnId } }} liveBoard={boardRef} />
        : playback.request.kind === 'COMEBACK'
          ? <ComebackEffect key={playback.id} playback={playback} params={playback.request.params} stage={stage} />
          : null}
      <button type="button" className="live-effect-skip" onClick={() => player.skip()} disabled={!playback.playing}>演出をスキップ</button>
    </div>
  </div>;
}
