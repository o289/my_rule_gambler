export interface Coin {
  readonly id: string;
  readonly value: number;
}

export const DEMO_PLAYER = { id: 'player-1', name: 'PLAYER 1' };
export const DEMO_WALLET: readonly Coin[] = [
  { id: 'fifty-a', value: 50 },
  { id: 'fifty-b', value: 50 },
  { id: 'fifty-c', value: 50 },
  { id: 'ten-a', value: 10 },
  { id: 'ten-b', value: 10 },
  { id: 'ten-c', value: 10 },
  { id: 'ten-d', value: 10 },
  { id: 'ten-e', value: 10 },
];

export const DEMO_RESERVE: readonly Coin[] = [
  { id: 'bank-fifty-a', value: 50 },
  { id: 'bank-fifty-b', value: 50 },
  { id: 'bank-ten-a', value: 10 },
  { id: 'bank-ten-b', value: 10 },
];

export type BankDirection = 'withdraw' | 'deposit';

export interface BankTransaction {
  readonly type: BankDirection;
  readonly playerId: string;
  readonly amount: number;
}

export const DEMO_TRANSACTIONS: Readonly<Record<BankDirection, BankTransaction>> = {
  withdraw: { type: 'withdraw', playerId: DEMO_PLAYER.id, amount: 100 },
  deposit: { type: 'deposit', playerId: DEMO_PLAYER.id, amount: 100 },
};

export const DEMO_TRANSACTION = DEMO_TRANSACTIONS.withdraw;

export function bankBalance(wallet: readonly Coin[]) {
  return wallet.reduce((sum, coin) => sum + coin.value, 0);
}

export function readBankTransaction(value: unknown, playerId: string): BankTransaction {
  if (typeof value !== 'object' || value === null || !('type' in value) || (value.type !== 'withdraw' && value.type !== 'deposit')) {
    throw new TypeError('取引種別には withdraw または deposit を指定してください。');
  }
  if (!('playerId' in value) || value.playerId !== playerId) throw new RangeError('対象のプレイヤーが見つかりません。');
  if (!('amount' in value) || typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount) || value.amount <= 0) {
    throw new RangeError('取引額は正の整数で指定してください。');
  }
  return { type: value.type, playerId, amount: value.amount };
}

export function selectPayment(wallet: readonly Coin[], amount: number): readonly Coin[] {
  const choices = new Map<number, readonly Coin[]>([[0, []]]);
  for (const coin of [...wallet].sort((left, right) => right.value - left.value)) {
    for (const [total, choice] of [...choices]) {
      const next = total + coin.value;
      if (next > amount) continue;
      const existing = choices.get(next);
      if (!existing || choice.length + 1 < existing.length) choices.set(next, [...choice, coin]);
    }
  }
  const payment = choices.get(amount);
  if (!payment?.length) throw new RangeError('利用できるコインから指定額を用意できません。');
  return payment;
}

export function transferCoins(wallet: readonly Coin[], reserve: readonly Coin[], direction: BankDirection, coins: readonly Coin[]) {
  const ids = new Set(coins.map(coin => coin.id));
  return direction === 'withdraw'
    ? { wallet: wallet.filter(coin => !ids.has(coin.id)), reserve: [...reserve, ...coins] }
    : { wallet: [...wallet, ...coins], reserve: reserve.filter(coin => !ids.has(coin.id)) };
}

export type BankCue = 'confirm' | 'wake' | 'unlock' | 'open' | 'lift' | 'launch' | 'absorb' | 'close' | 'lock' | 'finish';

export interface BankBeat {
  readonly at: number;
  readonly cue: BankCue;
  readonly coin?: Coin;
  readonly index?: number;
}

export const VAULT_DOOR_MS = 670;
export const COIN_TRAVEL_MS = 1060;

export function collectionPlan(coins: readonly Coin[], reduced: boolean): readonly BankBeat[] {
  const beats: BankBeat[] = reduced ? [
    { at: 0, cue: 'confirm' },
    { at: 220, cue: 'wake' },
    { at: 360, cue: 'unlock' },
    { at: 515, cue: 'open' },
    { at: 665, cue: 'lift' },
  ] : [
    { at: 0, cue: 'confirm' },
    { at: 345, cue: 'wake' },
    { at: 580, cue: 'unlock' },
    { at: 1010, cue: 'open' },
    { at: 1535, cue: 'lift' },
  ];

  const first = reduced ? 720 : 1760;
  const spacing = Math.min(reduced ? 190 : 310, Math.floor((reduced ? 680 : 840) / Math.max(1, coins.length - 1)));
  const travel = reduced ? 180 : COIN_TRAVEL_MS;
  for (const [index, coin] of coins.entries()) {
    const launch = first + index * spacing;
    beats.push({ at: launch, cue: 'launch', coin, index }, { at: launch + travel, cue: 'absorb', coin, index });
  }
  const close = first + Math.max(0, coins.length - 1) * spacing + travel + (reduced ? 170 : 245);
  const lock = close + (reduced ? 170 : VAULT_DOOR_MS);
  beats.push({ at: close, cue: 'close' }, { at: lock, cue: 'lock' }, { at: lock + (reduced ? 170 : 350), cue: 'finish' });
  return beats.sort((firstBeat, secondBeat) => firstBeat.at - secondBeat.at);
}
