/*
 * Запускает сразу сервер файлов и Vite: npm run dev:full.
 * Кроссплатформенно (Windows, macOS, Linux) — без `&` в npm-скриптах.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

const children = [];

function run(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
  child.on('exit', (code) => {
    if (code && code !== 0) console.log(`[${name}] завершился с кодом ${code}`);
  });
  children.push(child);
  return child;
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

console.log('Запускаю сервер файлов (5178) и приложение (5173)…');
run('server', process.execPath, ['server/index.js']);
run('vite', 'npm', ['run', 'dev']);
