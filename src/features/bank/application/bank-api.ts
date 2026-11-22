import { BankAudio } from '../ui/bank-audio';
import { DEMO_PLAYER, DEMO_WALLET } from '../model/bank-model';
import type { BankTransaction } from '../model/bank-model';
import { BankPlayer } from './bank-player';

export const audio = new BankAudio();
export const bank = new BankPlayer(DEMO_PLAYER.id, DEMO_WALLET, audio);
const lessMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function playBankTransaction(transaction: BankTransaction) {
  return bank.play(transaction, lessMotion());
}

export const bankActions = {
  playBankTransaction,
  replay: () => bank.replay(lessMotion()),
  skip: () => bank.skip(),
  reset: () => bank.reset(),
};
