import { useAudioActivation } from '../../../shared/audio/use-audio-activation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../shared/contracts/casino-entry';
import type { CasinoRoomInfo, Seat } from '../../../shared/contracts/casino-entry';
import { DEFAULT_GAME_RULES, STARTING_DICE_OPTIONS, VICTORY_POINT_OPTIONS } from '../../../shared/contracts/game-rules';
import type { GameRules } from '../../../shared/contracts/game-rules';
import type { Admission, CasinoRoomTransport, ConnectionView } from './connection';
import { CasinoDoors, DOOR_FALLBACK_MS, RoomDoor, ROOM_UNLOCK_MS } from './casino-doors';
import { RoomChooser } from './room-chooser';
import type { RoomAction, RoomProblem } from './room-chooser';
import { casinoAssets, entranceGems } from './casino-assets';
import { releaseDecodedImages } from './asset-loader';
import { CrownIcon } from '../../players/ui/vip-icons';
import { RulebookDialog } from '../../rulebook/ui/rulebook-dialog';
import '../../players/ui/style.css';
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

function CountdownChip({ deadline, offset }: { deadline: number; offset: number }) {
  const countAt = () => Math.max(1, Math.min(countdownSteps, Math.ceil((deadline - Date.now() - offset) / 1000)));
  const [count, setCount] = useState(countAt);
  useEffect(() => {
    const refresh = () => setCount(previous => Math.min(previous, countAt()));
    refresh();
    const interval = window.setInterval(refresh, 40);
    return () => window.clearInterval(interval);
  }, [deadline, offset]);
  return <div className="countdown-disc">
    <div className="countdown-chip" key={count} data-count={count} role="status" aria-label={`開始まで ${count}`}>
      <span>{count}</span>
    </div>
  </div>;
}

export function VipLobby({ info, room, setReady, setRules, leave, blocked, deadline, enteringGame }: {
  info: ConnectionView;
  room: CasinoRoomInfo;
  setReady: (ready: boolean) => void;
  setRules?: (rules: GameRules, rulesRevision: number) => void;
  leave: () => void;
  blocked: boolean;
  deadline: number | null;
  enteringGame: boolean;
}) {
  const { lobby, playerId, status, problem, clockOffset } = info;
  const title = useRef<HTMLHeadingElement>(null);
  const joined = lobby?.seats.filter(seat => seat.online) ?? [];
  const ready = joined.filter(seat => seat.ready).length;
  const mine = joined.find(seat => seat.id === playerId);
  const canConfigureRules = Boolean(mine && mine.id === lobby?.hostId && lobby.phase === 'waiting' && setRules);
  const showRulesButton = Boolean(lobby && lobby.phase === 'waiting' && ready < joined.length);
  const [rulesOpen, setRulesOpen] = useState(false);
  const rulesButton = useRef<HTMLButtonElement>(null);
  const message = problem || (status !== 'online' ? status === 'connecting' ? 'ルームに接続しています' : 'ルームへの再接続を待っています'
    : enteringGame ? '対戦を読み込んでいます…'
      : lobby?.phase === 'started' ? 'このルームの対戦はすでに始まっています'
      : joined.length < MIN_PLAYERS ? 'もうひとりの参加を待っています'
      : deadline ? 'まもなくゲームが始まります' : '全員の準備が揃うとゲームが始まります');

  useEffect(() => { if (!blocked) title.current?.focus({ preventScroll: true }); }, [blocked]);

  return <main className="vip-lobby" id="vip-lobby" inert={blocked}>
    <div className="vip-panel">
      <header className="vip-heading">
        <button className="casino-plain vip-exit" id="leave-lobby" disabled={enteringGame} onClick={leave}>退出</button>
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
              ? <CountdownChip key={deadline} deadline={deadline} offset={clockOffset} />
              : <div className="vip-table-mark"><Crest className="table-crown" /><span>GAMBLER</span>
                {(showRulesButton || rulesOpen) && <button ref={rulesButton} type="button" className="vip-table-rules" aria-haspopup="dialog"
                  aria-expanded={rulesOpen} aria-controls="room-rules-dialog" disabled={blocked || !showRulesButton}
                  onClick={() => { if (!blocked && showRulesButton) setRulesOpen(true); }}>ルール設定</button>}
              </div>}
          </div>
        </div>
      </div>
      <footer className="vip-controls">
        <div className="vip-totals" aria-live="polite"><span>{joined.length} / {MAX_PLAYERS} 名</span><i aria-hidden="true" /><span>{ready} / {joined.length} READY</span></div>
        <p className="vip-status" role="status">{message}</p>
        {!blocked && !enteringGame && <RulebookDialog disabled={rulesOpen} />}
        <button className="casino-action" id="ready-toggle" type="button" disabled={!mine || status !== 'online' || lobby?.phase === 'started'}
          aria-pressed={Boolean(mine?.ready)} onClick={() => setReady(!mine?.ready)}>
          <span>{mine?.ready ? 'READY 取消' : 'READY'}</span>
        </button>
      </footer>
    </div>
    {lobby && <RoomRulesDialog lobby={lobby} open={!blocked && rulesOpen} canEdit={canConfigureRules}
      opener={rulesButton} onClose={() => setRulesOpen(false)} onSave={setRules} />}
  </main>;
}

function RoomRulesDialog({ lobby, open, canEdit, opener, onClose, onSave }: {
  lobby: NonNullable<ConnectionView['lobby']>;
  open: boolean;
  canEdit: boolean;
  opener: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSave?: (rules: GameRules, rulesRevision: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const editRevision = useRef(lobby.rulesRevision);
  const [phase, setPhase] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const [draft, setDraft] = useState<GameRules>(lobby.rules ?? DEFAULT_GAME_RULES);
  const dialogStyle: CSSProperties & { '--player-count': number } = { '--player-count': 2 };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (!open || !dialog.current || dialog.current.open) return;
    setDraft(lobby.rules ?? DEFAULT_GAME_RULES);
    editRevision.current = lobby.rulesRevision;
    const instant = reduced();
    dialog.current.showModal();
    setPhase(instant ? 'open' : 'opening');
    saveButton.current?.focus({ preventScroll: true });
    if (!instant) timer.current = window.setTimeout(() => setPhase('open'), 420);
  }, [open, lobby.rules]);

  useEffect(() => {
    if (!open || !dialog.current?.open || editRevision.current === lobby.rulesRevision) return;
    editRevision.current = lobby.rulesRevision;
    setDraft(lobby.rules ?? DEFAULT_GAME_RULES);
  }, [open, lobby.rules, lobby.rulesRevision]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function close() {
    window.clearTimeout(timer.current);
    if (!dialog.current?.open) { onClose(); return; }
    if (reduced()) { dialog.current.close(); return; }
    setPhase('closing');
    timer.current = window.setTimeout(() => dialog.current?.close(), 420);
  }

  function finish() {
    window.clearTimeout(timer.current);
    setPhase('closed');
    onClose();
    opener.current?.focus({ preventScroll: true });
  }

  function save() {
    if (canEdit && lobby.phase === 'waiting' && onSave && editRevision.current === lobby.rulesRevision) {
      onSave(draft, editRevision.current);
    }
    close();
  }

  return <dialog id="room-rules-dialog" className="vip-dialog rules-dialog" ref={dialog} data-phase={phase}
    style={dialogStyle} aria-labelledby="room-rules-title"
    onCancel={event => { event.preventDefault(); close(); }} onClose={finish}>
    <div className="vip-shell">
      <div className="vip-frame" aria-hidden="true" />
      <div className="frame-sweep" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="frame-origin" aria-hidden="true" />
      <header className="vip-toolbar">
        <span />
        <div className="vip-toolbar-title"><CrownIcon /><h2 id="room-rules-title" lang="en">VIP PLAYER</h2><span>ルール設定</span></div>
        <button type="button" className="vip-quiet vip-close" onClick={close}><span aria-hidden="true">×</span><span>閉じる</span></button>
      </header>
      <div className="vip-content rules-content">
        <label className="rule-option"><span>勝利点</span>
          <select value={canEdit ? draft.victoryPoints : lobby.rules.victoryPoints} disabled={!canEdit || lobby.phase !== 'waiting'}
            onChange={event => {
              const points = VICTORY_POINT_OPTIONS.find(option => String(option) === event.currentTarget.value);
              if (points !== undefined) setDraft(previous => ({ ...previous, victoryPoints: points }));
            }}>
            {VICTORY_POINT_OPTIONS.map(points => <option key={points} value={points}>{points.toLocaleString('ja-JP')}点</option>)}
          </select>
        </label>
        <label className="rule-option"><span>初期配置サイコロ数</span>
          <select value={canEdit ? draft.startingDice : lobby.rules.startingDice} disabled={!canEdit || lobby.phase !== 'waiting'}
            onChange={event => {
              const value = event.currentTarget.value;
              const count = STARTING_DICE_OPTIONS.find(option => String(option) === value);
              if (count !== undefined) setDraft(previous => ({ ...previous, startingDice: count }));
            }}>
            {STARTING_DICE_OPTIONS.map(count => <option key={count} value={count}>{count === 'official' ? '公式ルール' : `${count}個`}</option>)}
          </select>
        </label>
        <p className="rules-note" role="status">{canEdit ? 'ルールを保存すると、全員のREADYが解除されます。' : 'ホストが設定したルールを確認できます。'}</p>
        {lobby.phase === 'countdown' && <p className="rules-note">開始カウントダウン中は設定を変更できません。</p>}
        <div className="rules-actions">
          <button type="button" className="vip-quiet" onClick={close}>戻る</button>
          {canEdit && <button ref={saveButton} type="button" className="casino-action"
            disabled={lobby.phase !== 'waiting'} onClick={save}><span>保存</span></button>}
        </div>
      </div>
    </div>
  </dialog>;
}

function RoomIdentity({ room }: { room: CasinoRoomInfo }) {
  return <div className="vip-room">
    <strong>{room.name}</strong>
    <span>ルームID <code id="lobby-room-id">{room.id.toUpperCase()}</code></span>
  </div>;
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
  const sceneRef = useRef<Scene>('LOADING');
  const enteringRoom = useRef<string | null>(null);
  const alive = useRef(false);
  const loaderBusy = useRef(false);
  const retryButton = useRef<HTMLButtonElement>(null);
  const entered = scene === 'ENTERED';
  const gameRoomId = info.status === 'online' && info.lobby?.phase === 'started'
    && info.lobby.startedPlayers?.some(player => player.id === info.playerId) ? info.room?.id : undefined;
  const enteringGame = entered && gameRoomId !== undefined;
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
    if (!entered || !gameRoomId || enteringRoom.current === gameRoomId) return;
    enteringRoom.current = gameRoomId;
    window.location.replace(`/?game=dice&room=${encodeURIComponent(gameRoomId)}`);
  }, [entered, gameRoomId]);

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
  }

  const opening = scene === 'DOOR_OPENING';
  const motion = scene === 'ROOM_UNLOCKING' ? 'unlocking' : scene === 'ROOM_OPENING' ? 'opening' : scene === 'ROOM_CLOSING' ? 'closing' : null;
  const roomView = motion === 'closing' ? departing : info;
  const showLobby = Boolean(roomView?.room && (entered || motion));
  const phase: CasinoPhase = entered ? enteringGame ? 'IN_GAME' : deadline !== null ? 'COUNTDOWN' : 'LOBBY_WAITING' : scene;
  const percent = Math.floor(progress.loaded * 100 / progress.total);

  return <div className="casino-flow" data-phase={phase}>
    {(opening || scene === 'ROOM_SELECT' || scene === 'ROOM_CONNECTING') &&
      <RoomChooser invitedRoom={invitedRoom} pending={roomPending} problem={roomProblem} blocked={opening} submit={openRoom} />}
    {showLobby && roomView?.room && <VipLobby info={roomView} room={roomView.room} setReady={ready => connection.setReady(ready)}
          setRules={(rules, revision) => connection.setRules(rules, revision)}
      leave={leave} blocked={!entered} deadline={deadline} enteringGame={enteringGame} />}
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
              <RulebookDialog />
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
