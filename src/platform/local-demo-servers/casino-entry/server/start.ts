import { startCasinoServer } from './http';

const port = Number(process.env.CASINO_PORT ?? '8791');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('CASINO_PORT は有効なポート番号にしてください。');

const server = await startCasinoServer({ port });
console.info(`Gambler Casino Entry · http://127.0.0.1:${server.port}/`);
process.once('SIGINT', server.close);
process.once('SIGTERM', server.close);
