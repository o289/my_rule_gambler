import { useAudioActivation } from '../../../shared/audio/use-audio-activation';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
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
import { FinalResults } from './final-results';
import { DiceSound } from './sound';
import { preloadDice } from './face-canvases';
import { placementCandidates } from '../model/placement-feedback';
import { ROLL_RESULT_DISPLAY_MS, rollPresentationAction } from '../model/roll-presentation';
import { TURN_CHANGE_DURATION_MS, REDUCED_TURN_CHANGE_DURATION_MS } from '../../effects/model/effect-model';
import { scoreLabel } from '../../effects/model/effect-model';
import { TurnAnnouncement } from '../../effects/ui/settlement-scenes';
import { dicePresentationMode, oneCellComebackHint, settlementStages } from '../model/settlement-presentation';
import { PLACEMENT_FLASH_MS, REDUCED_SCORE_MS, scoreTimings } from '../../effects/ui/board-score/board-motion';
import { locateCell } from '../../effects/ui/board-scene';
import { BankAudio } from '../../bank/ui/bank-audio';
import { SettlementBank } from './settlement-bank';
import { SoundManager } from '../../effects/ui/sound';
import { canShowPreviewEndTurn, canSwitchDiceMainPanel, panelForTurnChange } from '../model/main-area';
import type { DiceMainPanel } from '../model/main-area';
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

function ResultStrip({ list, action, chosen }: {
  list: readonly DiceResult[];
  action?: (id: string) => void;
  chosen?: string;
}) {
  return <ol className="results-strip" aria-label="確定した出目">
    {list.map((result, index) => {
      const datum = <><span className="result-icon"><DiceIcon gem={result.gem} /></span>
        <span className="result-name">{GEMS[result.gem].name}</span></>;
      return <li key={result.id} data-gem={result.gem} data-die-id={result.id} aria-label={`${index + 1}番、${GEMS[result.gem].name}`}>
        {action ? <button type="button" onClick={() => action(result.id)} aria-pressed={chosen === result.id}
          className="result-choice">{datum}</button>
          : <div className="result-tile">{datum}</div>}
      </li>;
    })}
  </ol>;
}

const trayStyle: CSSProperties & { '--roll-result-display-ms': string } = {
  '--roll-result-display-ms': `${ROLL_RESULT_DISPLAY_MS}ms`,
};

function DiceRollPanel({ roll, info, setFps, onConfirm, onDismiss, stream, onCup }: {
  roll: RollView;
  info: ConnectionView;
  setFps: (fps: number | null) => void;
  onConfirm: (id: string) => void;
  onDismiss: (id: string) => void;
  stream: DiceConnection['frames'];
  onCup: () => void;
}) {
  const [complete, setComplete] = useState(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const markComplete = useCallback(() => setComplete(true), []);
  const standard = info.match !== null;
  const own = info.playerId !== null && info.game?.turnId === info.playerId;
  const ready = roll.results.length > 0;
  const action = rollPresentationAction({ standard, complete: ready && complete, confirmed: roll.confirmed, own, reroll: roll.kind === 'reroll' });
  const showConfirm = !standard || (own && !roll.confirmed && roll.kind === 'initial');
  const label = ready ? showConfirm && !roll.confirmed ? '出目を表示しています' : '出目が確定しました'
    : roll.kind === 'reroll' ? '残ったダイスを振り直しています' : 'ダイスを振っています';

  useEffect(() => {
    if (action === 'show-board') onDismiss(roll.id);
    else if (action === 'auto-confirm' && info.status === 'online' && !info.pending) onConfirm(roll.id);
  }, [action, roll.id, info.status, info.pending, onConfirm, onDismiss]);
  useEffect(() => {
    if (action === 'confirm' && own && info.status === 'online' && !info.pending) confirmButton.current?.focus({ preventScroll: true });
  }, [action, own, info.status, info.pending]);

  return <section className="tray-box" id="dice-tray" aria-labelledby="tray-title" style={trayStyle}>
    <header className="tray-heading">
      <h2 id="tray-title">DICE TRAY</h2>
      <span className="tray-status" role="status">{info.status !== 'online' ? '接続を再開しています…' : label}</span>
    </header>
    <Suspense fallback={<div className="tray-visual"><p className="tray-problem">3Dトレイを準備しています…</p></div>}>
      <TrayScene stream={stream} roll={roll} onFps={setFps} onCup={onCup} onResultComplete={markComplete} />
    </Suspense>
    <div className="tray-result" data-settled={ready}>
      {ready ? <ResultStrip list={roll.results} /> : <p>すべてのダイスが止まると出目が表示されます。</p>}
      {info.game?.turnNotice === 'no-legal-placement' && <p className="turn-notice" role="status">置けるマスがありません。手番を交代しました。</p>}
    </div>
    {showConfirm && <div className="tray-actions">
      <button ref={confirmButton} type="button" id="confirm-dice" className="gold-button"
        disabled={action !== 'confirm' || info.pending || info.status !== 'online'} onClick={() => onConfirm(roll.id)}>CONFIRM</button>
    </div>}
  </section>;
}

function App({ connection, boardAdapter }: { connection: DiceConnection; boardAdapter: DiceBoardAdapter }) {
  const [audio] = useState(() => new DiceSound());
  const [settlementAudio] = useState(() => new SoundManager());
  const [bankAudio] = useState(() => new BankAudio());
  const cupSound = useCallback(() => audio.cue('cup'), [audio]);
  useAudioActivation(audio.unlock);
  useAudioActivation(settlementAudio.unlock);
  useAudioActivation(bankAudio.unlock);
  const info = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const { game, roll } = info;
  const settlement = info.settlements[0];
  const settlementSnapshot = info.settlementSnapshot;
  const finalResult = info.match?.result?.status === 'won' ? info.match.result : null;
  const presentationMode = dicePresentationMode({
    settlementPending: Boolean(settlement),
    settlementRollId: settlementSnapshot?.rollId ?? null,
    resultReady: Boolean(finalResult),
    rollReady: Boolean(roll && roll.id === info.tray),
    rollId: roll?.id ?? null,
  });
  const trayRoll = presentationMode === 'roll' ? roll : null;
  const own = Boolean(game?.turnId && game.turnId === info.playerId);
  const inPlacement = game?.phase === 'placement';
  const hasStandardMatch = info.match !== null;
  const [announcedTurnSequence, setAnnouncedTurnSequence] = useState<number | null>(null);
  const current = game?.seats.find(item => item.id === game.turnId);
  const settlementKey = settlement ? `${settlement.boardSeed}:${settlement.revision}` : null;
  const boardRef = useRef<HTMLElement>(null);
  const mainArea = useRef<HTMLElement>(null);
  const [settlementProgress, setSettlementProgress] = useState<{ key: string; index: number }>();
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const placementRevision = info.placement?.revision;
  const [shownPlacement, setShownPlacement] = useState(-1);
  const placementPlaying = hasStandardMatch && !settlement && !trayRoll && !reducedMotion
    && placementRevision !== undefined && placementRevision > shownPlacement;
  useEffect(() => {
    if (!placementPlaying || placementRevision === undefined) return;
    const timer = window.setTimeout(() => setShownPlacement(placementRevision), PLACEMENT_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [placementPlaying, placementRevision]);

  useEffect(() => {
    if (!hasStandardMatch || settlement || trayRoll || placementPlaying || !game || game.phase !== 'ready' || game.turnSequence < 1 || info.match?.result) return;
    const sequence = game.turnSequence;
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? REDUCED_TURN_CHANGE_DURATION_MS : TURN_CHANGE_DURATION_MS;
    const timer = window.setTimeout(() => setAnnouncedTurnSequence(sequence), duration);
    return () => window.clearTimeout(timer);
  }, [hasStandardMatch, settlement, trayRoll, placementPlaying, game?.phase, game?.turnSequence, Boolean(info.match?.result)]);
  const turnNeedsAnnouncement = Boolean(hasStandardMatch && game?.phase === 'ready' && game.turnSequence > 0
    && !settlement && !trayRoll && !placementPlaying && !info.match?.result && announcedTurnSequence !== game.turnSequence);
  const turnGateReady = !turnNeedsAnnouncement;
  const showTurnChange = Boolean(turnNeedsAnnouncement && current && game);
  const canAct = own && info.status === 'online' && !info.pending && !info.match?.result
    && !settlement && !trayRoll && !placementPlaying && turnGateReady;
  const devReroll = Boolean(info.dev && game && !game.placedThisRoll);
  const [monitor, setMonitor] = useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const [choice, setChoice] = useState<{ rollId: string; dieId: string }>();
  const [mainPanel, setMainPanel] = useState<DiceMainPanel>('board');
  const mainPanelFocus = useRef<DiceMainPanel | null>(null);
  const remainingResults = game ? game.results.filter(result => game.remaining.includes(result.id)) : [];
  const selected = choice && choice.rollId === roll?.id ? remainingResults.find(result => result.id === choice.dieId) : undefined;
  const displayGame = settlementSnapshot?.game ?? game;
  const seed = displayGame?.boardSeed;
  const definition = useMemo(() => boardAdapter.getDefinition(seed), [boardAdapter, seed]);
  const eventRow = settlement ? definition.rows.find(row => row.id === settlement.rowId) : undefined;
  const eventGoal = eventRow ? goalColumn(definition, eventRow) : undefined;
  const eventTarget = useMemo(() => eventGoal && settlement?.columnId === eventGoal.id && eventRow
    ? { rowId: eventRow.id, columnId: eventGoal.id } : undefined, [eventGoal, eventRow, settlement]);
  const stages = useMemo(() => settlement && eventTarget ? settlementStages(settlement, definition) : [],
    [settlement, eventTarget, definition]);
  const stageIndex = settlementProgress?.key === settlementKey ? settlementProgress.index : 0;
  const stage = trayRoll ? undefined : stages[stageIndex];
  const effect = stage?.kind === 'effect' ? stage.request : null;
  const scoreDuration = eventRow
    ? reducedMotion ? REDUCED_SCORE_MS : scoreTimings(playableColumns(definition, eventRow).length).total
    : REDUCED_SCORE_MS;
  const advanceSettlement = useCallback(() => {
    if (!settlementKey || connection.getSnapshot().settlements[0] !== settlement) return;
    setSettlementProgress(previous => {
      const index = previous?.key === settlementKey ? previous.index : 0;
      return index === stageIndex ? { key: settlementKey, index: index + 1 } : previous;
    });
  }, [connection, settlement, settlementKey, stageIndex]);

  useLayoutEffect(() => {
    if (trayRoll) return;
    if (settlement) setShownPlacement(previous => Math.max(previous, settlement.revision));
    locateCell(boardRef.current, eventTarget)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [eventTarget, settlement, trayRoll]);

  useEffect(() => {
    if (!trayRoll && settlement && (!stage || (stage.kind === 'bank' && !settlementSnapshot))) {
      if (stage) advanceSettlement();
      else connection.completeSettlement(settlement);
    }
  }, [connection, settlement, stage, settlementSnapshot, trayRoll, advanceSettlement]);

  useEffect(() => {
    if (stage?.kind !== 'placement' && stage?.kind !== 'score') return;
    const scoring = stage.kind === 'score';
    if (scoring) settlementAudio.playCue('BOARD_SCORE', 'start', reducedMotion);
    const duration = scoring ? scoreDuration : reducedMotion ? 0 : PLACEMENT_FLASH_MS;
    const timer = window.setTimeout(advanceSettlement, duration);
    return () => {
      window.clearTimeout(timer);
      if (scoring) settlementAudio.cut();
    };
  }, [stage, scoreDuration, settlementAudio, reducedMotion, advanceSettlement]);
  const board = useMemo(() => {
    const state = boardAdapter.createState(definition, displayGame);
    const placement = info.placement;
    let next = state;
    if (!settlement && placement && (!hasStandardMatch || placementPlaying)) {
      const rowId = definition.rows[placement.row]?.id;
      const columnId = definition.columns[placement.column]?.id;
      if (rowId && columnId) next = { ...next, placement: { cell: cellKey({ rowId, columnId }), id: placement.revision } };
    }
    if (settlement && eventTarget) {
      if (stage?.kind === 'placement') next = { ...next, placement: { cell: cellKey(eventTarget), id: settlement.revision } };
      if (stage?.kind === 'score') next = { ...next, award: { id: settlement.revision, rowId: eventTarget.rowId, amount: settlement.points } };
    }
    return next;
  }, [boardAdapter, definition, displayGame, info.placement, hasStandardMatch, placementPlaying, stage, settlement, eventTarget]);
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
  useEffect(() => { if (trayRoll && resultCount) audio.cue('result'); }, [trayRoll?.id, resultCount]);

  const confirm = useCallback((id: string) => {
    if (connection.confirm(id)) audio.cue('confirm');
  }, [connection, audio]);
  const dismissRoll = useCallback((id: string) => connection.dismissConfirmedRoll(id), [connection]);

  const waitingForBoard = Boolean(boardAdapter.requiresServerBoard && game?.boardSeed === undefined);
  const bankSettlement = stage?.kind === 'bank' && settlement && settlementSnapshot
    ? { event: settlement, player: settlementSnapshot.player } : null;
  const surface = trayRoll ? 'dice' : bankSettlement ? 'bank' : 'board';
  const canSwitchPanel = canSwitchDiceMainPanel({
    canAct,
    phase: game?.phase,
    hasLegalPlacement: Boolean(game?.hasLegalPlacement),
    remainingDice: game?.remaining.length ?? 0,
    placedThisRoll: Boolean(game?.placedThisRoll),
    devReroll,
  });
  const showPreviewEndTurn = canShowPreviewEndTurn({
    preview: !hasStandardMatch,
    canAct,
    phase: game?.phase,
    hasLegalPlacement: Boolean(game?.hasLegalPlacement),
    placedThisRoll: Boolean(game?.placedThisRoll),
    panelCanSwitch: canSwitchPanel,
  });
  const changeMainPanel = (next: DiceMainPanel) => {
    mainPanelFocus.current = next;
    setMainPanel(next);
  };
  const selectDie = (dieId: string) => {
    if (!roll) return;
    setChoice({ rollId: roll.id, dieId });
    changeMainPanel('board');
  };
  useLayoutEffect(() => {
    if (surface !== 'board') mainArea.current?.scrollIntoView({ block: 'nearest' });
  }, [surface]);
  useEffect(() => { setFps(null); }, [trayRoll?.id]);
  useLayoutEffect(() => {
    const waitingForLocalTurnGate = own && turnNeedsAnnouncement;
    if (surface !== 'board' || (!canSwitchPanel && !showPreviewEndTurn && !waitingForLocalTurnGate)) {
      mainPanelFocus.current = null;
      setMainPanel('board');
    }
  }, [surface, canSwitchPanel, showPreviewEndTurn, own, turnNeedsAnnouncement]);
  const previousTurnSequence = useRef<number | null>(null);
  useLayoutEffect(() => {
    const sequence = game?.turnSequence ?? null;
    if (sequence !== null && previousTurnSequence.current !== null && sequence !== previousTurnSequence.current) {
      mainPanelFocus.current = null;
      setMainPanel(panelForTurnChange(own));
      if (own) mainArea.current?.scrollIntoView({ block: 'nearest' });
    } else if (sequence !== null && previousTurnSequence.current === null) {
      setMainPanel(panelForTurnChange(own));
      if (own) mainArea.current?.scrollIntoView({ block: 'nearest' });
    }
    previousTurnSequence.current = sequence;
  }, [game?.turnSequence, own]);
  const previousRoll = useRef<{ id: string | null; confirmed: boolean }>({ id: null, confirmed: false });
  useLayoutEffect(() => {
    const id = roll?.id ?? null;
    const confirmed = Boolean(roll?.confirmed);
    if (id === previousRoll.current.id && !previousRoll.current.confirmed && confirmed) setMainPanel('operations');
    previousRoll.current = { id, confirmed };
  }, [roll?.id, roll?.confirmed]);
  useLayoutEffect(() => {
    const requested = mainPanelFocus.current;
    if (!requested || requested !== mainPanel || surface !== 'board') return;
    mainPanelFocus.current = null;
    const area = mainArea.current;
    if (!area) return;
    if (requested === 'operations') {
      const target = area.querySelector<HTMLElement>('#main-operations .result-choice:not(:disabled)')
        ?? area.querySelector<HTMLElement>('#main-operations button:not(:disabled)');
      target?.focus({ preventScroll: true });
      return;
    }
    const target = area.querySelector<HTMLElement>('.board-cell[aria-pressed="true"]:not(:disabled)')
      ?? area.querySelector<HTMLElement>('.board-cell[data-state="available"]:not(:disabled)')
      ?? area.querySelector<HTMLElement>('.board-cell:not(:disabled)');
    (target ?? area).focus({ preventScroll: true });
  }, [mainPanel, surface, selected, candidates]);
  useEffect(() => { setChoice(undefined); }, [roll?.id, game?.turnSequence]);
  const perf = <PerformanceMonitor info={info} fps={fps} own={own} expanded={monitor} expand={setMonitor}
    configure={config => connection.send({ type: 'config', config })} />;

  return <main className="dice-salon">
    <header className="salon-header">
      <div className="salon-mark"><span aria-hidden="true">◇</span>ATELIER NOIR</div>
      <span className="room-chip" lang="en">{connection.room.toUpperCase()}</span>
    </header>
    {info.status !== 'online' && <p className="dice-connection-status" role="status">
      {info.status === 'offline' ? '再接続中' : '接続中'}
    </p>}
    {showTurnChange && current && game && <section key={game.turnSequence} className="turn-change-gate" aria-label="手番の案内">
      <TurnAnnouncement key={game.turnSequence} player={{ playerName: current.name, isLocal: own }} pulse />
    </section>}
    <div className="settlement-stage">
    {presentationMode === 'result' && finalResult && info.match ? <FinalResults players={info.match.players} winners={finalResult.winners}
      connected={info.status === 'online'} pending={info.returningToLobby} problem={info.problem}
      onReturn={ready => connection.returnToLobby(ready)} /> : <div className="dice-table-layout">
      <div className="dice-table-sidebar">
        <MatchPanel match={info.match} turnId={game?.turnId ?? null} playerId={info.playerId}
          turnSequence={game?.turnSequence ?? 0} settlement={settlement} effectsPlaying={Boolean(trayRoll || settlement)} />
      </div>
      <div className="dice-game-main-column">
      <section className="game-board" ref={mainArea} aria-label="メイン演出エリア" data-view={surface} tabIndex={-1}>
        {info.problem && <p className="notice main-area-notice" role="status">{info.problem}</p>}
        {surface === 'board' && (canSwitchPanel || showPreviewEndTurn) && <div className="main-area-toolbar">
          {mainPanel === 'board' && selected && <span className="main-area-selection" role="status">
            {GEMS[selected.gem].name}を選択中
          </span>}
          {canSwitchPanel && <button type="button" className="main-area-toggle" aria-controls="main-area-content"
            aria-pressed={mainPanel === 'operations'}
            aria-label={mainPanel === 'board' ? inPlacement ? 'ボード操作を表示' : 'ダイス操作を表示' : 'ボードを表示'}
            onClick={() => changeMainPanel(mainPanel === 'board' ? 'operations' : 'board')}>
            <span aria-hidden="true">♻️</span>{mainPanel === 'board' ? '操作へ' : 'ボードへ'}
          </button>}
          {showPreviewEndTurn && mainPanel === 'board' && game && <button type="button" id="preview-end-turn" className="quiet"
            disabled={!canAct || (game.hasLegalPlacement && !game.placedThisRoll)}
            onClick={() => connection.send({ type: 'end-turn', revision: game.revision, turnSequence: game.turnSequence })}>END TURN</button>}
        </div>}
        <div id="main-area-content">
        {trayRoll ? <DiceRollPanel key={trayRoll.id} roll={trayRoll} info={info} setFps={setFps}
          onConfirm={confirm} onDismiss={dismissRoll} stream={connection.frames} onCup={cupSound} />
          : bankSettlement ? <SettlementBank key={settlementKey} event={bankSettlement.event} player={bankSettlement.player}
            audio={bankAudio} reduced={reducedMotion} onComplete={advanceSettlement} />
          : waitingForBoard
          ? <div className="board-loading" role="status">共有盤面を読み込んでいます…</div>
          : mainPanel === 'operations' ? <aside className="turn-card main-operations" id="main-operations"
            aria-labelledby="main-operations-title">
            <div className="turn-heading"><h2 id="main-operations-title">{inPlacement ? 'ボード操作' : 'ダイス操作'}</h2>
              <span>{game?.seats.filter(item => item.online).length ?? 0}人 接続</span></div>
            <div id="turn-commands">
              {inPlacement && game ? <div className="placement-actions">
                <button type="button" id="reroll-dice" className="gold-button"
                  disabled={!canAct || !game.remaining.length || (!game.placedThisRoll && !devReroll)}
                  onClick={() => connection.roll('reroll')}>REROLL</button>
                <button type="button" id="end-turn" className="quiet"
                  disabled={!canAct || (game.hasLegalPlacement && !game.placedThisRoll)}
                  onClick={() => connection.send({ type: 'end-turn', revision: game.revision, turnSequence: game.turnSequence })}>END TURN</button>
              </div> : <button type="button" id="roll-dice" className="gold-button"
                disabled={!canAct || game?.phase !== 'ready'} onClick={() => connection.roll('roll')}>ROLL DICE</button>}
            </div>
            <p className="turn-note">
              {game?.turnNotice === 'no-legal-placement' ? '置けるマスがありません。手番を交代しました。'
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
            {inPlacement && <div className="retained"><h3>確定した出目</h3>
              {remainingResults.length > 0
                ? <ResultStrip list={remainingResults} action={canAct && roll ? selectDie : undefined}
                  chosen={selected?.id} />
                : <span className="waiting-result">配置できる出目は残っていません。</span>}
              {selected && <p className="selection-note" role="status">{GEMS[selected.gem].name}を選択中。ボードの光るマスを選んでください。</p>}
            </div>}
          </aside>
          : <GamblerBoard board={definition} state={board} viewportRef={boardRef} candidates={candidates}
            scoreNotice={stage?.kind === 'score' && settlement && eventTarget ? { rowId: eventTarget.rowId, label: scoreLabel(settlement.points) } : undefined}
            hintCell={comebackHint?.target}
            onSelect={cell => boardAdapter.onSelect(cell, { game, roll, selected, canAct, inPlacement, board, definition })} />}
        </div>
        {effect?.kind === 'BIG_WIN' && eventTarget && <Suspense fallback={null}>
          <SettlementOverlay key={`${settlementKey}-${stageIndex}`} request={effect} target={eventTarget} board={definition}
            boardRef={boardRef} audio={settlementAudio} reduced={reducedMotion} onComplete={advanceSettlement} />
        </Suspense>}
      </section>
      </div>
    </div>}
    {settlement && stage?.kind === 'score' && <p key={settlementKey} className="sr-only" role="status" aria-live="polite">
      {settlement.playerName}　{scoreLabel(settlement.points)}
    </p>}
    {effect && effect.kind !== 'BIG_WIN' && eventTarget && <Suspense fallback={null}>
      <SettlementOverlay key={`${settlementKey}-${stageIndex}`} request={effect} target={eventTarget} board={definition}
        boardRef={boardRef} audio={settlementAudio} reduced={reducedMotion} onComplete={advanceSettlement} />
    </Suspense>}
    </div>
    {perf}
  </main>;
}

export default function DiceScreen({ connection, boardAdapter }: { connection: DiceConnection; boardAdapter: DiceBoardAdapter }) {
  return <App connection={connection} boardAdapter={boardAdapter} />;
}
