/*
 * Запуск команд в папке проекта — для встроенного терминала.
 *
 * Команда уходит в системную оболочку (sh или cmd) с рабочим каталогом проекта,
 * ограничена по времени и объёму вывода. Это осознанно мощная возможность:
 * сервер слушает только 127.0.0.1, а токен включает проверку запросов.
 */

import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT = 60000;
const DEFAULT_LIMIT = 200 * 1024;

export function createRunner({ root, timeoutMs = DEFAULT_TIMEOUT, maxOutput = DEFAULT_LIMIT } = {}) {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/sh';
  const shellArgs = isWindows ? ['/d', '/s', '/c'] : ['-c'];

  function run(command) {
    const text = String(command || '').trim();
    if (!text) {
      return Promise.reject(new Error('Пустая команда'));
    }

    return new Promise((resolve, reject) => {
      const started = Date.now();
      const child = spawn(shell, [...shellArgs, text], {
        cwd: root,
        windowsHide: true,
        env: { ...process.env, KAITOS: '1', GIT_PAGER: 'cat', PAGER: 'cat', TERM: 'dumb' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      let truncated = false;
      let timedOut = false;

      function collect(chunk) {
        if (output.length >= maxOutput) {
          truncated = true;
          return;
        }
        output += chunk.toString('utf8');
        if (output.length > maxOutput) {
          output = `${output.slice(0, maxOutput)}\n… вывод обрезан (больше ${Math.round(maxOutput / 1024)} КБ)`;
          truncated = true;
        }
      }

      child.stdout.on('data', collect);
      child.stderr.on('data', collect);

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      if (timer.unref) timer.unref();

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({
          ok: true,
          command: text,
          code: timedOut || signal === 'SIGKILL' ? null : code,
          output: output.replace(/\r\n/g, '\n'),
          truncated,
          timedOut,
          durationMs: Date.now() - started,
        });
      });
    });
  }

  return { run, root, shell, timeoutMs };
}
