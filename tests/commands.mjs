/*
 * Проверки запуска настоящих команд: сервер, ограничения, HTTP и терминал в интерфейсе.
 *
 * Команды запускаются через файлы-скрипты, а не через `node -e "..."`: на Windows
 * вложенные кавычки в аргументах оболочки ведут себя иначе, и тест ломался бы не по делу.
 */

import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reporter, bootApp, wait } from './harness.mjs';
import { createRunner } from '../server/run.js';
import { createServer } from '../server/index.js';

const { check, result } = reporter('Команды на сервере');

const root = mkdtempSync(join(tmpdir(), 'kaitos-run-'));
writeFileSync(join(root, 'marker.txt'), 'я здесь\n', 'utf8');
writeFileSync(join(root, 'cwd.js'), "console.log(process.cwd());\n", 'utf8');
writeFileSync(join(root, 'files.js'), "console.log(require('fs').readdirSync('.').sort().join(','));\n", 'utf8');
writeFileSync(join(root, 'exit3.js'), 'process.exit(3);\n', 'utf8');
writeFileSync(join(root, 'stderr.js'), "console.error('беда'); process.exit(1);\n", 'utf8');
writeFileSync(join(root, 'sleep.js'), 'setTimeout(() => {}, 5000);\n', 'utf8');
writeFileSync(join(root, 'delayed-write.js'), "const fs=require('fs');fs.writeFileSync('started.txt','yes');setTimeout(()=>fs.writeFileSync('after-cancel.txt','bad'),900);\n", 'utf8');
writeFileSync(join(root, 'big.js'), "process.stdout.write('x'.repeat(5000));\n", 'utf8');
writeFileSync(join(root, 'utf8.js'), "console.log('привет, мир');\n", 'utf8');

const runner = createRunner({ root });

await check('простая команда выполняется в папке проекта', async () => {
  const data = await runner.run('node cwd.js');
  if (data.code !== 0) throw new Error(`код ${data.code}: ${data.output}`);
  if (!data.output.includes('kaitos-run-')) throw new Error(`не тот каталог: ${JSON.stringify(data.output)}`);
  if (data.timedOut) throw new Error('таймаут');
  return data.output.trim().split(/[\\/]/).pop();
});

await check('команда видит файлы проекта', async () => {
  const data = await runner.run('node files.js');
  if (data.code !== 0) throw new Error(`код ${data.code}: ${data.output}`);
  if (!data.output.includes('marker.txt')) throw new Error(`вывод: ${JSON.stringify(data.output)}`);
  return 'marker.txt на месте';
});

await check('русский текст приходит без искажений', async () => {
  const data = await runner.run('node utf8.js');
  if (!data.output.includes('привет, мир')) throw new Error(`вывод: ${JSON.stringify(data.output)}`);
  return 'кодировка цела';
});

await check('код выхода возвращается', async () => {
  const data = await runner.run('node exit3.js');
  if (data.code !== 3) throw new Error(`код ${data.code}`);
  return `код ${data.code}`;
});

await check('ошибки команды попадают в вывод', async () => {
  const data = await runner.run('node stderr.js');
  if (!data.output.includes('беда')) throw new Error(JSON.stringify(data.output));
  if (data.code !== 1) throw new Error(`код ${data.code}`);
  return 'stderr собран';
});

await check('таймаут останавливает команду', async () => {
  const slow = createRunner({ root, timeoutMs: 250 });
  const started = Date.now();
  const data = await slow.run('node sleep.js');
  const took = Date.now() - started;
  if (!data.timedOut) throw new Error('таймаут не сработал');
  if (data.code !== null) throw new Error(`код ${data.code}`);
  if (took > 4000) throw new Error(`ждали ${took} мс`);
  return `${took} мс`;
});

await check('AbortSignal останавливает команду и дерево процессов', async () => {
  const controller = new AbortController();
  const pending = runner.run('node sleep.js', { signal: controller.signal });
  setTimeout(() => controller.abort(), 150);
  const data = await pending;
  if (!data.cancelled) throw new Error('команда не помечена остановленной');
  if (data.code !== null) throw new Error(`код ${data.code}`);
  if (data.timedOut) throw new Error('отмечен таймаут вместо отмены');
  return `остановлена за ${data.durationMs} мс`;
});

await check('пустая команда отклоняется', async () => {
  try {
    await runner.run('   ');
    throw new Error('пустая команда прошла');
  } catch (error) {
    if (!error.message.includes('Пустая команда')) throw new Error(error.message);
    return 'отказ';
  }
});

await check('огромный вывод обрезается', async () => {
  const small = createRunner({ root, maxOutput: 700 });
  const data = await small.run('node big.js');
  if (!data.truncated) throw new Error('обрезки не было');
  if (data.output.length > 900) throw new Error(`длина ${data.output.length}`);
  return `${data.output.length} символов`;
});

/* --- HTTP --- */

const server = createServer({ root, watchFiles: false });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
const post = (path, payload) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

await check('отмена HTTP-запроса убивает запущенную команду', async () => {
  const controller = new AbortController();
  const request = fetch(`${base}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'node delayed-write.js' }),
    signal: controller.signal,
  }).catch(() => null);
  const startedAt = Date.now();
  while (!existsSync(join(root, 'started.txt')) && Date.now() - startedAt < 3000) await wait(20);
  if (!existsSync(join(root, 'started.txt'))) throw new Error('команда не стартовала');
  controller.abort();
  await request;
  await wait(1100);
  if (existsSync(join(root, 'after-cancel.txt'))) throw new Error('дочерний процесс не был убит');
  return 'отмена клиента завершила процесс';
});

await check('POST /api/run выполняет команду', async () => {
  const response = await post('/run', { command: 'node utf8.js' });
  const data = await response.json();
  if (response.status !== 200 || !data.output.includes('привет, мир')) throw new Error(JSON.stringify(data));
  return data.output.trim();
});

await check('POST /api/run: пустая команда — 400', async () => {
  const response = await post('/run', { command: '' });
  if (response.status !== 400) throw new Error(`статус ${response.status}`);
  const data = await response.json();
  if (data.ok !== false) throw new Error('нет ошибки');
  return '400';
});

await check('запуск команд можно выключить', async () => {
  const strict = createServer({ root, watchFiles: false, allowRun: false });
  await new Promise((resolve) => strict.listen(0, '127.0.0.1', resolve));
  const port = strict.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'node utf8.js' }),
  });
  await new Promise((resolve) => strict.close(resolve));
  if (response.status !== 400) throw new Error(`статус ${response.status}`);
  return 'выключено';
});

await new Promise((resolve) => server.close(resolve));

/* --- терминал в интерфейсе --- */

function liveServer() {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    const full = String(url);
    const json = (status, payload) => ({ ok: status < 400, status, json: async () => payload });
    if (full.includes('/api/health')) return json(200, { ok: true, root: '/home/user/term-demo' });
    if (full.includes('/api/changes')) return json(200, { ok: true, seq: 0, changes: [], watching: true });
    if (full.includes('/api/git/status')) return json(200, { ok: true, repo: true, branch: 'main', changes: [] });
    if (full.includes('/api/files')) return json(200, { ok: true, files: ['index.js'] });
    if (full.endsWith('/api/run')) {
      const { command } = JSON.parse(options.body);
      calls.push(command);
      return json(200, { ok: true, command, code: 0, output: `выполнено: ${command}\n`, durationMs: 12 });
    }
    if (full.includes('/api/file?path=')) {
      const path = decodeURIComponent(full.split('path=')[1]);
      return json(200, { ok: true, path, content: 'console.log(1);\n' });
    }
    return json(404, { ok: false, error: 'нет маршрута' });
  };
  return { calls, fetchMock };
}

async function typeCommand(window, doc, text) {
  const input = doc.querySelector('#terminal-input');
  input.value = text;
  doc.querySelector('#terminal-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

await check('интерфейс: в режиме диска команда уходит на сервер', async () => {
  const mock = liveServer();
  const { window, doc, K } = await bootApp({}, { fetchMock: mock.fetchMock });
  if (!K.terminal.real) throw new Error('терминал не в режиме диска');
  await typeCommand(window, doc, 'npm test');
  await wait(120);
  if (!mock.calls.includes('npm test')) throw new Error(`вызовы: ${mock.calls.join(',')}`);
  const text = doc.querySelector('#terminal-output').textContent;
  if (!text.includes('выполнено: npm test')) throw new Error('вывода нет');
  if (text.includes('выполняю…')) throw new Error('осталась строка ожидания');
  return 'запрос отправлен';
});

await check('интерфейс: ошибка команды видна в терминале', async () => {
  const mock = liveServer();
  const original = mock.fetchMock;
  mock.fetchMock = async (url, options = {}) => {
    if (String(url).endsWith('/api/run')) {
      return { ok: false, status: 500, json: async () => ({ ok: false, error: 'нет такой программы' }) };
    }
    return original(url, options);
  };
  const { window, doc } = await bootApp({}, { fetchMock: mock.fetchMock });
  await typeCommand(window, doc, 'нет-такой-команды');
  await wait(120);
  const text = doc.querySelector('#terminal-output').textContent;
  if (!text.includes('нет такой программы')) throw new Error(text.slice(-200));
  return 'ошибка показана';
});

await check('интерфейс: кнопку Остановить видно и она отменяет команду', async () => {
  const mock = liveServer();
  const regularFetch = mock.fetchMock;
  mock.fetchMock = async (url, options = {}) => {
    if (String(url).endsWith('/api/run')) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    }
    return regularFetch(url, options);
  };
  const { window, doc } = await bootApp({}, { fetchMock: mock.fetchMock });
  await typeCommand(window, doc, 'node tests/fixtures/long-running.js');
  const button = doc.querySelector('#terminal-stop');
  if (button.hidden) throw new Error('кнопка остановки скрыта');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(100);
  if (!doc.querySelector('#terminal-output').textContent.includes('команда остановлена')) throw new Error('нет сообщения об остановке');
  if (!button.hidden) throw new Error('кнопка осталась видимой');
  if (doc.querySelector('#terminal-input').disabled) throw new Error('поле ввода осталось выключенным');
  return 'кнопка остановила команду';
});

await check('интерфейс: без сервера остаются виртуальные команды', async () => {
  const fetchMock = async () => {
    throw new TypeError('Failed to fetch');
  };
  const { window, doc, K } = await bootApp({}, { fetchMock });
  if (K.terminal.real) throw new Error('терминал считает, что сервер есть');
  await typeCommand(window, doc, 'ls');
  await wait(50);
  const text = doc.querySelector('#terminal-output').textContent;
  if (!text.includes('kaitos:~/demo $ ls')) throw new Error(text.slice(-200));
  if (!text.includes('src')) throw new Error('виртуальный ls ничего не показал');
  return 'демо-режим';
});

await check('интерфейс: в реальном режиме подсказка честная', async () => {
  const mock = liveServer();
  const { window, doc } = await bootApp({}, { fetchMock: mock.fetchMock });
  await typeCommand(window, doc, 'help');
  await wait(50);
  const text = doc.querySelector('#terminal-output').textContent;
  if (!text.includes('настоящие команды')) throw new Error(text.slice(-200));
  if (mock.calls.length) throw new Error('help ушёл на сервер');
  return 'подсказка';
});

rmSync(root, { recursive: true, force: true });
process.exit(result() ? 1 : 0);
