import { useAudioActivation } from '../../../shared/audio/use-audio-activation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../shared/contracts/casino-entry';
import type { CasinoRoomInfo, Seat } from '../../../shared/contracts/casino-entry';
import type { Admission, CasinoRoomTransport, ConnectionView } from './connection';
import { CasinoDoors, DOOR_FALLBACK_MS, RoomDoor, ROOM_UNLOCK_MS } from './casino-doors';
import { RoomChooser } from './room-chooser';
import type { RoomAction, RoomProblem } from './room-chooser';
import { casinoAssets, entranceGems } from './casino-assets';
import { releaseDecodedImages } from './asset-loader';
import './casino.css';

export type CasinoPhase =
  | 'LOADING' | 'READY_TO_ENTER' | 'DOOR_OPENING' | 'LOAD_ERROR' | 'RESTORING'
  | 'ROOM_SELECT' | 'ROOM_CONNECTING' | 'ROOM_UNLOCKING' | 'ROOM_OPENING' | 'ROOM_CLOSING'
  | 'LOBBY_WAITING' | 'COUNTDOWN' | 'IN_GAME';
type Scene = Exclude<CasinoPhase, 'LOBBY_WAITING' | 'COUNTDOWN' | 'IN_GAME'> | 'ENTERED';

interface CasinoSound {
  unlock(): void;
  cut(): void;
  playDoor(): void;
  playLatch(): void;
  playClose(): void;
}

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

function VipLobby({ info, room, setReady, leave, blocked, deadline }: {
  info: ConnectionView;
  room: CasinoRoomInfo;
  setReady: (ready: boolean) => void;
  leave: () => void;
  blocked: boolean;
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

  useEffect(() => { if (!blocked) title.current?.focus({ preventScroll: true }); }, [blocked]);

  return <main className="vip-lobby" id="vip-lobby" inert={blocked}>
    <div className="vip-panel">
      <header className="vip-heading">
        <button className="casino-plain vip-exit" id="leave-lobby" onClick={leave}>退出</button>
        <div className="vip-title">
          <Crest className="vip-crown" />
          <h1 ref={title} tabIndex={-1}>VIP LOUNGE</h1>
          <RoomIdentity room={room} />
        </div>
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

function RoomIdentity({ room }: { room: CasinoRoomInfo }) {
  return <div className="vip-room">
    <strong>{room.name}</strong>
    <span>ルームID <code id="lobby-room-id">{room.id.toUpperCase()}</code></span>
  </div>;
}

function CasinoStarted({ room, players, leave, blocked }: { room: CasinoRoomInfo; players: readonly Seat[]; leave: () => void; blocked: boolean }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (!blocked) title.current?.focus({ preventScroll: true }); }, [blocked]);
  return <main className="vip-lobby" id="casino-started" inert={blocked}>
    <section className="vip-panel vip-completion">
      <div className="vip-title">
        <Crest className="vip-crown" />
        <h1 ref={title} tabIndex={-1}>ゲーム開始</h1>
        <RoomIdentity room={room} />
      </div>
      <ol className="casino-start-order" aria-label="開始時の座席順">
        {players.map((player, index) => <li key={player.id}>
          <span>{String(index + 1).padStart(2, '0')}</span>{player.name}
        </li>)}
      </ol>
      <button className="casino-plain" type="button" onClick={leave}>退出</button>
    </section>
  </main>;
}

export function CasinoFlow({ connection, audio, invitedRoom, onRoomChanged }: {
  connection: CasinoRoomTransport;
  audio: CasinoSound;
  invitedRoom?: string;
  onRoomChanged?: (roomId: string | null) => void;
}) {
  useAudioActivation(audio.unlock);
  const info = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const [scene, setScene] = useState<Scene>('LOADING');
  const [progress, setProgress] = useState(casinoAssets.getProgress);
  const [failed, setFailed] = useState<readonly string[]>([]);
  const [roomProblem, setRoomProblem] = useState<RoomProblem | null>(null);
  const [roomPending, setRoomPending] = useState<RoomAction | null>(null);
  const [departing, setDeparting] = useState<ConnectionView | null>(null);
  const [holdDeadline, setHoldDeadline] = useState<number | null>(null);
  const [showCompletion, setShowCompletion] = useState(false);
  const sceneRef = useRef<Scene>('LOADING');
  const alive = useRef(false);
  const loaderBusy = useRef(false);
  const retryButton = useRef<HTMLButtonElement>(null);
  const gameStarted = info.lobby?.phase === 'started';
  const deadline = info.status === 'online' && info.lobby?.phase === 'countdown' ? info.lobby.startAt : null;

  function moveTo(next: Scene) {
    sceneRef.current = next;
    setScene(next);
  }

  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; connection.stop(); audio.cut(); };
  }, []);

  useEffect(() => { if (scene === 'LOAD_ERROR') retryButton.current?.focus(); }, [scene]);

  useEffect(() => {
    if (scene === 'ROOM_UNLOCKING') {
      const timer = window.setTimeout(() => {
        if (sceneRef.current !== 'ROOM_UNLOCKING') return;
        audio.playDoor();
        moveTo('ROOM_OPENING');
      }, reducedMotion() ? 0 : ROOM_UNLOCK_MS);
      return () => window.clearTimeout(timer);
    }
    if (scene !== 'DOOR_OPENING' && scene !== 'ROOM_OPENING' && scene !== 'ROOM_CLOSING') return;
    const timer = window.setTimeout(finishDoor, reducedMotion() ? 0 : DOOR_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [scene, audio]);

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
      const restoration = connection.restore(invitedRoom);
      if (restoration) {
        moveTo('RESTORING');
        void resolveAdmission('join', restoration, true);
      } else moveTo('READY_TO_ENTER');
    }).catch(() => {
      loaderBusy.current = false;
      if (!alive.current) return;
      setFailed(['読み込み']);
      moveTo('LOAD_ERROR');
    });
  }

  function enter() {
    if (sceneRef.current !== 'READY_TO_ENTER') return;
    moveTo('DOOR_OPENING');
    audio.playDoor();
  }

  function openRoom(action: RoomAction, input: string) {
    if (sceneRef.current !== 'ROOM_SELECT') return;
    setRoomProblem(null);
    setRoomPending(action);
    moveTo('ROOM_CONNECTING');
    const request = action === 'create' ? connection.create(input) : connection.join(input);
    void resolveAdmission(action, request, false);
  }

  async function resolveAdmission(action: RoomAction, request: Promise<Admission>, restoring: boolean) {
    const result = await request.catch(() => ({ ok: false as const, problem: 'ルームに接続できませんでした。' }));
    if (!alive.current || sceneRef.current !== (restoring ? 'RESTORING' : 'ROOM_CONNECTING')) return;
    setRoomPending(null);
    if (!result.ok) {
      setRoomProblem({ action, message: result.problem });
      moveTo('ROOM_SELECT');
      return;
    }
    onRoomChanged?.(result.room.id);
    if (restoring) {
      moveTo('ENTERED');
      return;
    }
    audio.cut();
    audio.playLatch();
    moveTo('ROOM_UNLOCKING');
  }

  function finishDoor() {
    if (sceneRef.current === 'DOOR_OPENING') moveTo('ROOM_SELECT');
    else if (sceneRef.current === 'ROOM_OPENING') moveTo('ENTERED');
    else if (sceneRef.current === 'ROOM_CLOSING') {
      setDeparting(null);
      moveTo('ROOM_SELECT');
    }
  }

  function leave() {
    if (sceneRef.current !== 'ENTERED') return;
    setDeparting(info);
    moveTo('ROOM_CLOSING');
    connection.exit();
    onRoomChanged?.(null);
    audio.cut();
    audio.playClose();
    setShowCompletion(false);
    setHoldDeadline(null);
  }

  const opening = scene === 'DOOR_OPENING';
  const entered = scene === 'ENTERED';
  const motion = scene === 'ROOM_UNLOCKING' ? 'unlocking' : scene === 'ROOM_OPENING' ? 'opening' : scene === 'ROOM_CLOSING' ? 'closing' : null;
  const roomView = motion === 'closing' ? departing : info;
  const showLobby = Boolean(roomView?.room && (entered || motion));
  const finished = Boolean(roomView?.lobby?.phase === 'started' && (showCompletion || motion === 'closing'));
  const phase: CasinoPhase = entered ? showCompletion ? 'IN_GAME' : deadline || gameStarted ? 'COUNTDOWN' : 'LOBBY_WAITING' : scene;
  const percent = Math.floor(progress.loaded * 100 / progress.total);

  return <div className="casino-flow" data-phase={phase}>
    {(opening || scene === 'ROOM_SELECT' || scene === 'ROOM_CONNECTING') &&
      <RoomChooser invitedRoom={invitedRoom} pending={roomPending} problem={roomProblem} blocked={opening} submit={openRoom} />}
    {showLobby && roomView?.room && (finished
      ? <CasinoStarted room={roomView.room} players={roomView.lobby?.startedPlayers ?? []} leave={leave} blocked={!entered} />
      : <VipLobby info={roomView} room={roomView.room} setReady={ready => connection.setReady(ready)}
          leave={leave} blocked={!entered} deadline={gameStarted ? holdDeadline : deadline} />)}
    {motion && <RoomDoor motion={motion} onComplete={finishDoor} />}
    {(opening || scene === 'LOADING' || scene === 'LOAD_ERROR' || scene === 'RESTORING' || scene === 'READY_TO_ENTER') &&
      <main className="casino-entrance" id="casino-entrance" data-opening={opening} inert={opening}>
        <CasinoDoors open={opening} onComplete={finishDoor} />
        <div className="casino-entrance-ui">
          <div className="casino-lockup">
            <Crest className="casino-crest" />
            <h1>GAMBLER</h1>
            <div className="casino-gems" aria-hidden="true">
              {entranceGems.map(gem => <img src={gem.image} alt="" key={gem.id} draggable={false} />)}
            </div>
          </div>
          <div className="casino-entrance-controls">
            {scene === 'READY_TO_ENTER' && <>
              <button className="casino-action casino-enter" id="enter-casino" onClick={enter}><span>ENTER CASINO</span></button>
              <p className="entrance-completion" role="status">ロード完了 <span>100%</span></p>
            </>}
            {scene === 'RESTORING' && <p className="entrance-completion" role="status">ルームへ再接続しています…</p>}
            {scene === 'LOADING' && <div className="casino-progress">
              <div aria-hidden="true"><span>読み込み中</span><span>{progress.loaded} / {progress.total} · {percent}%</span></div>
              <progress id="casino-progress" aria-label={`素材を読み込み中 ${progress.loaded} / ${progress.total}`} value={progress.loaded} max={progress.total} />
            </div>}
            {scene === 'LOAD_ERROR' && <div className="casino-load-error">
              <p role="alert">{failed.length}件の素材を読み込めませんでした（{percent}%）。</p>
              <button className="casino-action" ref={retryButton} id="retry-assets" onClick={load}><span>再試行</span></button>
            </div>}
          </div>
        </div>
      </main>}
  </div>;
}
