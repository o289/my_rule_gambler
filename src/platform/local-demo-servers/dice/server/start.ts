import { startDiceServer } from './http';

const port = Number(process.env.DICE_PORT ?? '8788');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('DICE_PORT は有効なポート番号にしてください。');

const server = await startDiceServer({ port, allowDev: process.env.DICE_DEV !== '0' });
console.info(`Gambler Dice 3D · http://127.0.0.1:${server.port}/`);
process.once('SIGINT', server.close);
process.once('SIGTERM', server.close);
