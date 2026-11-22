import { useAudioActivation } from '../../../shared/audio/use-audio-activation';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { GamblerBoard } from '../../board/ui/GamblerBoard';
import type { BoardDefinition, BoardState, CellAddress } from '../../board/model/board-model';
import { GEMS } from '../../board/model/gems';
import '../../board/ui/style.css';
import type { GemId } from '../model/geometry';
import type { DiceResult, GameState, RollView } from '../../../shared/contracts/dice';
import { DiceConnection } from './connection';
import type { ConnectionView } from './connection';
import { PerformanceMonitor } from './monitor';
import { DiceSound } from './sound';
import { preloadDice } from './face-canvases';
import './style.css';


const loadTray = () => import('./3d/tray-scene');
const TrayScene = lazy(loadTray);

export interface DiceBoardContext {
  game: GameState | null;
  roll: RollView | null;
  selected: DiceResult | undefined;
  canAct: boolean;
  inPlacement: boolean;
  board: BoardState;
}

export interface DiceBoardAdapter {
  definition: BoardDefinition;
  createState: (game: GameState | null, active: DiceResult | undefined) => BoardState;
  onSelect: (cell: CellAddress, context: DiceBoardContext) => void;
}

function DiceIcon({ gem }: { gem: GemId }) {
  return <img src={GEMS[gem].image} alt="" draggable={false} />;
}

function ResultStrip({ list, action, chosen, remaining }: {
  list: readonly DiceResult[];
  action?: (id: string) => void;
  chosen?: string;
  remaining?: readonly string[];
}) {
  return <ol className="results-strip" aria-label="確定した出目">
    {list.map((result, index) => {
      const datum = <><span className="result-icon"><DiceIcon gem={result.gem} /></span>
        <span className="result-name">{GEMS[result.gem].name}</span></>;
      return <li key={result.id} data-gem={result.gem} data-die-id={result.id} aria-label={`${index + 1}番、${GEMS[result.gem].name}`}>
        {action ? <button type="button" onClick={() => action(result.id)} aria-pressed={chosen === result.id}
          disabled={!remaining?.includes(result.id)} className="result-choice">{datum}</button>
          : <div className="result-tile">{datum}</div>}
      </li>;
    })}
  </ol>;
}

function TrayDialog({ info, setFps, children, onClose, focusTarget, stream, onCup }: {
  info: ConnectionView;
  setFps: (fps: number | null) => void;
  children: ReactNode;
  onClose: (id: string) => void;
  focusTarget: () => HTMLElement | null;
  stream: DiceConnection['frames'];
  onCup: () => void;
}) {
  const shell = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const lastRoll = useRef<RollView | null>(null);
  const open = Boolean(info.tray);
  useLayoutEffect(() => {
    const dialog = shell.current;
    if (!dialog) return;
    window.clearTimeout(timer.current);
    if (open) {
      if (!dialog.open) dialog.showModal();
      dialog.dataset.motion = 'open';
      setVisible(true);
    } else if (dialog.open) {
      dialog.dataset.motion = 'close';
      const finish = () => {
        dialog.close();
        setVisible(false);
        setFps(null);
        focusTarget()?.focus({ preventScroll: true });
      };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
      else timer.current = window.setTimeout(finish, 350);
    }
    return () => window.clearTimeout(timer.current);
  }, [open, setFps, focusTarget]);

  useLayoutEffect(() => { if (info.roll) lastRoll.current = info.roll; }, [info.roll]);

  const roll = info.roll ?? lastRoll.current;
  const ready = Boolean(roll?.results.length);
  const label = ready ? '出目が確定しました' : roll?.kind === 'reroll' ? '残ったダイスを振り直しています' : 'ダイスを振っています';
  return <dialog className="tray-dialog" id="dice-tray" ref={shell} aria-labelledby="tray-title"
    onCancel={event => event.preventDefault()}>
    {visible && roll && <>
      <div className="tray-box">
        <header className="tray-heading">
          <div><span className="salon-legend">ATELIER NOIR</span><h2 id="tray-title">DICE TRAY</h2></div>
          <span className="tray-status" role="status">{info.status !== 'online' ? '接続を再開しています…' : label}</span>
        </header>
        <Suspense fallback={<div className="tray-visual"><p className="tray-problem">3Dトレイを準備しています…</p></div>}>
          <TrayScene stream={stream} roll={roll} onFps={setFps} onCup={onCup} />
        </Suspense>
        <div className="tray-result" data-settled={ready}>
          {ready ? <ResultStrip list={roll.results} /> : <p>すべてのダイスが止まると出目が表示されます。</p>}
        </div>
        <div className="tray-actions">
          <button type="button" id="confirm-dice" className="gold-button" disabled={!ready || !open || info.status !== 'online'}
            onClick={() => onClose(roll.id)}>CONFIRM</button>
        </div>
      </div>
      {children}
    </>}
  </dialog>;
}

function focusTarget() {
  return document.querySelector<HTMLElement>('#turn-commands button:enabled') ?? document.querySelector<HTMLElement>('#turn-commands');
}

function App({ connection, boardAdapter }: { connection: DiceConnection; boardAdapter: DiceBoardAdapter }) {
  const [audio] = useState(() => new DiceSound());
  const cupSound = () => audio.cue('cup');
  useAudioActivation(audio.unlock);
  const info = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const { game, roll } = info;
  const own = Boolean(game?.turnId && game.turnId === info.playerId);
  const inPlacement = game?.phase === 'placement';
  const canAct = own && info.status === 'online' && !info.pending;
  const [monitor, setMonitor] = useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = useMemo(() => {
    const remaining = game?.results.filter(result => game.remaining.includes(result.id));
    return remaining?.find(result => result.id === selectedId) ?? remaining?.[0];
  }, [game, selectedId]);
  const board = useMemo(() => boardAdapter.createState(game, own && inPlacement ? selected : undefined), [boardAdapter, game, own, inPlacement, selected]);

  useEffect(() => {
    let previousTray: string | null = null;
    let previousStatus = connection.getSnapshot().status;
    const sync = connection.subscribe(() => {
      const current = connection.getSnapshot();
      if (current.tray !== previousTray || current.status !== previousStatus) audio.cut();
      previousTray = current.tray;
      previousStatus = current.status;
    });
    const off = connection.subscribeImpacts(hits => audio.impacts(hits));
    connection.start();
    return () => { connection.stop(); off(); sync(); audio.cut(); };
  }, []);

  useEffect(() => {
    void preloadDice().catch(() => {
      // A failed image prefetch is retried by the tray renderer.
    });
  }, []);

  const resultCount = roll?.results.length ?? 0;
  useEffect(() => { if (info.tray && resultCount) audio.cue('result'); }, [info.tray, resultCount]);

  function confirm(id: string) {
    if (connection.confirm(id)) audio.cue('confirm');
  }

  const seat = game?.seats.find(item => item.id === info.playerId);
  const current = game?.seats.find(item => item.id === game.turnId);
  const devReroll = Boolean(info.dev && game && !game.placedThisRoll);
  const perf = <PerformanceMonitor info={info} fps={fps} own={own} expanded={monitor} expand={setMonitor}
    configure={config => connection.send({ type: 'config', config })} />;

  return <main className="dice-salon">
    <header className="salon-header">
      <div className="salon-mark"><span aria-hidden="true">◇</span>ATELIER NOIR</div>
      <span className="room-chip" lang="en">{connection.room.toUpperCase()}</span>
    </header>
    <div className="salon-title"><h1>宝石サイコロ 3D</h1><span role="status">{seat?.name ?? (info.status === 'offline' ? '再接続中' : '接続中')} {seat && (own ? '・あなたの手番' : current ? `・${current.name} の手番` : '')}</span></div>
    <div className="table-layout">
      <div className="game-board">
        <GamblerBoard board={boardAdapter.definition} state={board} viewportRef={null}
          onSelect={cell => boardAdapter.onSelect(cell, { game, roll, selected, canAct, inPlacement, board })} />
      </div>
      <aside className="turn-card" aria-labelledby="turn-title">
        <div className="turn-heading"><h2 id="turn-title">ダイス操作</h2><span>{game?.seats.filter(item => item.online).length ?? 0}人 接続</span></div>
        <div id="turn-commands" tabIndex={-1}>
          {inPlacement && game ? <div className="placement-actions">
            <button type="button" id="reroll-dice" className="gold-button"
              disabled={!canAct || !game.remaining.length || (!game.placedThisRoll && !devReroll)} onClick={() => connection.roll('reroll')}>REROLL</button>
            <button type="button" id="end-turn" className="quiet"
              disabled={!canAct || (game.hasLegalPlacement && !game.placedThisRoll)}
              onClick={() => connection.send({ type: 'end-turn', revision: game.revision })}>END TURN</button>
          </div> : <button type="button" id="roll-dice" className="gold-button" disabled={!canAct || game?.phase !== 'ready'}
            onClick={() => connection.roll('roll')}>ROLL DICE</button>}
        </div>
        <p className="turn-note">
          {info.status !== 'online' ? 'ルームに接続しています。'
            : !own ? '手番のプレイヤーの操作を待っています。'
            : inPlacement && game?.hasLegalPlacement ? '出目を選び、行の左端の空きマスに置きます。'
            : inPlacement && devReroll ? '開発モードでは配置前の振り直しも試せます。'
            : inPlacement ? '置けるダイスがなければ、手番を終了します。'
            : 'カップを傾けてダイスを振ります。'}
        </p>
        {info.problem && <p className="notice" role="status">{info.problem}</p>}
        <div className="retained"><h3>確定した出目</h3>
          {game?.results.length
            ? <ResultStrip list={game.results} action={own && inPlacement ? setSelectedId : undefined}
              chosen={selected?.id} remaining={game.remaining} />
            : <span className="waiting-result">出目の確定を待っています。</span>}
        </div>
      </aside>
    </div>
    {!info.tray && perf}
    <TrayDialog info={info} setFps={setFps} onClose={confirm} focusTarget={focusTarget} stream={connection.frames} onCup={cupSound}>{info.tray && perf}</TrayDialog>
  </main>;
}

export default function DiceScreen({ connection, boardAdapter }: { connection: DiceConnection; boardAdapter: DiceBoardAdapter }) {
  return <App connection={connection} boardAdapter={boardAdapter} />;
}
