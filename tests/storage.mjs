/* Проверки работы с настоящими файлами: клиент API, зеркало на сервере, режимы интерфейса. */

import { bootApp, reporter, wait } from './harness.mjs';
import { createApi } from '../js/api.js';
import { createRemoteFs } from '../js/fs-remote.js';

const { check, result } = reporter('Файлы с диска');

/* Поддельный сервер: держит файлы в объекте и запоминает запросы. */
function fakeServer(files = { 'src/main.js': 'export const a = 1;\n', 'README.md': '# Демо\n' }) {
  const store = { ...files };
  const calls = [];
  const failHealth = { value: false };

  const fetchMock = async (url, options = {}) => {
    const full = String(url);
    const method = options.method || 'GET';
    calls.push({ url: full, method, body: options.body ? JSON.parse(options.body) : null });

    if (failHealth.value) throw new TypeError('Failed to fetch');

    const json = (status, payload) => ({
      ok: status < 400,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    });

    if (full.endsWith('/api/health')) return json(200, { ok: true, root: '/home/user/project-demo', files: Object.keys(store).length });

    if (full.includes('/api/changes')) {
      return json(200, { ok: true, seq: 0, changes: [], watching: true });
    }

    if (full.startsWith('/api/files') || full.includes('/api/files')) {
      return json(200, { ok: true, files: Object.keys(store).sort() });
    }

    if (full.includes('/api/file?path=') && method === 'GET') {
      const path = decodeURIComponent(full.split('path=')[1]);
      if (!(path in store)) return json(400, { ok: false, error: 'Файл не найден' });
      return json(200, { ok: true, path, content: store[path] });
    }

    if (full.endsWith('/api/file') && method === 'POST') {
      const { path, content } = JSON.parse(options.body);
      store[path] = content;
      return json(200, { ok: true, path, created: true });
    }

    if (full.includes('/api/file?path=') && method === 'DELETE') {
      delete store[decodeURIComponent(full.split('path=')[1])];
      return json(200, { ok: true, removed: true });
    }

    return json(404, { ok: false, error: 'нет маршрута' });
  };

  return { store, calls, fetchMock, failHealth };
}

/* --- клиент API --- */

await check('api: health, список, чтение, запись', async () => {
  const fake = fakeServer();
  const previous = globalThis.fetch;
  globalThis.fetch = fake.fetchMock;
  try {
    const api = createApi({ baseUrl: '/api' });
    const health = await api.health();
    if (!health.ok) throw new Error('health не ok');
    const { files } = await api.listFiles();
    if (!files.includes('README.md')) throw new Error('нет файла в списке');
    const file = await api.readFile('README.md');
    if (!file.content.includes('Демо')) throw new Error('нет содержимого');
    await api.writeFile('src/new.js', 'export const n = 1;\n');
    if (!fake.store['src/new.js']) throw new Error('запись не дошла до сервера');
    return `${fake.calls.length} запросов`;
  } finally {
    globalThis.fetch = previous;
  }
});

await check('api: понятные ошибки (сеть, 401, текст сервера)', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    const api = createApi({ baseUrl: '/api' });
    try {
      await api.health();
      throw new Error('ошибки не было');
    } catch (error) {
      if (error.code !== 'network') throw new Error(`код ${error.code}`);
      if (!error.message.includes('недоступен')) throw new Error(error.message);
    }

    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'нужен токен' }) });
    try {
      await api.listFiles();
      throw new Error('ошибки не было');
    } catch (error) {
      if (error.code !== 'auth') throw new Error(`код ${error.code}`);
      if (!error.message.includes('токен')) throw new Error(error.message);
    }
    return 'network + auth';
  } finally {
    globalThis.fetch = previous;
  }
});

/* --- зеркало --- */

await check('fs-remote: загрузка проекта и синхронное чтение', async () => {
  const fake = fakeServer();
  const previous = globalThis.fetch;
  globalThis.fetch = fake.fetchMock;
  try {
    const api = createApi({ baseUrl: '/api' });
    const remote = createRemoteFs({ api, name: '/home/user/project-demo' });
    const stats = await remote.load();
    if (stats.files !== 2) throw new Error(`файлов ${stats.files}`);
    if (remote.name() !== 'project-demo') throw new Error(`имя ${remote.name()}`);
    if (!remote.has('src/main.js')) throw new Error('нет файла');
    if (!remote.read('src/main.js').includes('export const a = 1')) throw new Error('неверное содержимое');
    const tree = remote.tree();
    if (!Array.isArray(tree) || !tree.length) throw new Error('дерево пустое');
    return `${stats.files} файла, имя ${remote.name()}`;
  } finally {
    globalThis.fetch = previous;
  }
});

await check('fs-remote: запись сразу в памяти и в фоне на сервер', async () => {
  const fake = fakeServer();
  const previous = globalThis.fetch;
  globalThis.fetch = fake.fetchMock;
  try {
    const api = createApi({ baseUrl: '/api' });
    const remote = createRemoteFs({ api, name: 'demo' });
    await remote.load();
    remote.write('README.md', '# Изменено\n');
    if (!remote.read('README.md').includes('Изменено')) throw new Error('память не обновилась');
    const flushed = await remote.flush();
    if (flushed.pending !== 0) throw new Error('запросы не завершились');
    if (!fake.store['README.md'].includes('Изменено')) throw new Error('сервер не получил запись');
    return 'память + диск';
  } finally {
    globalThis.fetch = previous;
  }
});

await check('fs-remote: ошибка записи попадает в errors', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/health')) return { ok: true, status: 200, json: async () => ({ ok: true, root: '/p' }) };
    if (String(url).includes('/api/files')) return { ok: true, status: 200, json: async () => ({ ok: true, files: ['a.js'] }) };
    if (options.method === 'POST') return { ok: false, status: 500, json: async () => ({ ok: false, error: 'диск переполнен' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, path: 'a.js', content: 'x' }) };
  };
  try {
    const api = createApi({ baseUrl: '/api' });
    const remote = createRemoteFs({ api, name: 'p' });
    await remote.load();
    remote.write('a.js', 'новое');
    await remote.flush();
    if (!remote.errors.length) throw new Error('ошибка не записана');
    if (!remote.errors[0].message.includes('диск переполнен')) throw new Error(remote.errors[0].message);
    return remote.errors[0].message;
  } finally {
    globalThis.fetch = previous;
  }
});

/* --- интерфейс --- */

await check('интерфейс: режим «диск» и дерево с диска', async () => {
  const fake = fakeServer({ 'src/app.js': 'export const app = 1;\n', 'docs/note.md': '# Заметка\n' });
  const { doc, K } = await bootApp({}, { fetchMock: fake.fetchMock });
  if (!K.storage || K.storage.mode !== 'disk') throw new Error(`режим: ${K.storage && K.storage.mode}`);
  if (!K.fs.remote) throw new Error('файловая система не удалённая');
  const chip = doc.querySelector('#status-storage');
  if (!chip.textContent.startsWith('диск:')) throw new Error(`чип: ${chip.textContent}`);
  if (!doc.querySelector('.tree-row[data-path="docs/note.md"]')) throw new Error('дерево не построено с диска');
  return chip.textContent;
});

await check('интерфейс: правка и Ctrl+S уходят на сервер', async () => {
  const fake = fakeServer();
  const { window, doc, K } = await bootApp({}, { fetchMock: fake.fetchMock });
  const row = Array.from(doc.querySelectorAll('.tree-row')).find((item) => item.dataset.path === 'README.md');
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const input = doc.querySelector('#editor-input');
  input.value = '# Записано на диск\n';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  await K.fs.flush();
  if (!fake.store['README.md'].includes('Записано на диск')) throw new Error('файл не ушёл на сервер');
  return fake.store['README.md'].trim();
});

await check('интерфейс: без сервера — демо-режим', async () => {
  const fake = fakeServer();
  fake.failHealth.value = true;
  const { doc, K } = await bootApp({}, { fetchMock: fake.fetchMock });
  if (K.storage.mode !== 'demo') throw new Error(`режим: ${K.storage.mode}`);
  if (K.fs.remote) throw new Error('включилась удалённая ФС без сервера');
  const chip = doc.querySelector('#status-storage');
  if (!chip.textContent.includes('демо')) throw new Error(`чип: ${chip.textContent}`);
  if (doc.querySelectorAll('.tree-row').length < 4) throw new Error('демо-дерево не построено');
  return `${chip.textContent} (${K.storage.reason})`;
});

await check('интерфейс: дерево и вкладки работают после подключения к диску', async () => {
  const fake = fakeServer({ 'src/main.js': 'export const x = 1;\n', 'src/util.js': 'export const y = 2;\n' });
  const { window, doc, K } = await bootApp({}, { fetchMock: fake.fetchMock });
  const row = Array.from(doc.querySelectorAll('.tree-row')).find((item) => item.dataset.path === 'src/util.js');
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  if (K.editor.active !== 'src/util.js') throw new Error(`открыт ${K.editor.active}`);
  if (!doc.querySelector('#editor-highlight').innerHTML.includes('tok-keyword')) throw new Error('подсветка не работает с диска');
  await wait(50);
  return K.editor.active;
});

process.exit(result() ? 1 : 0);
