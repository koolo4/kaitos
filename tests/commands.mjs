/* Проверки запуска настоящих команд: сервер, ограничения, HTTP и терминал в интерфейсе. */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reporter, bootApp, wait } from './harness.mjs';
import { createRunner } from '../server/run.js';
import { createServer } from '../server/index.js';

const { check, result } = reporter('Команды на сервере');

const root = mkdtempSync(join(tmpdir(), 'kaitos-run-'));
writeFileSync(join(root, 'marker.txt'), 'я здесь\n', 'utf8');
const runner = createRunner({ root });

await check('простая команда выполняется в папке проекта', async () => {
  // команда Node, а не ls: набор должен проходить и на Windows, и на Linux
  const data = await runner.run('node -e "console.log(process.cwd())"');
  if (data.code !== 0) throw new Error(`код ${data.code}: ${data.output}`);
  if (!data.output.includes('kaitos-run-')) throw new Error(`не тот каталог: ${data.output}`);
  if (data.timedOut) throw new Error('таймаут');
  return data.output.trim().split(/[\\/]/).pop();
});

await check('команда видит файлы проекта', async () => {
  const code = "console.log(require('fs').readdirSync('.').join(','))";
  const data = await runner.run(`node -e "${code}"`);
  if (data.code !== 0) throw new Error(`код ${data.code}: ${data.output}`);
  if (!data.output.includes('marker.txt')) throw new Error(`вывод: ${data.output}`);
  return 'marker.txt на месте';
});

await check('код выхода возвращается', async () => {
  const data = await runner.run('node -e "process.exit(3)"');
  if (data.code !== 3) throw new Error(`код ${data.code}`);
  return `код ${data.code}`;
});

await check('ошибки команды попадают в вывод', async () => {
  const data = await runner.run('node -e "console.error(\'беда\'); process.exit(1)"');
  if (!data.output.includes('беда')) throw new Error(data.output);
  if (data.code !== 1) throw new Error(`код ${data.code}`);
  return 'stderr собран';
});

await check('таймаут останавливает команду', async () => {
  const slow = createRunner({ root, timeoutMs: 250 });
  const started = Date.now();
  const data = await slow.run('node -e "setTimeout(() => {}, 5000)"');
  const took = Date.now() - started;
  if (!data.timedOut) throw new Error('таймаут не сработал');
  if (data.code !== null) throw new Error(`код ${data.code}`);
  if (took > 3000) throw new Error(`ждали ${took} мс`);
  return `${took} мс`;
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
  const data = await small.run('node -e "process.stdout.write(\'x\'.repeat(5000))"');
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

await check('POST /api/run выполняет команду', async () => {
  const response = await post('/run', { command: 'echo проверка' });
  const data = await response.json();
  if (response.status !== 200 || !data.output.includes('проверка')) throw new Error(JSON.stringify(data));
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
    body: JSON.stringify({ command: 'echo нет' }),
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
