import { useMemo, useState } from 'react';
import BoardScreen from '../../features/board/ui/main';
import { createGoalBoard } from '../../features/board/model/goal-layout';

function randomSeed() {
  return Math.floor(Math.random() * 0x1_0000_0000);
}

export default function BoardPreview() {
  const [seed, setSeed] = useState(randomSeed);
  const board = useMemo(() => createGoalBoard(seed), [seed]);

  function changeBoard() {
    let nextSeed = randomSeed();
    while (createGoalBoard(nextSeed).rows.every((row, index) => row.goalColumnId === board.rows[index]?.goalColumnId)) {
      nextSeed = (nextSeed + 1) >>> 0;
    }
    setSeed(nextSeed);
  }

  return <BoardScreen key={seed} board={board} onNewBoard={changeBoard} />;
}
