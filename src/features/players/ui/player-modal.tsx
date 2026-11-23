import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, Ref, RefObject } from 'react';
import { rankPlayers } from '../model/player-data';
import type { PlayerSnapshot } from '../model/player-data';
import { CrownIcon, ChevronIcon } from './vip-icons';
import { PlayerDetail, PlayerList } from './player-panels';

const MODAL_MS = 420;
const TRANSFER_MS = 355;
type Phase = 'closed' | 'opening' | 'open' | 'closing';

interface Transfer {
  readonly to: 'detail' | 'list';
  readonly id: string;
  readonly first: DOMRect;
}

export interface PlayerModalHandle {
  open(): void;
  close(): void;
}

interface ModalProps {
  snapshot: PlayerSnapshot;
  opener: RefObject<HTMLButtonElement | null>;
  ref?: Ref<PlayerModalHandle>;
  onVisibilityChange: (visible: boolean) => void;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function PlayerInfoModal({ snapshot, opener, ref, onVisibilityChange }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const phase = useRef<Phase>('closed');
  const transition = useRef<Animation | null>(null);
  const pending = useRef<Transfer | null>(null);
  const switching = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const savedScroll = useRef(0);
  const [displayPhase, setDisplayPhase] = useState<Phase>('closed');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = snapshot.players.find(player => player.id === selectedId);
  const style: CSSProperties & { '--player-count': number } = { '--player-count': snapshot.players.length };

  function movePhase(next: Phase) {
    phase.current = next;
    setDisplayPhase(next);
  }

  function stopTransfer() {
    if (transition.current) {
      transition.current.onfinish = null;
      transition.current.cancel();
      transition.current = null;
    }
    pending.current = null;
    switching.current = false;
  }

  function close() {
    const panel = dialog.current;
    if (!panel?.open || phase.current === 'closing') return;
    window.clearTimeout(timer.current);
    stopTransfer();
    movePhase('closing');
    if (reducedMotion()) panel.close();
    else timer.current = window.setTimeout(() => panel.close(), MODAL_MS);
  }

  useImperativeHandle(ref, () => ({
    close,
    open() {
      const panel = dialog.current;
      if (!panel || panel.open || phase.current !== 'closed') return;
      savedScroll.current = 0;
      if (viewport.current) viewport.current.scrollTop = 0;
      const instant = reducedMotion();
      movePhase(instant ? 'open' : 'opening');
      panel.showModal();
      onVisibilityChange(true);
      closeButton.current?.focus({ preventScroll: true });
      if (!instant) timer.current = window.setTimeout(() => movePhase('open'), MODAL_MS);
    },
  }), [onVisibilityChange]);

  useEffect(() => () => {
    window.clearTimeout(timer.current);
    if (transition.current) {
      transition.current.onfinish = null;
      transition.current.cancel();
    }
  }, []);

  function closed() {
    if (dialog.current?.open) return;
    window.clearTimeout(timer.current);
    stopTransfer();
    movePhase('closed');
    setSelectedId(null);
    onVisibilityChange(false);
    opener.current?.focus({ preventScroll: true });
  }

  function select(id: string, card: HTMLButtonElement) {
    if (phase.current !== 'open' || switching.current) return;
    savedScroll.current = viewport.current?.scrollTop ?? 0;
    pending.current = { to: 'detail', id, first: card.getBoundingClientRect() };
    switching.current = true;
    setSelectedId(id);
  }

  function back() {
    const detail = viewport.current?.querySelector('.vip-member-card');
    if (!selected || !detail || phase.current !== 'open' || switching.current) return;
    pending.current = { to: 'list', id: selected.id, first: detail.getBoundingClientRect() };
    switching.current = true;
    setSelectedId(null);
  }

  useLayoutEffect(() => {
    const body = viewport.current;
    if (!body || !dialog.current?.open || phase.current === 'closing') return;
    if (selectedId && !selected) {
      stopTransfer();
      setSelectedId(null);
      closeButton.current?.focus({ preventScroll: true });
      return;
    }

    const transfer = pending.current;
    if (!transfer) return;
    pending.current = null;
    const toDetail = transfer.to === 'detail';
    body.scrollTop = toDetail ? 0 : savedScroll.current;
    const selector = toDetail ? '.vip-member-card' : `[data-player-id="${CSS.escape(transfer.id)}"]`;
    const card = body.querySelector<HTMLElement>(selector);
    const restoreFocus = () => {
      if (phase.current !== 'open') return;
      if (toDetail) backButton.current?.focus({ preventScroll: true });
      else (card ?? closeButton.current)?.focus({ preventScroll: true });
    };
    if (!card || reducedMotion()) {
      switching.current = false;
      restoreFocus();
      return;
    }

    if (toDetail) restoreFocus();
    else closeButton.current?.focus({ preventScroll: true });
    const last = card.getBoundingClientRect();
    const { first } = transfer;
    const x = first.left - last.left;
    const y = first.top - last.top;
    const width = first.width / Math.max(1, last.width);
    const height = first.height / Math.max(1, last.height);
    const motion = card.animate([
      { transform: `translate(${x}px,${y}px) scale(${width},${height})`, transformOrigin: 'top left', opacity: .68 },
      { offset: .69, opacity: 1, transformOrigin: 'top left' },
      { transform: 'translate(0,0) scale(1)', transformOrigin: 'top left', opacity: 1 },
    ], { duration: TRANSFER_MS, easing: 'cubic-bezier(.2,.73,.24,1)' });
    transition.current = motion;
    motion.onfinish = () => {
      if (transition.current !== motion) return;
      transition.current = null;
      switching.current = false;
      if (!toDetail) restoreFocus();
    };
  }, [selectedId, selected]);

  const rank = selected ? rankPlayers(snapshot.players).get(selected.id) : undefined;

  return (
    <dialog id="vip-players-dialog" className="vip-dialog" ref={dialog} data-phase={displayPhase}
      style={style} aria-labelledby="vip-dialog-title"
      onCancel={event => { event.preventDefault(); close(); }} onClose={closed}>
      <div className="vip-shell">
        <div className="vip-frame" aria-hidden="true" />
        <div className="frame-sweep" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="frame-origin" aria-hidden="true" />
        <header className="vip-toolbar">
          <div className="vip-toolbar-side">
            {selected && <button type="button" className="vip-quiet icon-back" ref={backButton} onClick={back}><ChevronIcon back />戻る</button>}
          </div>
          <div className="vip-toolbar-title">
            <CrownIcon />
            <h2 id="vip-dialog-title" lang="en">VIP PLAYERS</h2>
            {!selected && <span>手番順</span>}
          </div>
          <button type="button" className="vip-quiet vip-close" ref={closeButton} aria-label="閉じる" onClick={close}><span aria-hidden="true">×</span><span>閉じる</span></button>
        </header>
        <div ref={viewport} className="vip-content" data-view={selected ? 'detail' : 'list'}>
          {selected ? <PlayerDetail
            player={selected} rank={rank}
            current={selected.id === snapshot.currentTurnId} turnVersion={snapshot.turnVersion} you={selected.id === snapshot.youId}
          /> : <PlayerList snapshot={snapshot} onSelect={select} />}
        </div>
      </div>
    </dialog>
  );
}
