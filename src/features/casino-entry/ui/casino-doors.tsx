import { useEffect, useState } from 'react';
import type { TransitionEvent } from 'react';

export const DOOR_FALLBACK_MS = 1220;
export const ROOM_UNLOCK_MS = 410;
export type RoomDoorMotion = 'unlocking' | 'opening' | 'closing';

export function CasinoDoors({ open, onComplete }: { open: boolean; onComplete: () => void }) {
  function transition(event: TransitionEvent<HTMLDivElement>) {
    if (event.currentTarget === event.target && event.propertyName === 'transform') onComplete();
  }

  return <div className="casino-hinge" data-open={open} aria-hidden="true">
    <div className="casino-door casino-door--left" />
    <div className="casino-door casino-door--right" onTransitionEnd={transition} />
  </div>;
}

export function RoomDoor({ motion, onComplete }: { motion: RoomDoorMotion; onComplete: () => void }) {
  const [closingStarted, setClosingStarted] = useState(false);

  useEffect(() => {
    if (motion !== 'closing') return;
    let next = 0;
    const first = requestAnimationFrame(() => { next = requestAnimationFrame(() => setClosingStarted(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(next); };
  }, [motion]);

  const open = motion === 'opening' || (motion === 'closing' && !closingStarted);

  return <div className="casino-room-door" id="casino-room-door" data-motion={motion}>
    <CasinoDoors open={open} onComplete={() => {
      if (motion === 'opening' || (motion === 'closing' && closingStarted)) onComplete();
    }} />
    <div className="room-lock" data-released={motion !== 'closing'}>
      <svg viewBox="0 0 30 34" width="30" height="34" fill="none" aria-hidden="true">
        <path className="room-lock-shackle" d="M8 15V10a7 7 0 0114 0v5" stroke="currentColor" strokeWidth="1.8" />
        <rect x="5" y="14" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M15 20v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {motion === 'unlocking' && <span role="status">解錠中</span>}
    </div>
  </div>;
}
