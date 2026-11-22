import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { GamblerBoard } from '../../board/ui/GamblerBoard';
import { cellKey, initialState } from '../../board/model/board-model';
import { GEMS } from '../../board/model/gems';
import { SAMPLE_BOARD } from '../../../dev/preview-data/sample-board';
import '../../board/ui/style.css';
import { boardCellKey } from '../model/geometry';
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
const params = new URLSearchParams(location.search);
const connection = new DiceConnection(params.get('dev') === '1', params.get('room') ?? 'salon');
const audio = new DiceSound();
const cupSound = () => audio.cue('cup');
const boardTemplate = { ...SAMPLE_BOARD, rows: SAMPLE_BOARD.rows.map(row => ({ id: row.id, score: row.score })) };
const idleBoard = initialState(boardTemplate);
const noPlacements = [] as const;

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

function TrayDialog({ info, setFps, children, onClose, focusTarget }: {
  info: ConnectionView;
  setFps: (fps: number | null) => void;
  children: ReactNode;
  onClose: (id: string) => void;
  focusTarget: () => HTMLElement | null;
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
          <TrayScene stream={connection.frames} roll={roll} onFps={setFps} onCup={cupSound} />
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

function tableState(game: GameState | null, active: DiceResult | undefined) {
  const occupied = new Map(idleBoard.occupied);
  const placements = game?.placements ?? noPlacements;
  const slots = new Set(placements.map(item => boardCellKey(item.row, item.column)));
  for (const { row, column, gem } of placements) {
    const rowId = boardTemplate.rows[row]?.id;
    const columnId = boardTemplate.columns[column]?.id;
    if (rowId && columnId) occupied.set(cellKey({ rowId, columnId }), gem);
  }
  const selection = active ? boardTemplate.rows.flatMap((row, rowIndex) => {
    const next = boardTemplate.columns.findIndex((_, column) => !slots.has(boardCellKey(rowIndex, column)));
    const column = boardTemplate.columns[next];
    return column?.gem === active.gem ? [{ rowId: row.id, columnId: column.id }] : [];
  })[0] ?? null : null;
  return { ...idleBoard, occupied, selection };
}

function focusTarget() {
  return document.querySelector<HTMLElement>('#turn-commands button:enabled') ?? document.querySelector<HTMLElement>('#turn-commands');
}

function App() {
  const info = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const { game, roll } = info;
  const own = Boolean(game?.turnId && game.turnId === info.playerId);
  const inPlacement = game?.phase === 'placement';
  const canAct = own && info.status === 'online' && !info.pending;
  const [sound, setSound] = useState(false);
  const [soundBusy, setSoundBusy] = useState(false);
  const [soundError, setSoundError] = useState('');
  const [monitor, setMonitor] = useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = useMemo(() => {
    const remaining = game?.results.filter(result => game.remaining.includes(result.id));
    return remaining?.find(result => result.id === selectedId) ?? remaining?.[0];
  }, [game, selectedId]);
  const board = useMemo(() => tableState(game, own && inPlacement ? selected : undefined), [game, own, inPlacement, selected]);

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

  async function toggleSound() {
    if (soundBusy) return;
    setSoundBusy(true);
    setSoundError('');
    try {
      const active = await audio.enable(!sound);
      setSound(active);
      if (!active && !sound) setSoundError('効果音を有効にできませんでした。');
    } catch {
      setSoundError('効果音を有効にできませんでした。');
    } finally {
      setSoundBusy(false);
    }
  }

  function confirm(id: string) {
    if (connection.confirm(id)) audio.cue('confirm');
  }

  function commandCell(rowId: string, columnId: string) {
    if (!canAct || !inPlacement || !roll || !selected) return;
    const row = boardTemplate.rows.findIndex(item => item.id === rowId);
    const next = boardTemplate.columns.find(column => !board.occupied.has(cellKey({ rowId, columnId: column.id })));
    if (row < 0 || next?.id !== columnId || next.gem !== selected.gem) return;
    connection.send({ type: 'place', row, rollId: roll.id, dieId: selected.id });
  }

  const seat = game?.seats.find(item => item.id === info.playerId);
  const current = game?.seats.find(item => item.id === game.turnId);
  const devReroll = Boolean(info.dev && game && !game.placedThisRoll);
  const perf = <PerformanceMonitor info={info} fps={fps} own={own} expanded={monitor} expand={setMonitor}
    configure={config => connection.send({ type: 'config', config })} />;

  return <main className="dice-salon">
    <header className="salon-header">
      <div className="salon-mark"><span aria-hidden="true">◇</span>ATELIER NOIR</div>
      <div className="salon-utility">
        <span className="room-chip" lang="en">{connection.room.toUpperCase()}</span>
        <button type="button" className="quiet" aria-pressed={sound} aria-label="効果音" disabled={soundBusy} onClick={toggleSound}>
          効果音 {sound ? 'ON' : 'OFF'}
        </button>
      </div>
    </header>
    <div className="salon-title"><h1>宝石サイコロ 3D</h1><span role="status">{seat?.name ?? (info.status === 'offline' ? '再接続中' : '接続中')} {seat && (own ? '・あなたの手番' : current ? `・${current.name} の手番` : '')}</span></div>
    <div className="table-layout">
      <div className="game-board">
        <GamblerBoard board={boardTemplate} state={board} viewportRef={null} onSelect={cell => commandCell(cell.rowId, cell.columnId)} />
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
        {(info.problem || soundError) && <p className="notice" role="status">{info.problem || soundError}</p>}
        <div className="retained"><h3>確定した出目</h3>
          {game?.results.length
            ? <ResultStrip list={game.results} action={own && inPlacement ? setSelectedId : undefined}
              chosen={selected?.id} remaining={game.remaining} />
            : <span className="waiting-result">出目の確定を待っています。</span>}
        </div>
      </aside>
    </div>
    {!info.tray && perf}
    <TrayDialog info={info} setFps={setFps} onClose={confirm} focusTarget={focusTarget}>{info.tray && perf}</TrayDialog>
  </main>;
}

export default App;
