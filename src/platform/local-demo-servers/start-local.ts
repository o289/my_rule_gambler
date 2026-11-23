import { startLocalDemoServers } from './start';

const dicePort = Number(process.env.DICE_PORT ?? '8788');
const casinoPort = Number(process.env.CASINO_PORT ?? '8791');
for (const [name, port] of [['DICE_PORT', dicePort], ['CASINO_PORT', casinoPort]] as const) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError(`${name} は有効なポート番号にしてください。`);
}
const servers = await startLocalDemoServers({ dicePort, casinoPort, allowDev: process.env.DICE_DEV !== '0' });
console.info(`Gambler Dice 3D · http://127.0.0.1:${servers.dicePort}/`);
console.info(`Gambler Casino Entry · http://127.0.0.1:${servers.casinoPort}/`);
process.once('SIGINT', servers.close);
process.once('SIGTERM', servers.close);
