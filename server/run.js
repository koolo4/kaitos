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

/*
 * Убивает команду вместе с дочерними процессами.
 * С shell: true одного kill('SIGKILL') мало: оболочка умирает, а запущенная ею программа продолжает жить.
 */
function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL'); // своя группа процессов — см. detached ниже
  } catch (error) {
    child.kill('SIGKILL');
  }
}

export function createRunner({ root, timeoutMs = DEFAULT_TIMEOUT, maxOutput = DEFAULT_LIMIT } = {}) {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/sh';

  /*
   * Команда отдаётся оболочке целиком (shell: true): Node сам экранирует аргументы под cmd или sh.
   * Ручные кавычки здесь не работают — cmd получает их как часть команды.
   * На Windows ещё и переключаем кодовую страницу на UTF-8, иначе русский текст приходит «кракозябрами».
   */
  function shellCommand(text) {
    return isWindows ? `chcp 65001>nul & ${text}` : text;
  }

  function run(command, { signal = null } = {}) {
    const text = String(command || '').trim();
    if (!text) {
      return Promise.reject(new Error('Пустая команда'));
    }

    return new Promise((resolve, reject) => {
      const started = Date.now();
      if (signal?.aborted) {
        resolve({ ok: true, command: text, code: null, output: '', truncated: false, timedOut: false, cancelled: true, durationMs: 0 });
        return;
      }
      const child = spawn(shellCommand(text), {
        cwd: root,
        shell: true,
        detached: process.platform !== 'win32',
        windowsHide: true,
        env: { ...process.env, KAITOS: '1', GIT_PAGER: 'cat', PAGER: 'cat', TERM: 'dumb' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      let truncated = false;
      let timedOut = false;
      let cancelled = false;

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
        killTree(child);
      }, timeoutMs);
      if (timer.unref) timer.unref();

      const cancel = () => {
        if (timedOut || cancelled) return;
        cancelled = true;
        killTree(child);
      };
      signal?.addEventListener('abort', cancel, { once: true });

      child.on('error', (error) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        reject(error);
      });

      child.on('close', (code, childSignal) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        resolve({
          ok: true,
          command: text,
          code: timedOut || cancelled || childSignal === 'SIGKILL' ? null : code,
          output: output.replace(/\r\n/g, '\n'),
          truncated,
          timedOut,
          cancelled,
          durationMs: Date.now() - started,
        });
      });
    });
  }

  return { run, root, shell, timeoutMs };
}
