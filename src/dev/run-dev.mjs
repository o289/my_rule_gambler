import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const children = [];
let stopping = false;

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}

function start(label, command, args, env = process.env) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  children.push(child);
  child.on('error', error => {
    process.stderr.write(`[${label}] ${error.message}\n`);
    stopAll(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      process.stderr.write(`[${label}] 終了しました (${signal ?? code ?? 'unknown'})\n`);
      stopAll(code ?? 1);
    }
  });
  return child;
}

process.once('SIGINT', () => stopAll(0));
process.once('SIGTERM', () => stopAll(0));

start('local-game-servers', process.execPath, ['--import', 'tsx', 'src/platform/local-demo-servers/start-local.ts']);
start('vite-plus', 'vp', ['dev', '--host', '127.0.0.1', '--port', '5178', '--strictPort']);
