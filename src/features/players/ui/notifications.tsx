import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerInfoStore, ScoreChange } from '../model/player-data';

const NOTICE_MS = 2900;
const SHOWN_NOTICES = 3;

export function useScoreNotifications(store: PlayerInfoStore) {
  const [notices, setNotices] = useState<readonly ScoreChange[]>([]);
  const timers = useRef(new Map<number, number>());

  const clear = useCallback(() => {
    for (const timeout of timers.current.values()) window.clearTimeout(timeout);
    timers.current.clear();
    setNotices([]);
  }, []);

  useEffect(() => {
    const unsubscribe = store.subscribeScore(notice => {
      if (timers.current.size >= SHOWN_NOTICES) {
        const oldest = timers.current.keys().next().value;
        if (oldest !== undefined) {
          window.clearTimeout(timers.current.get(oldest));
          timers.current.delete(oldest);
        }
      }
      setNotices(current => [...current, notice].slice(-SHOWN_NOTICES));
      const timeout = window.setTimeout(() => {
        timers.current.delete(notice.id);
        setNotices(current => current.filter(item => item.id !== notice.id));
      }, NOTICE_MS);
      timers.current.set(notice.id, timeout);
    });
    const active = timers.current;
    return () => {
      unsubscribe();
      for (const timeout of active.values()) window.clearTimeout(timeout);
      active.clear();
    };
  }, [store]);

  return { notices, clear };
}

export function ScoreChangeNotification({ notices }: { notices: readonly ScoreChange[] }) {
  return (
    <aside className="score-notices" aria-label="得点通知" aria-live="polite" aria-relevant="additions">
      {notices.map(notice => (
        <div className="score-notice" data-negative={notice.amount < 0} key={notice.id}>
          <span>{notice.playerName}</span>
          <strong>{notice.amount < 0 ? '−' : '+'}{Math.abs(notice.amount).toLocaleString('ja-JP')} PT</strong>
        </div>
      ))}
    </aside>
  );
}
