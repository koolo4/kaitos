/*
 * Файловая система поверх локального сервера.
 *
 * Устроена как зеркало: при запуске проект читается с диска в память, поэтому все
 * синхронные вызовы (read/has/list/tree) работают как в демо-режиме, а запись
 * сразу меняет память и в фоне уходит на сервер. Так редактор, дерево и чат
 * не пришлось переписывать на async.
 */

import { createFs } from './fs.js';

export function createRemoteFs({ api, name = 'project' }) {
  const base = createFs({});
  const pending = new Map(); // path -> Promise
  const errors = [];
  let loaded = false;

  function projectName() {
    const parts = String(name || 'project').split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || 'project';
  }

  /* Читает список и содержимое файлов с сервера. */
  async function load() {
    const { files = [] } = await api.listFiles();
    const contents = await Promise.all(
      files.map(async (path) => {
        try {
          const data = await api.readFile(path);
          return [path, data.content ?? ''];
        } catch (error) {
          return null; // двоичный или слишком большой файл — пропускаем
        }
      }),
    );
    const map = {};
    for (const item of contents) {
      if (item) map[item[0]] = item[1];
    }
    base.load(map);
    loaded = true;
    return { files: Object.keys(map).length, skipped: files.length - Object.keys(map).length };
  }

  function schedule(path, action) {
    const previous = pending.get(path) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(action)
      .catch((error) => {
        errors.push({ path, message: error.message, at: Date.now() });
        return null;
      })
      .finally(() => {
        if (pending.get(path) === next) pending.delete(path);
      });
    pending.set(path, next);
    return next;
  }

  function write(path, text) {
    const key = base.write(path, text);
    if (loaded) schedule(key, () => api.writeFile(key, String(text ?? '')));
    return key;
  }

  function create(path, text = '') {
    const key = base.create(path, text);
    if (loaded) schedule(key, () => api.writeFile(key, String(text ?? '')));
    return key;
  }

  function remove(path) {
    const key = base.normalize(path);
    base.remove(key);
    if (loaded) schedule(key, () => api.removeFile(key));
    return key;
  }

  async function flush() {
    await Promise.all(Array.from(pending.values()).map((promise) => promise.catch(() => null)));
    return { pending: pending.size, errors: errors.length };
  }

  return {
    remote: true,
    name: projectName,
    load,
    flush,
    write,
    create,
    remove,
    has: base.has,
    read: base.read,
    list: base.list,
    listDir: base.listDir,
    tree: base.tree,
    normalize: base.normalize,
    size: base.size,
    get loaded() {
      return loaded;
    },
    get pendingCount() {
      return pending.size;
    },
    errors,
  };
}
