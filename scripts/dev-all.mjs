/*
 * Запускает сервер файлов и Vite: приложение стартует только после того, как сервер
 * действительно начал слушать порт. Это исключает случайный 500 /api/health при старте.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

const children = [];
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
}

function fail(message, code = 1) {
  if (shuttingDown) return;
  console.error(message);
  shutdown();
  process.exitCode = code || 1;
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server/index.js'], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: process.env,
    });
    children.push(child);

    let ready = false;
    let output = '';
    const timeout = setTimeout(() => {
      if (!ready) reject(new Error('Сервер файлов не подтвердил запуск за 10 секунд.'));
    }, 10_000);

    function forward(stream, destination) {
      stream.on('data', (chunk) => {
        destination.write(chunk);
        if (ready) return;
        output = (output + chunk.toString('utf8')).slice(-4000);
        const match = output.match(/Kaitos server: http:\/\/[^:\s]+:(\d+)/);
        if (match) {
          ready = true;
          clearTimeout(timeout);
          resolve({ child, port: Number(match[1]) });
        }
      });
    }

    forward(child.stdout, process.stdout);
    forward(child.stderr, process.stderr);
    child.once('error', (error) => {
      clearTimeout(timeout);
      if (!ready) reject(error);
      else fail(`Сервер файлов завершился с ошибкой: ${error.message}`);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (!ready) {
        reject(new Error(`Сервер файлов завершился до запуска (код ${code ?? signal}).\n${output}`));
      } else if (!shuttingDown) {
        fail(`Сервер файлов неожиданно завершился (код ${code ?? signal}).`);
      }
    });
  });
}

function startVite(port) {
  const child = spawn('npm', ['run', 'dev'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...(!process.env.KAITOS_API ? { KAITOS_API: `http://127.0.0.1:${port}` } : {}),
    },
  });
  children.push(child);
  child.once('error', (error) => fail(`Не удалось запустить Vite: ${error.message}`));
  child.once('exit', (code, signal) => {
    if (!shuttingDown) fail(`Vite неожиданно завершился (код ${code ?? signal}).`);
  });
}

console.log('Запускаю сервер файлов…');
try {
  const { port } = await startServer();
  if (shuttingDown) process.exit(0);
  console.log(`Сервер файлов готов на порту ${port}; запускаю приложение…`);
  startVite(port);
} catch {
  // Ошибка сервера уже выведена из дочернего процесса; не дублируем её второй раз.
  fail('Сервер не запустился: приложение не будет доступно в режиме диска.');
}
