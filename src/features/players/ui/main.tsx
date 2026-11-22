import { memo, useRef, useState, useSyncExternalStore } from 'react';
import type { Ref } from 'react';
import { GamblerBoard } from '../../board/ui/GamblerBoard';
import { initialState, updateBoard } from '../../board/model/board-model';
import type { BoardDefinition } from '../../board/model/board-model';
import '../../board/ui/style.css';
import { PlayerInfoDemoControls } from './demo-controls';
import { ScoreChangeNotification, useScoreNotifications } from './notifications';
import { PlayerInfoStore } from '../model/player-data';
import { PlayerInfoModal } from './player-modal';
import type { PlayerModalHandle } from './player-modal';
import { CrownIcon } from './vip-icons';
import './style.css';


export function VIPPlayersButton({ buttonRef, open, onClick }: { buttonRef: Ref<HTMLButtonElement>; open: boolean; onClick: () => void }) {
  return (
    <button ref={buttonRef} type="button" className="vip-players-button" id="vip-players-button"
      aria-haspopup="dialog" aria-controls="vip-players-dialog" aria-expanded={open} onClick={onClick}>
      <CrownIcon /><span lang="en">VIP PLAYERS</span>
    </button>
  );
}

const GameBoard = memo(function GameBoard({ board }: { board: BoardDefinition }) {
  const [state, setState] = useState(() => initialState(board));
  return (
    <div className="vip-game-board">
      <GamblerBoard board={board} state={state} viewportRef={null}
        onSelect={cell => setState(current => updateBoard(board, current, { type: 'select-cell', cell }))} />
    </div>
  );
});

function App({ board, store }: { board: BoardDefinition; store: PlayerInfoStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { notices, clear } = useScoreNotifications(store);
  const modal = useRef<PlayerModalHandle>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <main className="vip-app">
      <header className="vip-masthead">
        <div className="vip-brand" aria-label="Atelier Noir">
          <svg viewBox="0 0 32 32" width="32" height="32" fill="none" aria-hidden="true">
            <path d="M16 1.5 30.5 16 16 30.5 1.5 16Z M16 7l9 9-9 9-9-9Z M16 11.5l4.5 4.5-4.5 4.5-4.5-4.5Z" stroke="currentColor" />
            <path d="M16 1.5v10m0 9v10M1.5 16h10m9 0h10" stroke="currentColor" />
          </svg>
          <span>ATELIER NOIR</span>
        </div>
        <VIPPlayersButton buttonRef={opener} open={open} onClick={() => modal.current?.open()} />
      </header>
      <h1 className="sr-only">ギャンブラー</h1>
      <GameBoard board={board} />
      <PlayerInfoDemoControls store={store} snapshot={snapshot} onReset={() => { clear(); store.reset(); }} />
      <PlayerInfoModal ref={modal} snapshot={snapshot} opener={opener} onVisibilityChange={setOpen} />
      <ScoreChangeNotification notices={notices} />
    </main>
  );
}

export default function PlayersScreen({ board, store }: { board: BoardDefinition; store: PlayerInfoStore }) {
  return <App board={board} store={store} />;
}
