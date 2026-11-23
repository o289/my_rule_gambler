import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { EffectPlayer } from '../../effects/application/effect-player';
import { BigWinEffect, ComebackEffect, JackpotVictoryEffect } from '../../effects/ui/effects';
import type { SoundManager } from '../../effects/ui/sound';
import type { BoardDefinition, CellAddress } from '../../board/model/board-model';
import type { EffectRequest } from '../../effects/model/effect-model';
import '../../effects/ui/style.css';
import '../../effects/ui/board-score/score-effect.css';

export function SettlementOverlay({ request, target, board, boardRef, audio, reduced, onComplete }: {
  request: EffectRequest;
  target: CellAddress;
  board: BoardDefinition;
  boardRef: RefObject<HTMLElement | null>;
  audio: SoundManager;
  reduced: boolean;
  onComplete: () => void;
}) {
  const scenario = useMemo(() => ({ board }), [board]);
  const player = useMemo(() => new EffectPlayer(audio, scenario), [audio, scenario]);
  const playback = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const stage = useRef<HTMLDivElement>(null);
  const completed = useRef(false);

  useEffect(() => {
    player.play(request, reduced);
    return () => player.reset();
  }, [player, request, reduced]);
  useEffect(() => {
    if (playback && !playback.playing && playback.phase === 'finish' && !completed.current) {
      completed.current = true;
      onComplete();
    }
  }, [playback, onComplete]);

  if (!playback) return null;
  if (playback.request.kind === 'BIG_WIN') return <div className="effect-stage live-board-effects" ref={stage}
    data-effect={playback.request.kind} data-phase={playback.phase}>
    <BigWinEffect playback={playback} params={playback.request.params} stage={stage}
      scenario={{ board, featuredCell: target }} liveBoard={boardRef} />
  </div>;
  return <div className="live-effects-layer" role="region" aria-label="結果演出">
    <div className="effect-stage live-effect-stage" ref={stage} data-effect={playback.request.kind} data-phase={playback.phase}>
      <div className="stage-surface" aria-hidden="true" />
      <div className="stage-corners" aria-hidden="true"><i /><i /><i /><i /></div>
      {playback.request.kind === 'JACKPOT_VICTORY'
          ? <JackpotVictoryEffect key={playback.id} playback={playback} params={playback.request.params} stage={stage}
            scenario={{ board, featuredCell: target }} liveBoard={boardRef} />
        : playback.request.kind === 'COMEBACK'
          ? <ComebackEffect key={playback.id} playback={playback} params={playback.request.params} stage={stage} />
          : null}
    </div>
  </div>;
}
