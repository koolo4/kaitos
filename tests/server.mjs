/* Проверки локального сервера файлов: защита путей, файловые операции, HTTP API. */

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

await new Promise((resolve) => server.close(resolve));
rmSync(root, { recursive: true, force: true });

process.exit(result() ? 1 : 0);
