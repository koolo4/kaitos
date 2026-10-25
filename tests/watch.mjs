/* Проверки подхвата изменений, сделанных мимо Kaitos (другой редактор, git, скрипт). */

import { mkdtempSync, writeFileSync, rmSync, renameSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reporter, bootApp, wait } from './harness.mjs';
import { createWatcher, isTracked } from '../server/watch.js';
import { createServer } from '../server/index.js';
import { createApi } from '../js/api.js';
import { createRemoteFs } from '../js/fs-remote.js';

const { check, result } = reporter('Слежение за файлами');

await check('какие файлы отслеживаются', () => {
  const tracked = ['src/main.js', 'README.md', 'a/b/c.css', 'data.json'];
  const ignored = [
    'node_modules/x.js',
    '.git/config',
    'dist/bundle.js',
    'image.png',
    'binary',
    '.env',
    'vite.config.js.timestamp-1792917137345-0581204c3432d.mjs',
  ];
  for (const path of tracked) {
    if (!isTracked(path)) throw new Error(`пропущен ${path}`);
  }
  for (const path of ignored) {
    if (isTracked(path)) throw new Error(`лишний ${path}`);
  }
  return `${tracked.length} отслеживается, ${ignored.length} мимо`;
});

const root = mkdtempSync(join(tmpdir(), 'kaitos-watch-'));
mkdirSync(join(root, 'src'), { recursive: true });
writeFileSync(join(root, 'src/main.js'), 'export const a = 1;\n', 'utf8');

await check('наблюдатель сообщает об изменении файла', async () => {
  const watcher = createWatcher({ root }).start();
  const seen = [];
  watcher.onChange((change) => seen.push(change));
  writeFileSync(join(root, 'src/main.js'), 'export const a = 2;\n', 'utf8');
  await wait(400);
  watcher.close();
  if (!seen.length) throw new Error('изменение не замечено');
  if (seen[0].path !== 'src/main.js') throw new Error(`путь: ${seen[0].path}`);
  if (seen[0].type !== 'changed') throw new Error(`тип: ${seen[0].type}`);
  return `${seen.length} событие`;
});

await check('drain отдаёт только новое, начиная с отметки', async () => {
  const watcher = createWatcher({ root }).start();
  const zero = watcher.drain(0);
  writeFileSync(join(root, 'README.md'), '# один\n', 'utf8');
  await wait(300);
  const first = watcher.drain(zero.seq);
  if (!first.changes.length) throw new Error('нет изменений');
  const repeat = watcher.drain(first.seq);
  if (repeat.changes.length) throw new Error('старые изменения пришли повторно');
  writeFileSync(join(root, 'README.md'), '# два\n', 'utf8');
  await wait(300);
  const second = watcher.drain(first.seq);
  watcher.close();
  if (second.changes.length !== 1) throw new Error(`новых: ${second.changes.length}`);
  return `seq ${zero.seq} → ${second.seq}`;
});

await check('служебные папки не вызывают событий', async () => {
  const watcher = createWatcher({ root }).start();
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  writeFileSync(join(root, 'node_modules/pkg.js'), 'x', 'utf8');
  await wait(300);
  const batch = watcher.drain(0);
  watcher.close();
  if (batch.changes.some((change) => change.path.includes('node_modules'))) {
    throw new Error('пришло событие из node_modules');
  }
  return 'тихо';
});

/* --- HTTP --- */

const server = createServer({ root });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;

await check('GET /api/changes отдаёт изменения и отметку', async () => {
  const first = await (await fetch(`${base}/changes?since=0`)).json();
  writeFileSync(join(root, 'src/new-file.js'), 'export const n = 1;\n', 'utf8');
  await wait(400);
  const second = await (await fetch(`${base}/changes?since=${first.seq}`)).json();
  renameSync(join(root, 'src/new-file.js'), join(root, 'src/renamed.js'));
  await wait(400);
  const third = await (await fetch(`${base}/changes?since=${second.seq}`)).json();
  if (!second.changes.length) throw new Error('изменение не пришло');
  if (second.changes[0].path !== 'src/new-file.js') throw new Error(second.changes[0].path);
  if (!third.changes.length) throw new Error('переименование не пришло');
  return `добавлен ${second.changes[0].path}, затем ${third.changes.map((c) => `${c.type}:${c.path}`).join(', ')}`;
});

await check('API отдаёт changes без слежения, если оно выключено', async () => {
  const quiet = createServer({ root, watchFiles: false });
  await new Promise((resolve) => quiet.listen(0, '127.0.0.1', resolve));
  const port = quiet.address().port;
  const data = await (await fetch(`http://127.0.0.1:${port}/api/changes?since=5`)).json();
  await new Promise((resolve) => quiet.close(resolve));
  if (data.changes.length) throw new Error('события при выключенном слежении');
  if (data.watching !== false) throw new Error('watching не false');
  return 'выключено';
});

await new Promise((resolve) => server.close(resolve));

/* --- клиент --- */

function fakeApi({ changes = [], files = { 'src/main.js': 'export const a = 1;\n' } } = {}) {
  const state = { ...files, pending: changes, seq: 0, reads: 0 };
  return {
    state,
    async listFiles() {
      return { files: Object.keys(state).filter((key) => !key.startsWith('__')).sort() };
    },
    async readFile(path) {
      state.reads += 1;
      return { path, content: state[path] ?? '' };
    },
    async writeFile(path, content) {
      state[path] = content;
      return { path, created: true };
    },
    async removeFile(path) {
      delete state[path];
      return { ok: true };
    },
    async changes(since) {
      const batch = {
        seq: since + state.pending.length,
        changes: state.pending.map((change, index) => ({ seq: since + index + 1, ...change })),
      };
      state.pending = [];
      return batch;
    },
  };
}

await check('sync подхватывает правку извне', async () => {
  const api = fakeApi();
  const remote = createRemoteFs({ api, name: 'demo' });
  await remote.load();
  api.state['src/main.js'] = 'export const a = 42;\n'; // «кто-то поправил в другом редакторе»
  api.state.pending = [{ path: 'src/main.js', type: 'changed' }];
  const applied = await remote.sync();
  if (applied.applied.length !== 1) throw new Error(`применено ${applied.applied.length}`);
  if (!remote.read('src/main.js').includes('42')) throw new Error('память не обновилась');
  if (!remote.external.length) throw new Error('журнал изменений пуст');
  return remote.external[0].path;
});

await check('sync добавляет и удаляет файлы', async () => {
  const api = fakeApi();
  const remote = createRemoteFs({ api, name: 'demo' });
  await remote.load();
  api.state['docs/new.md'] = '# новый\n';
  api.state.pending = [{ path: 'docs/new.md', type: 'added' }];
  await remote.sync();
  if (!remote.has('docs/new.md')) throw new Error('файл не добавлен');
  delete api.state['docs/new.md'];
  api.state.pending = [{ path: 'docs/new.md', type: 'removed' }];
  await remote.sync();
  if (remote.has('docs/new.md')) throw new Error('файл не удалён');
  return 'добавлен → удалён';
});

await check('файл с несохранёнными правками не перезаписывается', async () => {
  const api = fakeApi();
  const remote = createRemoteFs({ api, name: 'demo' });
  await remote.load();
  api.state['src/main.js'] = 'версия с диска\n';
  api.state.pending = [{ path: 'src/main.js', type: 'changed' }];
  const outcome = await remote.sync({ dirty: (path) => path === 'src/main.js' });
  if (outcome.applied.length) throw new Error('файл всё-таки перезаписали');
  if (!outcome.skipped.includes('src/main.js')) throw new Error('файл не попал в пропущенные');
  if (remote.read('src/main.js').includes('диска')) throw new Error('зеркало изменилось');
  return 'пропущен';
});

await check('собственная запись не считается изменением извне', async () => {
  const api = fakeApi();
  const remote = createRemoteFs({ api, name: 'demo' });
  await remote.load();
  remote.write('src/main.js', 'правка самого пользователя\n');
  api.state.pending = [{ path: 'src/main.js', type: 'changed' }];
  const outcome = await remote.sync();
  await remote.flush();
  if (outcome.applied.length) throw new Error('своя запись принята за чужую');
  return 'пропущено';
});

await check('startSync сам опрашивает сервер', async () => {
  const api = fakeApi();
  const remote = createRemoteFs({ api, name: 'demo' });
  await remote.load();
  const events = [];
  remote.startSync({ intervalMs: 40, onChange: (batch) => events.push(batch) });
  api.state['src/main.js'] = 'пришло с диска\n';
  api.state.pending = [{ path: 'src/main.js', type: 'changed' }];
  await wait(250);
  remote.stopSync();
  if (!events.length) throw new Error('событий не было');
  if (!remote.read('src/main.js').includes('с диска')) throw new Error('память не обновилась');
  if (remote.watching) throw new Error('опрос не остановлен');
  return `${events.length} событие`;
});

/* --- интерфейс --- */

function liveServer(files) {
  const store = { ...files };
  const queue = [];
  const fetchMock = async (url, options = {}) => {
    const full = String(url);
    const method = options.method || 'GET';
    const json = (status, payload) => ({ ok: status < 400, status, json: async () => payload });
    if (full.includes('/api/health')) return json(200, { ok: true, root: '/home/user/live-demo' });
    if (full.includes('/api/changes')) {
      const since = Number(full.split('since=')[1] || 0);
      const batch = queue.splice(0, queue.length);
      return json(200, { ok: true, seq: since + batch.length, changes: batch, watching: true });
    }
    if (full.includes('/api/files')) return json(200, { ok: true, files: Object.keys(store).sort() });
    if (full.includes('/api/file?path=') && method === 'GET') {
      const path = decodeURIComponent(full.split('path=')[1]);
      return json(200, { ok: true, path, content: store[path] ?? '' });
    }
    if (full.endsWith('/api/file') && method === 'POST') {
      const body = JSON.parse(options.body);
      store[body.path] = body.content;
      return json(200, { ok: true, path: body.path });
    }
    return json(200, { ok: true });
  };
  return { store, queue, fetchMock };
}

await check('интерфейс: правка извне обновляет редактор и дерево', async () => {
  const server = liveServer({ 'src/main.js': 'export const a = 1;\n' });
  const { window, doc, K } = await bootApp({}, { fetchMock: server.fetchMock });
  const row = Array.from(doc.querySelectorAll('.tree-row')).find((item) => item.dataset.path === 'src/main.js');
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  if (!doc.querySelector('#editor-input').value.includes('a = 1')) throw new Error('файл не открылся');

  server.store['src/main.js'] = 'export const a = 99;\n';
  server.store['docs/note.md'] = '# появился снаружи\n';
  server.queue.push({ path: 'src/main.js', type: 'changed' }, { path: 'docs/note.md', type: 'added' });

  await wait(1900);
  const value = doc.querySelector('#editor-input').value;
  if (!value.includes('a = 99')) throw new Error(`редактор не обновился: ${value.trim()}`);
  const paths = Array.from(doc.querySelectorAll('.tree-row')).map((item) => item.dataset.path);
  if (!paths.includes('docs/note.md')) throw new Error('дерево не показало новый файл');
  const log = doc.querySelector('#terminal-output').textContent;
  if (!log.includes('Изменено на диске')) throw new Error('в терминале нет записи');
  return 'редактор и дерево обновлены';
});

await check('интерфейс: несохранённая правка не затирается', async () => {
  const server = liveServer({ 'src/main.js': 'export const a = 1;\n' });
  const { window, doc, K } = await bootApp({}, { fetchMock: server.fetchMock });
  const row = Array.from(doc.querySelectorAll('.tree-row')).find((item) => item.dataset.path === 'src/main.js');
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const input = doc.querySelector('#editor-input');
  input.value = 'моя несохранённая правка\n';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  server.store['src/main.js'] = 'версия другого редактора\n';
  server.queue.push({ path: 'src/main.js', type: 'changed' });
  await wait(1900);
  if (input.value !== 'моя несохранённая правка\n') throw new Error(`ввод потерян: ${input.value.trim()}`);
  if (K.fs.read('src/main.js').includes('другого редактора')) throw new Error('зеркало перезаписано');
  return 'ввод сохранён';
});

rmSync(root, { recursive: true, force: true });
process.exit(result() ? 1 : 0);
