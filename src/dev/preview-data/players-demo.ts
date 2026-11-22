import type { PlayerSeed } from '../../features/players/model/player-data';

export const DEMO_PLAYERS: readonly PlayerSeed[] = [
  { id: 'player-1', name: 'PLAYER 1', turnOrder: 1, remainingDice: 5, coins: [{ denomination: 50, count: 6 }, { denomination: 10, count: 2 }] },
  { id: 'player-2', name: 'PLAYER 2', turnOrder: 2, remainingDice: 4, coins: [{ denomination: 50, count: 5 }, { denomination: 10, count: 2 }] },
  { id: 'player-3', name: 'PLAYER 3', turnOrder: 3, remainingDice: 3, coins: [{ denomination: 50, count: 6 }, { denomination: 10, count: 2 }] },
  { id: 'player-4', name: 'PLAYER 4', turnOrder: 4, remainingDice: 2, coins: [{ denomination: 50, count: 3 }, { denomination: 10, count: 3 }] },
  { id: 'player-5', name: 'PLAYER 5', turnOrder: 5, remainingDice: 1, coins: [{ denomination: 50, count: 2 }, { denomination: 10, count: 2 }] },
  { id: 'player-6', name: 'PLAYER 6', turnOrder: 6, remainingDice: 0, coins: [{ denomination: 50, count: 1 }, { denomination: 10, count: 3 }] },
];
