import type { Coin } from '../../features/bank/model/bank-model';

export const DEMO_PLAYER = { id: 'player-1', name: 'PLAYER 1' };
export const DEMO_WALLET: readonly Coin[] = [
  { id: 'hundred-a', value: 100 }, { id: 'fifty-a', value: 50 },
  { id: 'ten-a', value: 10 }, { id: 'ten-b', value: 10 }, { id: 'ten-c', value: 10 }, { id: 'ten-d', value: 10 }, { id: 'ten-e', value: 10 },
];
export const DEMO_RESERVE: readonly Coin[] = [
  { id: 'bank-hundred-a', value: 100 }, { id: 'bank-hundred-b', value: 100 },
  { id: 'bank-fifty-a', value: 50 }, { id: 'bank-ten-a', value: 10 }, { id: 'bank-ten-b', value: 10 },
  { id: 'bank-ten-c', value: 10 }, { id: 'bank-ten-d', value: 10 }, { id: 'bank-ten-e', value: 10 },
];
