import BankScreen from '../../features/bank/ui/main';
import { BankPlayer } from '../../features/bank/application/bank-player';
import { createBankActions } from '../../features/bank/application/bank-api';
import { BankAudio } from '../../features/bank/ui/bank-audio';
import { DEMO_PLAYER, DEMO_RESERVE, DEMO_WALLET } from '../../dev/preview-data/bank-demo';

const audio = new BankAudio();
const bank = new BankPlayer(DEMO_PLAYER.id, DEMO_WALLET, audio, DEMO_RESERVE);
const api = createBankActions(bank, () => matchMedia('(prefers-reduced-motion: reduce)').matches);

declare global { interface Window { gamblerBank: typeof api; } }
window.gamblerBank = Object.freeze(api);

export default function BankPreview() {
  return <StrictMode><BankScreen bank={bank} audio={audio} api={api} demo={{
    playerId: DEMO_PLAYER.id,
    playerName: DEMO_PLAYER.name,
    initialWallet: DEMO_WALLET,
    initialReserve: DEMO_RESERVE,
  }} /></StrictMode>;
}
import { StrictMode } from 'react';
