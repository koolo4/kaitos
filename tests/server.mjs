/* Проверки локального сервера файлов: защита путей, файловые операции, HTTP API. */

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { reporter } from './reporter.mjs';
import { createPathGuard, toPosix, assertFileName } from '../server/paths.js';
import { createFileService } from '../server/files.js';
import { createServer } from '../server/index.js';

const { check, result } = reporter('Локальный сервер');

const root = mkdtempSync(join(tmpdir(), 'kaitos-'));
mkdirSync(join(root, 'src'), { recursive: true });
mkdirSync(join(root, 'node_modules'), { recursive: true });
writeFileSync(join(root, 'src/main.js'), "export const x = 1;\n", 'utf8');
writeFileSync(join(root, 'README.md'), '# Демо\n', 'utf8');
writeFileSync(join(root, 'node_modules/secret.js'), 'nope', 'utf8');

await check('защита путей блокирует выход за проект', () => {
  const guard = createPathGuard(root);
  const bad = ['../outside.txt', '../../etc/passwd', 'src/../../evil.js', '/etc/passwd', 'C:\\Windows\\x.js'];
  for (const path of bad) {
    let blocked = false;
    try {
      guard.resolveInside(path);
    } catch (error) {
      blocked = true;
    }
    if (!blocked) throw new Error(`пропущен путь ${path}`);
  }
  const ok = guard.resolveInside('src/main.js');
  if (toPosix(ok.absolute) !== 'src/main.js' && !toPosix(ok.absolute).endsWith('/src/main.js')) {
    throw new Error(`нормальный путь не разрешён: ${ok.absolute}`);
  }
  return `${bad.length} путей заблокировано`;
});

await check('защита путей закрывает служебные папки', () => {
  const guard = createPathGuard(root);
  for (const path of ['node_modules/secret.js', '.git/config', '.justai/token']) {
    if (guard.isInside(path)) throw new Error(`доступна служебная папка: ${path}`);
  }
  return 'node_modules, .git, .justai';
});

await check('toPosix и assertFileName', () => {
  if (toPosix('./a\\b/c.js') !== 'a/b/c.js') throw new Error(toPosix('./a\\b/c.js'));
  const bad = ['', '..', 'a/b.js', 'bad:name.js', 'x\0y'];
  for (const name of bad) {
    let blocked = false;
    try {
      assertFileName(name);
    } catch (error) {
      blocked = true;
    }
    if (!blocked) throw new Error(`пропущено имя «${name}»`);
  }
  if (assertFileName('ok.js') !== 'ok.js') throw new Error('нормальное имя не принято');
  return true;
});

const files = createFileService(root);

await check('список файлов без node_modules', async () => {
  const list = await files.list();
  if (!list.includes('src/main.js')) throw new Error(`нет src/main.js: ${list.join(',')}`);
  if (!list.includes('README.md')) throw new Error('нет README.md');
  if (list.some((path) => path.startsWith('node_modules'))) throw new Error('node_modules попал в список');
  return `${list.length} файлов`;
});

await check('чтение и запись файла', async () => {
  const content = await files.read('src/main.js');
  if (!content.includes('export const x = 1;')) throw new Error('неверное содержимое');
  const written = await files.write('src/new/deep.js', 'export const deep = true;\n');
  if (!written.created) throw new Error('файл не помечен как созданный');
  const onDisk = readFileSync(join(root, 'src/new/deep.js'), 'utf8');
  if (!onDisk.includes('deep = true')) throw new Error('файл не записан на диск');
  return written.path;
});

await check('создание не перезаписывает существующий файл', async () => {
  try {
    await files.create('README.md', 'x');
    throw new Error('перезапись разрешена');
  } catch (error) {
    if (!error.message.includes('Уже существует')) throw new Error(error.message);
    return true;
  }
});

await check('удаление файла', async () => {
  await files.remove('src/new/deep.js');
  if (existsSync(join(root, 'src/new/deep.js'))) throw new Error('файл остался на диске');
  return true;
});

await check('stat и отсутствующий файл', async () => {
  const info = await files.stat('README.md');
  if (!info || info.type !== 'file') throw new Error('stat не нашёл файл');
  const missing = await files.stat('нет-такого.js');
  if (missing !== null) throw new Error('stat вернул данные для отсутствующего файла');
  return `${info.size} байт`;
});

/* --- HTTP API --- */

// watchFiles: false — слежение проверяется отдельным набором; на Windows рекурсивный
// наблюдатель иногда роняет процесс при закрытии.
const server = createServer({ root, watchFiles: false });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}/api`;

const api = {
  async get(path) {
    const response = await fetch(`${base}${path}`);
    return { status: response.status, body: await response.json() };
  },
  async post(path, payload) {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  },
  async del(path) {
    const response = await fetch(`${base}${path}`, { method: 'DELETE' });
    return { status: response.status, body: await response.json() };
  },
};

await check('GET /api/health', async () => {
  const { status, body } = await api.get('/health');
  if (status !== 200 || body.ok !== true) throw new Error(JSON.stringify(body));
  if (body.root !== root) throw new Error('неверный корень');
  if (typeof body.files !== 'number') throw new Error('нет числа файлов');
  return `${body.files} файлов`;
});

await check('health не падает даже при проблемах с обходом', async () => {
  const emptyRoot = mkdtempSync(join(tmpdir(), 'kaitos-empty-'));
  const quiet = createServer({ root: emptyRoot, watchFiles: false });
  await new Promise((resolve) => quiet.listen(0, '127.0.0.1', resolve));
  const port = quiet.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  const body = await response.json();
  await new Promise((resolve) => quiet.close(resolve));
  rmSync(emptyRoot, { recursive: true, force: true });
  if (response.status !== 200) throw new Error(`статус ${response.status}`);
  if (body.ok !== true) throw new Error(JSON.stringify(body));
  if (body.files !== 0) throw new Error(`файлов ${body.files}`);
  return 'пустой проект — 200';
});

await check('GET /api/files', async () => {
  const { body } = await api.get('/files');
  if (!body.files.includes('src/main.js')) throw new Error('нет файла в списке');
  return `${body.files.length} файлов`;
});

await check('GET /api/file отдаёт содержимое', async () => {
  const { body } = await api.get('/file?path=src/main.js');
  if (!body.content.includes('export const x')) throw new Error('нет содержимого');
  return body.path;
});

await check('POST /api/file записывает файл', async () => {
  const { status, body } = await api.post('/file', { path: 'src/from-api.js', content: 'export const api = 1;\n' });
  if (status !== 200 || body.ok !== true) throw new Error(JSON.stringify(body));
  const onDisk = readFileSync(join(root, 'src/from-api.js'), 'utf8');
  if (!onDisk.includes('api = 1')) throw new Error('файл не записан');
  return body.path;
});

await check('DELETE /api/file удаляет файл', async () => {
  const { status } = await api.del('/file?path=src/from-api.js');
  if (status !== 200) throw new Error(`статус ${status}`);
  if (existsSync(join(root, 'src/from-api.js'))) throw new Error('файл остался');
  return true;
});

await check('API не выпускает за пределы проекта', async () => {
  const attempts = ['../outside.txt', '/etc/passwd', 'node_modules/secret.js'];
  for (const path of attempts) {
    const { status, body } = await api.get(`/file?path=${encodeURIComponent(path)}`);
    if (status !== 400 || body.ok !== false) throw new Error(`${path}: статус ${status}`);
  }
  const write = await api.post('/file', { path: '../evil.js', content: 'x' });
  if (write.status !== 400) throw new Error('запись вне проекта не заблокирована');
  return `${attempts.length + 1} попыток отклонено`;
});

await check('API отвечает понятной ошибкой на плохой ввод', async () => {
  const noPath = await api.get('/file');
  if (noPath.status !== 400) throw new Error('нет пути — не 400');
  const badJson = await fetch(`${base}/file`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  if (badJson.status !== 400) throw new Error('битый JSON — не 400');
  const unknown = await api.get('/unknown');
  if (unknown.status !== 404) throw new Error('неизвестный маршрут — не 404');
  return true;
});

await check('токен: без заголовка 401, с заголовком 200', async () => {
  const guarded = createServer({ root, token: 'secret-token', watchFiles: false });
  await new Promise((resolve) => guarded.listen(0, '127.0.0.1', resolve));
  const guardedPort = guarded.address().port;
  const noToken = await fetch(`http://127.0.0.1:${guardedPort}/api/health`);
  const withToken = await fetch(`http://127.0.0.1:${guardedPort}/api/health`, {
    headers: { 'X-Kaitos-Token': 'secret-token' },
  });
  await new Promise((resolve) => guarded.close(resolve));
  if (noToken.status !== 401) throw new Error(`без токена: ${noToken.status}`);
  if (withToken.status !== 200) throw new Error(`с токеном: ${withToken.status}`);
  return true;
});

/*
 * Ловит поломку «файл не считается главным»: на Windows в argv[1] обратные слэши,
 * и проверка через endsWith('server/index.js') всегда ложна — сервер молча не стартует.
 */
await check('GET /api/search возвращает только безопасные источники', async () => {
  const html = `
    <div class="result"><a class="result__a" href="https://example.org/docs">Example &amp; docs</a>
      <a class="result__snippet">Полезный <b>фрагмент</b> для поиска.</a></div>
    <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.net%2Fguide">Guide</a>
      <span class="result__snippet">Второй источник.</span></div>
    <div class="result"><a class="result__a" href="javascript:alert(1)">опасная ссылка</a></div>`;
  let capturedQuery = '';
  const featureServer = createServer({
    root, watchFiles: false,
    searchProvider: async (query) => { capturedQuery = query; return html; },
  });
  await new Promise((resolve) => featureServer.listen(0, '127.0.0.1', resolve));
  const response = await fetch(`http://127.0.0.1:${featureServer.address().port}/api/search?q=${encodeURIComponent('проверка Kaitos')}`);
  const body = await response.json();
  await new Promise((resolve) => featureServer.close(resolve));
  if (response.status !== 200 || capturedQuery !== 'проверка Kaitos') throw new Error(JSON.stringify(body));
  if (body.results.length !== 2) throw new Error(`результатов ${body.results.length}`);
  if (body.results[0].title !== 'Example & docs' || !body.results[0].snippet.includes('Полезный фрагмент')) throw new Error(JSON.stringify(body.results[0]));
  if (body.results[1].url !== 'https://example.net/guide') throw new Error(body.results[1].url);
  return `${body.results.length} ссылок, опасная схема отфильтрована`;
});

await check('поиск валидирует запрос до обращения к провайдеру', async () => {
  let providerCalls = 0;
  const featureServer = createServer({
    root, watchFiles: false,
    searchProvider: async () => { providerCalls += 1; return ''; },
  });
  await new Promise((resolve) => featureServer.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${featureServer.address().port}/api/search`;
  const empty = await fetch(endpoint);
  const tooLong = await fetch(`${endpoint}?q=${'x'.repeat(501)}`);
  await new Promise((resolve) => featureServer.close(resolve));
  if (empty.status !== 400 || tooLong.status !== 400) throw new Error(`empty=${empty.status}, long=${tooLong.status}`);
  if (providerCalls !== 0) throw new Error(`провайдер вызван ${providerCalls} раз`);
  return 'пустая и слишком длинная строка отклонены без внешнего запроса';
});

await check('POST /api/browser/screenshot ограничивает цель и размеры', async () => {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(800, 16);
  png.writeUInt32BE(600, 20);
  let captureCalls = 0;
  const featureServer = createServer({
    root, token: 'screen-token', watchFiles: false,
    screenshotCapture: async ({ url, width, height }) => {
      captureCalls += 1;
      if (url !== 'http://localhost:5173/' || width !== 800 || height !== 600) throw new Error('параметры потеряны');
      return png;
    },
  });
  await new Promise((resolve) => featureServer.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${featureServer.address().port}/api/browser/screenshot`;
  const valid = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kaitos-Token': 'screen-token' },
    body: JSON.stringify({ url: 'http://localhost:5173/', width: 800, height: 600 }),
  });
  const body = await valid.json();
  const remote = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kaitos-Token': 'screen-token' },
    body: JSON.stringify({ url: 'http://example.com/', width: 800, height: 600 }),
  });
  const invalidSize = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kaitos-Token': 'screen-token' },
    body: JSON.stringify({ url: 'http://127.0.0.1/', width: 2000, height: 600 }),
  });
  const unauthorized = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1/', width: 800, height: 600 }),
  });
  await new Promise((resolve) => featureServer.close(resolve));
  if (valid.status !== 200 || body.width !== 800 || body.height !== 600 || body.mimeType !== 'image/png') throw new Error(JSON.stringify(body));
  if (Buffer.from(body.imageBase64, 'base64').length !== png.length) throw new Error('base64 изображения повреждён');
  if (remote.status !== 400 || invalidSize.status !== 400) throw new Error(`remote=${remote.status}, size=${invalidSize.status}`);
  if (unauthorized.status !== 401) throw new Error(`без токена: ${unauthorized.status}`);
  if (captureCalls !== 1) throw new Error(`браузер вызван ${captureCalls} раз`);
  return 'localhost разрешён; удалённый адрес, неверный размер и отсутствие токена отклонены';
});

await check('сервер запускается как отдельная программа', async () => {
  const port = 5900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: join(dirname(fileURLToPath(import.meta.url)), '..'),
    env: { ...process.env, KAITOS_PORT: String(port), KAITOS_ROOT: root },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (chunk) => {
    out += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    out += chunk.toString('utf8');
  });

  // ждём приглашения в выводе, но не дольше 5 секунд
  const started = Date.now();
  while (!out.includes('Kaitos server:') && Date.now() - started < 5000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  let answered = false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    answered = response.status === 200;
  } catch (error) {
    answered = false;
  }

  child.kill('SIGKILL');
  if (!out.includes('Kaitos server:')) throw new Error(`сервер не запустился, вывод: ${JSON.stringify(out)}`);
  if (!answered) throw new Error('сервер не ответил на /api/health');
  return `запустился на ${port} и ответил`;
});

await new Promise((resolve) => server.close(resolve));
rmSync(root, { recursive: true, force: true });

process.exit(result() ? 1 : 0);
