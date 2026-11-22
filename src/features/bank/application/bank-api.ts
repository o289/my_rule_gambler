import type { BankTransaction } from '../model/bank-model';
import { BankPlayer } from './bank-player';

export function createBankActions(bank: BankPlayer, reducedMotion: () => boolean) {
  const playBankTransaction = (transaction: BankTransaction) => bank.play(transaction, reducedMotion());
  return { playBankTransaction, compress: () => bank.compress(reducedMotion()), replay: () => bank.replay(reducedMotion()), skip: () => bank.skip(), reset: () => bank.reset() };
}
export type BankActions = ReturnType<typeof createBankActions>;
