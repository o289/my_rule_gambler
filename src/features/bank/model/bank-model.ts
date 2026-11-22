export type CoinValue = 10 | 50 | 100;

export interface Coin {
  readonly id: string;
  readonly value: CoinValue;
}

export type BankDirection = 'withdraw' | 'deposit';

export interface BankTransaction {
  readonly type: BankDirection;
  readonly playerId: string;
  readonly amount: number;
  readonly tender?: CoinValue;
}

export const DEFAULT_BANK_AMOUNT = 100;
export const BANK_AMOUNT_STEP = 10;

export function bankBalance(wallet: readonly Coin[]) {
  return wallet.reduce((sum, coin) => sum + coin.value, 0);
}

export function readBankTransaction(value: unknown, playerId: string): BankTransaction {
  if (typeof value !== 'object' || value === null || !('type' in value) || (value.type !== 'withdraw' && value.type !== 'deposit')) {
    throw new TypeError('取引種別には withdraw または deposit を指定してください。');
  }
  if (!('playerId' in value) || value.playerId !== playerId) throw new RangeError('対象のプレイヤーが見つかりません。');
  const amount = readBankAmount('amount' in value ? value.amount : undefined);
  const tender = 'tender' in value ? value.tender : undefined;
  if (tender !== undefined && (value.type !== 'withdraw' || (tender !== 10 && tender !== 50 && tender !== 100))) {
    throw new RangeError('支払いに使う金貨は10点・50点・100点から指定してください。');
  }
  return tender === undefined ? { type: value.type, playerId, amount } : { type: value.type, playerId, amount, tender };
}

function readBankAmount(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value % BANK_AMOUNT_STEP !== 0) {
    throw new RangeError(`取引額は正の${BANK_AMOUNT_STEP}点単位で入力してください。`);
  }
  return value;
}

export function selectPayment(wallet: readonly Coin[], amount: number): readonly Coin[] {
  readBankAmount(amount);
  const available = bankBalance(wallet);
  if (amount > available) throw new RangeError(`移動元の残高は${available}点までです。`);
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

export interface CoinExchange {
  readonly payment: readonly Coin[];
  readonly change: readonly Coin[];
}

export function selectExchange(wallet: readonly Coin[], reserve: readonly Coin[], transaction: BankTransaction): CoinExchange {
  const { type, amount, tender } = transaction;
  if (tender === undefined) {
    return { payment: selectPayment(type === 'withdraw' ? wallet : reserve, amount), change: [] };
  }
  if (type !== 'withdraw' || tender < amount) throw new RangeError('取引額以上の金貨を選んでください。');
  const coin = wallet.find(item => item.value === tender);
  if (!coin) throw new RangeError(`${tender}点金貨を所持していません。`);
  if (tender === amount) return { payment: [coin], change: [] };
  try {
    return { payment: [coin], change: selectPayment(reserve, tender - amount) };
  } catch (error) {
    if (error instanceof RangeError) throw new RangeError(`金庫から${tender - amount}点のお釣りを用意できません。`);
    throw error;
  }
}

export interface CoinCompression {
  readonly inputs: readonly Coin[];
  readonly output: Coin;
}

const COMPRESSION_RULES = [[10, 5, 50], [50, 2, 100]] as const;

function groupForCompression(wallet: readonly Coin[]) {
  for (const [value, count, next] of COMPRESSION_RULES) {
    const inputs = wallet.filter(coin => coin.value === value).slice(0, count);
    if (inputs.length === count) return { inputs, next };
  }
  return null;
}

export function canCompress(wallet: readonly Coin[]) { return groupForCompression(wallet) !== null; }

export function applyCompression(wallet: readonly Coin[], step: CoinCompression) {
  const consumed = new Set(step.inputs.map(coin => coin.id));
  return [...wallet.filter(coin => !consumed.has(coin.id)), step.output];
}

export function planCompression(wallet: readonly Coin[], makeCoin: (value: CoinValue) => Coin) {
  const steps: CoinCompression[] = [];
  let current = wallet;
  for (let group = groupForCompression(current); group; group = groupForCompression(current)) {
    const step = { inputs: group.inputs, output: makeCoin(group.next) };
    steps.push(step);
    current = applyCompression(current, step);
  }
  return steps;
}

export function transferCoins(wallet: readonly Coin[], reserve: readonly Coin[], direction: BankDirection, coins: readonly Coin[]) {
  const ids = new Set(coins.map(coin => coin.id));
  return direction === 'withdraw'
    ? { wallet: wallet.filter(coin => !ids.has(coin.id)), reserve: [...reserve, ...coins] }
    : { wallet: [...wallet, ...coins], reserve: reserve.filter(coin => !ids.has(coin.id)) };
}

export type BankCue = 'confirm' | 'wake' | 'unlock' | 'open' | 'lift' | 'launch' | 'absorb' | 'close' | 'lock' | 'finish' | 'change' | 'merge' | 'mint';

export interface BankBeat {
  readonly at: number;
  readonly cue: BankCue;
  readonly coin?: Coin;
  readonly index?: number;
  readonly direction?: BankDirection;
}

export const VAULT_DOOR_MS = 670;
export const COIN_TRAVEL_MS = 1060;

export function collectionPlan(
  coins: readonly Coin[],
  reduced: boolean,
  direction: BankDirection = 'withdraw',
  change: readonly Coin[] = [],
): readonly BankBeat[] {
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

  const travel = reduced ? 180 : COIN_TRAVEL_MS;
  function flights(group: readonly Coin[], first: number, direction: BankDirection) {
    const spacing = Math.min(reduced ? 190 : 310, Math.floor((reduced ? 680 : 840) / Math.max(1, group.length - 1)));
    for (const [index, coin] of group.entries()) {
      const launch = first + index * spacing;
      beats.push({ at: launch, cue: 'launch', coin, index, direction },
        { at: launch + travel, cue: 'absorb', coin, index, direction });
    }
    return first + Math.max(0, group.length - 1) * spacing + travel;
  }

  let finalLanding = flights(coins, reduced ? 720 : 1760, direction);
  if (change.length) {
    beats.push({ at: finalLanding + (reduced ? 80 : 135), cue: 'change', direction: 'deposit' });
    finalLanding = flights(change, finalLanding + (reduced ? 160 : 420), 'deposit');
  }
  const close = finalLanding + (reduced ? 170 : 245);
  const lock = close + (reduced ? 170 : VAULT_DOOR_MS);
  beats.push({ at: close, cue: 'close' }, { at: lock, cue: 'lock' }, { at: lock + (reduced ? 170 : 350), cue: 'finish' });
  return beats.sort((firstBeat, secondBeat) => firstBeat.at - secondBeat.at);
}


export const COMPRESSION_GATHER_MS = 670;
export const COMPRESSION_MINT_MS = 410;
export function compressionTiming(reduced: boolean) {
  return reduced ? { gather: 135, mint: 200 } : { gather: COMPRESSION_GATHER_MS, mint: COMPRESSION_MINT_MS };
}
