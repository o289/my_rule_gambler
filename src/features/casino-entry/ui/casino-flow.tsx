import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { TransitionEvent } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../shared/contracts/casino-entry';
import type { Seat } from '../../../shared/contracts/casino-entry';
import type { CasinoConnection, ConnectionView } from './connection';
import type { EntranceSound } from './sound';
import { casinoAssets, entranceGems } from './casino-assets';
import { releaseDecodedImages } from './asset-loader';
import './casino.css';

export type CasinoPhase =
  | 'LOADING' | 'READY_TO_ENTER' | 'DOOR_OPENING' | 'LOAD_ERROR'
  | 'LOBBY_WAITING' | 'COUNTDOWN' | 'IN_GAME';
type EntrancePhase = Extract<CasinoPhase, 'LOADING' | 'READY_TO_ENTER' | 'DOOR_OPENING' | 'LOAD_ERROR'> | 'ENTERED';

const countdownSteps = 3;
const slots = Array.from({ length: MAX_PLAYERS }, (_, slot) => slot);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function Crest({ className }: { className: string }) {
  return <svg className={className} width="48" height="26" viewBox="0 0 48 26" fill="none" aria-hidden="true">
    <path d="M5 8 12 20h24L43 8l-12 6-7-11-7 11L5 8ZM12 23h24M24 0v5M2 7l4 2m40-2-4 2" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="m24 10 3 5-3 4-3-4 3-5Z" fill="currentColor" />
  </svg>;
}

function SeatTile({ seat, slot, playerId, hostId }: {
  seat?: Seat;
  slot: number;
  playerId: string | null;
  hostId: string | null | undefined;
}) {
  const online = seat?.online ?? false;
  const ready = online && seat?.ready;
  const state = seat ? online ? ready ? 'ready' : 'here' : 'offline' : 'empty';
  const caption = state === 'ready' ? 'READY' : state === 'here' ? '準備中' : state === 'offline' ? '再接続待ち' : '空席';
  return <div className="vip-seat" data-slot={slot + 1} data-seat={state} aria-label={`席 ${slot + 1} ${seat?.name ?? ''} ${caption}`}>
    <span className="vip-seat-marker" aria-hidden="true">
      {online ? <span className="vip-seat-chip" key={seat?.id}><span>♢</span></span> : <span className="empty-seat-number">{`0${slot + 1}`}</span>}
    </span>
    <span className="vip-seat-name" title={seat?.name}>{seat?.name ?? '空席'}</span>
    <span className="vip-seat-status">{seat ? caption : <span aria-hidden="true">·</span>}</span>
    {seat && (seat.id === playerId || seat.id === hostId) &&
      <span className="vip-seat-tags">{seat.id === playerId && <span>YOU</span>}{seat.id === hostId && <span>HOST</span>}</span>}
  </div>;
}

function CountdownChip({ deadline, offset, exiting }: { deadline: number; offset: number; exiting: boolean }) {
  const countAt = () => Math.max(1, Math.min(countdownSteps, Math.ceil((deadline - Date.now() - offset) / 1000)));
  const [count, setCount] = useState(countAt);
  useEffect(() => {
    const refresh = () => setCount(previous => Math.min(previous, countAt()));
    refresh();
    const interval = window.setInterval(refresh, 40);
    return () => window.clearInterval(interval);
  }, [deadline, offset]);
  return <div className="countdown-disc" data-exiting={exiting}>
    <div className="countdown-chip" key={count} data-count={count} role="status" aria-label={`開始まで ${count}`}>
      <span>{count}</span>
    </div>
  </div>;
}

function VipLobby({ info, room, setReady, leave, muted, soundButton, opening, deadline }: {
  info: ConnectionView;
  room: string;
  setReady: (ready: boolean) => void;
  leave: () => void;
  muted: boolean;
  soundButton: () => void;
  opening: boolean;
  deadline: number | null;
}) {
  const { lobby, playerId, status, problem, clockOffset } = info;
  const title = useRef<HTMLHeadingElement>(null);
  const joined = lobby?.seats.filter(seat => seat.online) ?? [];
  const ready = joined.filter(seat => seat.ready).length;
  const mine = joined.find(seat => seat.id === playerId);
  const message = problem || (status !== 'online' ? status === 'connecting' ? 'ルームに接続しています' : 'ルームへの再接続を待っています'
    : joined.length < MIN_PLAYERS ? 'もうひとりの参加を待っています'
      : deadline ? 'まもなくゲームが始まります' : '全員の準備が揃うとゲームが始まります');

  useEffect(() => { if (!opening) title.current?.focus({ preventScroll: true }); }, [opening]);

  return <main className="vip-lobby" id="vip-lobby" inert={opening}>
    <div className="vip-panel">
      <header className="vip-heading">
        <button className="casino-plain vip-exit" id="leave-lobby" onClick={leave}>退出</button>
        <div className="vip-title">
          <Crest className="vip-crown" />
          <h1 ref={title} tabIndex={-1}>VIP LOUNGE</h1>
          <p className="vip-room">ROOM <strong>{room}</strong></p>
        </div>
        <button className="casino-plain vip-sound" aria-pressed={!muted} aria-label={muted ? '効果音をオン' : '効果音をオフ'} onClick={soundButton}>音 {muted ? 'OFF' : 'ON'}</button>
      </header>
      <div className="vip-table-layout" aria-label="参加席">
        {slots.map(slot => <SeatTile key={slot} slot={slot} seat={lobby?.seats.find(seat => seat.slot === slot)} playerId={playerId} hostId={lobby?.hostId} />)}
        <div className="vip-table">
          <div className="vip-felt">
            {deadline !== null
              ? <CountdownChip key={deadline} deadline={deadline} offset={clockOffset} exiting={lobby?.phase === 'started'} />
              : <div className="vip-table-mark"><Crest className="table-crown" /><span>GAMBLER</span></div>}
          </div>
        </div>
      </div>
      <footer className="vip-controls">
        <div className="vip-totals" aria-live="polite"><span>{joined.length} / {MAX_PLAYERS} 名</span><i aria-hidden="true" /><span>{ready} / {joined.length} READY</span></div>
        <p className="vip-status" role="status">{message}</p>
        <button className="casino-action" id="ready-toggle" type="button" disabled={!mine || status !== 'online' || lobby?.phase === 'started'}
          aria-pressed={Boolean(mine?.ready)} onClick={() => setReady(!mine?.ready)}>
          <span>{mine?.ready ? 'READY 取消' : 'READY'}</span>
        </button>
      </footer>
    </div>
  </main>;
}

function CasinoStarted({ room, leave }: { room: string; leave: () => void }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, []);
  return <main className="vip-lobby" id="casino-started">
    <section className="vip-panel vip-completion">
      <div className="vip-title">
        <Crest className="vip-crown" />
        <h1 ref={title} tabIndex={-1}>ゲーム開始</h1>
        <p className="vip-room">ROOM <strong>{room}</strong></p>
      </div>
      <button className="casino-plain" type="button" onClick={leave}>退出</button>
    </section>
  </main>;
}

export function CasinoFlow({ connection, audio }: { connection: CasinoConnection; audio: EntranceSound }) {
  const info = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const [entrance, setEntrance] = useState<EntrancePhase>('LOADING');
  const [progress, setProgress] = useState(casinoAssets.getProgress);
  const [failed, setFailed] = useState<readonly string[]>([]);
  const [muted, setMuted] = useState(!audio.isEnabled);
  const [holdDeadline, setHoldDeadline] = useState<number | null>(null);
  const [showCompletion, setShowCompletion] = useState(false);
  const entranceRef = useRef<EntrancePhase>('LOADING');
  const alive = useRef(false);
  const loaderBusy = useRef(false);
  const soundBusy = useRef(false);
  const enterButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const focusedByExit = useRef(false);
  const gameStarted = info.lobby?.phase === 'started';
  const deadline = info.status === 'online' && info.lobby?.phase === 'countdown' ? info.lobby.startAt : null;

  function moveTo(next: EntrancePhase) {
    entranceRef.current = next;
    setEntrance(next);
  }

  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; connection.stop(); audio.cut(); };
  }, []);

  useEffect(() => { if (entrance === 'LOAD_ERROR') retryButton.current?.focus(); }, [entrance]);
  useEffect(() => {
    if (entrance !== 'READY_TO_ENTER' || !focusedByExit.current) return;
    focusedByExit.current = false;
    enterButton.current?.focus();
  }, [entrance]);

  useEffect(() => {
    if (entrance !== 'DOOR_OPENING') return;
    const timeout = window.setTimeout(finishDoor, reducedMotion() ? 0 : 1210);
    return () => window.clearTimeout(timeout);
  }, [entrance]);

  useEffect(() => {
    if (!gameStarted) {
      setShowCompletion(false);
      setHoldDeadline(deadline);
      return;
    }
    const finish = () => setShowCompletion(true);
    if (holdDeadline === null || reducedMotion()) { finish(); return; }
    const timeout = window.setTimeout(finish, 210);
    return () => window.clearTimeout(timeout);
  }, [deadline, gameStarted, holdDeadline]);

  function load() {
    if (loaderBusy.current) return;
    loaderBusy.current = true;
    moveTo('LOADING');
    void casinoAssets.run(value => { if (alive.current) setProgress(value); }).then(errors => {
      loaderBusy.current = false;
      if (!alive.current) return;
      setFailed(errors);
      if (errors.length) {
        moveTo('LOAD_ERROR');
        return;
      }
      releaseDecodedImages();
      if (connection.hasSession()) {
        moveTo('ENTERED');
        connection.start();
      } else moveTo('READY_TO_ENTER');
    }).catch(() => {
      loaderBusy.current = false;
      if (!alive.current) return;
      setFailed(['読み込み']);
      moveTo('LOAD_ERROR');
    });
  }

  function enter() {
    if (entranceRef.current !== 'READY_TO_ENTER') return;
    moveTo('DOOR_OPENING');
    audio.playDoor();
    connection.start();
    if (reducedMotion()) finishDoor();
  }

  function finishDoor() {
    if (entranceRef.current === 'DOOR_OPENING') moveTo('ENTERED');
  }

  function doorTransition(event: TransitionEvent<HTMLDivElement>) {
    if (event.currentTarget === event.target && event.propertyName === 'transform') finishDoor();
  }

  function leave() {
    connection.exit();
    audio.cut();
    setShowCompletion(false);
    setHoldDeadline(null);
    focusedByExit.current = true;
    moveTo('READY_TO_ENTER');
  }

  async function toggleSound() {
    if (soundBusy.current) return;
    soundBusy.current = true;
    try { setMuted(!(await audio.enable(muted))); }
    catch { setMuted(true); }
    finally { soundBusy.current = false; }
  }

  if (entrance === 'ENTERED' && showCompletion) return <div className="casino-flow" data-phase="IN_GAME">
    <CasinoStarted room={connection.room} leave={leave} />
  </div>;

  const opening = entrance === 'DOOR_OPENING';
  const entered = entrance === 'ENTERED';
  const phase: CasinoPhase = entered ? deadline || gameStarted ? 'COUNTDOWN' : 'LOBBY_WAITING' : entrance;
  const percent = Math.floor(progress.loaded * 100 / progress.total);

  return <div className="casino-flow" data-phase={phase}>
    {(opening || entered) && <VipLobby info={info} room={connection.room} setReady={ready => connection.setReady(ready)}
      leave={leave} muted={muted} soundButton={toggleSound} opening={opening} deadline={gameStarted ? holdDeadline : deadline} />}
    {!entered && <main className="casino-entrance" id="casino-entrance" data-opening={opening} inert={opening}>
      <div className="casino-hinge" aria-hidden="true">
        <div className="casino-door casino-door--left" />
        <div className="casino-door casino-door--right" onTransitionEnd={doorTransition} />
      </div>
      <div className="casino-entrance-ui">
        <div className="casino-lockup">
          <Crest className="casino-crest" />
          <h1>GAMBLER</h1>
          <div className="casino-gems" aria-hidden="true">
            {entranceGems.map(gem => <img src={gem.image} alt="" key={gem.id} draggable={false} />)}
          </div>
        </div>
        <div className="casino-entrance-controls">
          {entrance === 'READY_TO_ENTER' && <>
            <button ref={enterButton} className="casino-action casino-enter" id="enter-casino" onClick={enter}><span>ENTER CASINO</span></button>
            <p className="entrance-completion" role="status">ロード完了 <span>100%</span></p>
          </>}
          {entrance === 'LOADING' && <div className="casino-progress">
            <div aria-hidden="true"><span>読み込み中</span><span>{progress.loaded} / {progress.total} · {percent}%</span></div>
            <progress id="casino-progress" aria-label={`素材を読み込み中 ${progress.loaded} / ${progress.total}`} value={progress.loaded} max={progress.total} />
          </div>}
          {entrance === 'LOAD_ERROR' && <div className="casino-load-error">
            <p role="alert">{failed.length}件の素材を読み込めませんでした（{percent}%）。</p>
            <button className="casino-action" ref={retryButton} id="retry-assets" onClick={load}><span>再試行</span></button>
          </div>}
        </div>
        <button className="casino-plain entrance-sound" aria-pressed={!muted} aria-label={muted ? '効果音をオン' : '効果音をオフ'}
          onClick={toggleSound}>音 {muted ? 'OFF' : 'ON'}</button>
      </div>
    </main>}
  </div>;
}
