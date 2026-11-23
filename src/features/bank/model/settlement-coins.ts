import type { Coin } from './bank-model';

export interface SettlementCoinMoves {
  readonly outgoing: readonly Coin[];
  readonly incoming: readonly Coin[];
}

export function settlementCoinMoves(prefix: string, points: number): SettlementCoinMoves {
  if (!Number.isSafeInteger(points) || points % 10 !== 0) throw new RangeError('金貨移動は確定得失点の10点単位で指定してください。');
  const amount = Math.abs(points);
  const coins: Coin[] = [];
  let remaining = amount;
  let index = 0;
  for (const denomination of [100, 50, 10] as const) {
    while (remaining >= denomination) {
      coins.push({ id: `${prefix}-${denomination}-${++index}`, value: denomination });
      remaining -= denomination;
    }
  }
  return points < 0 ? { outgoing: coins, incoming: [] }
    : { outgoing: [], incoming: coins };
}

export function settlementPlaybackCoins(scoreAfter: number, points: number) {
  const { incoming, outgoing } = settlementCoinMoves('transaction', points);
  const remainder = Math.min(scoreAfter, scoreAfter - points);
  const { incoming: wallet } = settlementCoinMoves('wallet', remainder);
  return { wallet: [...wallet, ...outgoing], reserve: incoming };
}
