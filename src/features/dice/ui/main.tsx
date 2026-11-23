import { useAudioActivation } from '../../../shared/audio/use-audio-activation';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { GamblerBoard } from '../../board/ui/GamblerBoard';
import { cellKey, goalColumn, playableColumns } from '../../board/model/board-model';
import type { BoardDefinition, BoardState, CellAddress } from '../../board/model/board-model';
import { GEMS } from '../../board/model/gems';
import '../../board/ui/style.css';
import type { GemId } from '../model/geometry';
import type { DiceResult, GameState, RollView } from '../../../shared/contracts/dice';
import { DiceConnection } from './connection';
import type { ConnectionView } from './connection';
import { PerformanceMonitor } from './monitor';
import { MatchPanel } from './match-panel';
import { DiceSound } from './sound';
import { preloadDice } from './face-canvases';
import { placementCandidates } from '../model/placement-feedback';
import { TURN_CHANGE_DURATION_MS, REDUCED_TURN_CHANGE_DURATION_MS } from '../../effects/model/effect-model';
import { scoreLabel } from '../../effects/model/effect-model';
import { TurnAnnouncement } from '../../effects/ui/settlement-scenes';
import { oneCellComebackHint, settlementFollowups } from '../model/settlement-presentation';
import { REDUCED_SCORE_MS, scoreTimings } from '../../effects/ui/board-score/board-motion';
import { COIN_TRAVEL_MS } from '../../bank/model/bank-model';
import { SoundManager } from '../../effects/ui/sound';
import './style.css';
import '../../effects/ui/board-score/score-effect.css';


const loadTray = () => import('./3d/tray-scene');
const TrayScene = lazy(loadTray);
const SettlementOverlay = lazy(() => import('./settlement-overlay').then(module => ({ default: module.SettlementOverlay })));

export interface DiceBoardContext {
  game: GameState | null;
  roll: RollView | null;
  selected: DiceResult | undefined;
  canAct: boolean;
  inPlacement: boolean;
  board: BoardState;
  definition: BoardDefinition;
}

export interface DiceBoardAdapter {
  getDefinition: (seed: number | undefined) => BoardDefinition;
  createState: (definition: BoardDefinition, game: GameState | null) => BoardState;
  onSelect: (cell: CellAddress, context: DiceBoardContext) => void;
  requiresServerBoard?: boolean;
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
          {info.game?.turnNotice === 'no-legal-placement' && <p className="turn-notice" role="status">置けるマスがありません。手番を交代しました。</p>}
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
  const [settlementAudio] = useState(() => new SoundManager());
  const cupSound = () => audio.cue('cup');
  useAudioActivation(audio.unlock);
  useAudioActivation(settlementAudio.unlock);
  const info = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const { game, roll } = info;
  const own = Boolean(game?.turnId && game.turnId === info.playerId);
  const inPlacement = game?.phase === 'placement';
  const hasStandardMatch = info.match !== null;
  const [announcedTurnSequence, setAnnouncedTurnSequence] = useState<number | null>(null);
  const current = game?.seats.find(item => item.id === game.turnId);
  const settlement = info.settlements[0];
  const settlementKey = settlement ? `${settlement.boardSeed}:${settlement.revision}` : null;
  const boardRef = useRef<HTMLElement>(null);
  const [settlementStep, setSettlementStep] = useState<{ key: string; step: 'score' | 'bonus'; startedAt: number } | null>(null);
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  useEffect(() => {
    if (!hasStandardMatch || info.settlements.length > 0 || !game || game.phase !== 'ready' || game.turnSequence < 1 || info.match?.result) return;
    const sequence = game.turnSequence;
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? REDUCED_TURN_CHANGE_DURATION_MS : TURN_CHANGE_DURATION_MS;
    const timer = window.setTimeout(() => setAnnouncedTurnSequence(sequence), duration);
    return () => window.clearTimeout(timer);
  }, [hasStandardMatch, info.settlements.length, game?.phase, game?.turnSequence, Boolean(info.match?.result)]);
  const turnNeedsAnnouncement = Boolean(hasStandardMatch && game?.phase === 'ready' && game.turnSequence > 0
    && info.settlements.length === 0 && !info.match?.result && announcedTurnSequence !== game.turnSequence);
  const turnGateReady = !turnNeedsAnnouncement;
  const showTurnChange = Boolean(turnNeedsAnnouncement && current && game);
  const canAct = own && info.status === 'online' && !info.pending && !info.match?.result
    && info.settlements.length === 0 && turnGateReady;
  const [monitor, setMonitor] = useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const [choice, setChoice] = useState<{ rollId: string; dieId: string }>();
  const selected = useMemo(() => {
    if (!choice || choice.rollId !== roll?.id || !game?.remaining.includes(choice.dieId)) return undefined;
    return game.results.find(result => result.id === choice.dieId);
  }, [game, roll?.id, choice]);
  const seed = game?.boardSeed;
  const definition = useMemo(() => boardAdapter.getDefinition(seed), [boardAdapter, seed]);
  const eventRow = settlement ? definition.rows.find(row => row.id === settlement.rowId) : undefined;
  const eventGoal = eventRow ? goalColumn(definition, eventRow) : undefined;
  const eventTarget = eventGoal && settlement?.columnId === eventGoal.id && eventRow
    ? { rowId: eventRow.id, columnId: eventGoal.id } : undefined;
  const followups = useMemo(() => settlement && eventTarget ? settlementFollowups(settlement, definition) : [],
    [settlement, eventTarget, definition]);
  const scoreDuration = eventRow
    ? reducedMotion ? REDUCED_SCORE_MS : scoreTimings(playableColumns(definition, eventRow).length).total
    : REDUCED_SCORE_MS;
  const settlementScoreVisible = Boolean(settlement && eventTarget && settlementStep?.key === settlementKey && settlementStep.step === 'score');
  const coinMotionActive = Boolean(settlement && settlementScoreVisible && settlement.points !== 0 && !reducedMotion);
  const coinStartedAt = settlementStep?.startedAt ?? 0;

  useEffect(() => {
    if (!settlement || !settlementKey) { setSettlementStep(null); return; }
    if (!eventTarget) {
      connection.completeSettlement(settlement);
      setSettlementStep(null);
      return;
    }
    if (settlementStep?.key === settlementKey) return;
    settlementAudio.playCue('BOARD_SCORE', 'start', reducedMotion);
    setSettlementStep({ key: settlementKey, step: 'score', startedAt: performance.now() });
  }, [connection, settlement, settlementKey, Boolean(eventTarget), settlementStep?.key, settlementAudio, reducedMotion]);

  useEffect(() => {
    if (!settlement || !settlementKey || settlementStep?.key !== settlementKey || settlementStep.step !== 'score') return;
    const duration = Math.max(scoreDuration, coinMotionActive ? COIN_TRAVEL_MS : 0);
    const timer = window.setTimeout(() => {
      if (followups.length) setSettlementStep(currentStep => currentStep?.key === settlementKey
        ? { ...currentStep, step: 'bonus' } : currentStep);
      else {
        connection.completeSettlement(settlement);
        setSettlementStep(currentStep => currentStep?.key === settlementKey ? null : currentStep);
      }
    }, duration);
    return () => window.clearTimeout(timer);
  }, [connection, settlement, settlementKey, settlementStep?.key, settlementStep?.step, scoreDuration, coinMotionActive, followups.length]);
  const board = useMemo(() => {
    const state = boardAdapter.createState(definition, game);
    const placement = info.placement;
    let next = state;
    if (placement) {
      const rowId = definition.rows[placement.row]?.id;
      const columnId = definition.columns[placement.column]?.id;
      if (rowId && columnId) next = { ...next, placement: { cell: cellKey({ rowId, columnId }), id: placement.revision } };
    }
    if (settlementScoreVisible && settlement && eventTarget && game?.boardSeed === settlement.boardSeed) {
      next = { ...next, award: { id: settlement.revision, rowId: eventTarget.rowId, amount: settlement.points } };
    }
    return next;
  }, [boardAdapter, definition, game, info.placement, settlementScoreVisible, settlement, eventTarget]);
  const candidates = useMemo(() => canAct && inPlacement && selected
    ? placementCandidates(definition, board.occupied, selected.gem)
    : undefined, [canAct, inPlacement, selected, definition, board.occupied]);
  const comebackHint = useMemo(() => canAct && inPlacement && hasStandardMatch && info.match && info.playerId
    && !info.match.result && info.settlements.length === 0
    ? oneCellComebackHint(definition, board.occupied, info.match.players, info.playerId, game.results, game.remaining)
    : null, [canAct, inPlacement, hasStandardMatch, game, info.match, info.playerId, info.settlements.length, definition, board.occupied]);

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
  const waitingForBoard = Boolean(boardAdapter.requiresServerBoard && game?.boardSeed === undefined);
  const trayInfo = info.settlements.length > 0 && info.tray ? { ...info, tray: null } : info;
  const devReroll = Boolean(info.dev && game && !game.placedThisRoll);
  const perf = <PerformanceMonitor info={info} fps={fps} own={own} expanded={monitor} expand={setMonitor}
    configure={config => connection.send({ type: 'config', config })} />;

  return <main className="dice-salon">
    <header className="salon-header">
      <div className="salon-mark"><span aria-hidden="true">◇</span>ATELIER NOIR</div>
      <span className="room-chip" lang="en">{connection.room.toUpperCase()}</span>
    </header>
    <div className="salon-title"><h1>宝石サイコロ 3D</h1><span role="status">{seat?.name ?? (info.status === 'offline' ? '再接続中' : '接続中')} {seat && (own ? '・あなたの手番' : current ? `・${current.name} の手番` : '')}</span></div>
    {showTurnChange && current && game && <section key={game.turnSequence} className="turn-change-gate" aria-label="手番の案内">
      <TurnAnnouncement key={game.turnSequence} player={{ playerName: current.name, isLocal: own }} pulse />
      {own && <button type="button" className="turn-change-skip" onClick={() => game && setAnnouncedTurnSequence(game.turnSequence)}>演出をスキップ</button>}
    </section>}
    <div className="settlement-stage">
    <div className="table-layout">
      <div className="game-board">
        {waitingForBoard
          ? <div className="board-loading" role="status">共有盤面を読み込んでいます…</div>
          : <GamblerBoard board={definition} state={board} viewportRef={boardRef} candidates={candidates}
            scoreNotice={settlementScoreVisible && settlement && eventTarget ? { rowId: eventTarget.rowId, label: scoreLabel(settlement.points) } : undefined}
            hintCell={comebackHint?.target}
            onSelect={cell => boardAdapter.onSelect(cell, { game, roll, selected, canAct, inPlacement, board, definition })} />}
      </div>
      <aside className="turn-card" aria-labelledby="turn-title">
        <div className="turn-heading"><h2 id="turn-title">ダイス操作</h2><span>{game?.seats.filter(item => item.online).length ?? 0}人 接続</span></div>
        <div id="turn-commands" tabIndex={-1}>
          {inPlacement && game ? <div className="placement-actions">
            <button type="button" id="reroll-dice" className="gold-button"
              disabled={!canAct || !game.remaining.length || (!game.placedThisRoll && !devReroll)} onClick={() => connection.roll('reroll')}>REROLL</button>
            <button type="button" id="end-turn" className="quiet"
              disabled={!canAct || (game.hasLegalPlacement && !game.placedThisRoll)}
              onClick={() => connection.send({ type: 'end-turn', revision: game.revision, turnSequence: game.turnSequence })}>END TURN</button>
          </div> : <button type="button" id="roll-dice" className="gold-button" disabled={!canAct || game?.phase !== 'ready'}
            onClick={() => connection.roll('roll')}>ROLL DICE</button>}
        </div>
        <p className="turn-note">
          {game?.turnNotice === 'no-legal-placement' ? '置けるマスがありません。手番を交代しました。'
            : info.settlements.length ? '得点を確定しています。'
            : info.match?.result ? info.match.result.status === 'won' ? '対戦結果が確定しました。' : 'ラウンドが完成しました。'
            : info.status !== 'online' ? 'ルームに接続しています。'
            : !own ? '手番のプレイヤーの操作を待っています。'
            : !turnGateReady ? '手番の案内を表示しています。'
            : inPlacement && game?.hasLegalPlacement ? '出目を選び、行の左端の空きマスに置きます。'
            : inPlacement && game?.placedThisRoll && game.remaining.length ? '置けるマスがなくても、未配置ダイスを振り直すか手番を終了できます。'
            : inPlacement && devReroll ? '開発モードでは配置前の振り直しも試せます。'
            : inPlacement ? '置けるダイスがなければ、手番を終了します。'
            : 'カップを傾けてダイスを振ります。'}
        </p>
        {comebackHint && <p className="comeback-hint" role="status">
          あと1マスで逆転：{comebackHint.points}点の得点マスに
          {GEMS[comebackHint.gem].name}を置くと単独首位です。
        </p>}
        {info.problem && <p className="notice" role="status">{info.problem}</p>}
        <div className="retained"><h3>確定した出目</h3>
          {game?.results.length
            ? <ResultStrip list={game.results} action={canAct && inPlacement && roll
              ? dieId => setChoice({ rollId: roll.id, dieId }) : undefined}
              chosen={selected?.id} remaining={game.remaining} />
            : <span className="waiting-result">出目の確定を待っています。</span>}
        </div>
      </aside>
    </div>
    {settlement && <p key={settlementKey} className="sr-only" role="status" aria-live="polite">
      {settlement.playerName}　{scoreLabel(settlement.points)}
    </p>}
    <MatchPanel room={connection.room} match={info.match} turnId={game?.turnId ?? null} playerId={info.playerId}
      turnSequence={game?.turnSequence ?? 0} settlement={settlement} coinActive={coinMotionActive} coinStartedAt={coinStartedAt} />
    {settlement && settlementKey && settlementScoreVisible && <button type="button" className="settlement-score-skip"
      onClick={() => {
        if (followups.length) setSettlementStep(currentStep => currentStep?.key === settlementKey
          ? { ...currentStep, step: 'bonus' } : currentStep);
        else {
          connection.completeSettlement(settlement);
          setSettlementStep(currentStep => currentStep?.key === settlementKey ? null : currentStep);
        }
      }}>得点演出をスキップ</button>}
    {settlement && settlementKey && settlementStep?.key === settlementKey && settlementStep.step === 'bonus' && followups.length > 0
      && <Suspense fallback={null}><SettlementOverlay key={settlementKey} event={settlement} board={definition} boardRef={boardRef} audio={settlementAudio}
        onComplete={() => {
          connection.completeSettlement(settlement);
          setSettlementStep(currentStep => currentStep?.key === settlementKey ? null : currentStep);
        }} /></Suspense>}
    </div>
    {!info.tray && perf}
    <TrayDialog info={trayInfo} setFps={setFps} onClose={confirm} focusTarget={focusTarget} stream={connection.frames} onCup={cupSound}>{trayInfo.tray && perf}</TrayDialog>
  </main>;
}

export default function DiceScreen({ connection, boardAdapter }: { connection: DiceConnection; boardAdapter: DiceBoardAdapter }) {
  return <App connection={connection} boardAdapter={boardAdapter} />;
}
