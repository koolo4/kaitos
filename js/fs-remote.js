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
  const external = []; // изменения, пришедшие с диска мимо Kaitos
  let loaded = false;
  let since = 0;
  let syncTimer = null;
  let isDirty = () => false; // спрашиваем редактор: есть ли несохранённые правки

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

  /*
   * Забирает с сервера изменения, сделанные мимо Kaitos, и обновляет зеркало.
   * Открытый файл с несохранёнными правками не трогаем: иначе редактор потеряет ввод.
   */
  async function sync(options = {}) {
    if (!loaded) return { applied: [], skipped: [] };
    const dirtyCheck = typeof options.dirty === 'function' ? options.dirty : isDirty;
    const data = await api.changes(since);
    since = data.seq ?? since;
    const applied = [];
    const skipped = [];

    for (const change of data.changes || []) {
      const path = change.path;
      if (pending.has(path)) continue; // это наша собственная запись
      if (dirtyCheck(path)) {
        skipped.push(path);
        continue;
      }
      try {
        if (change.type === 'removed' && base.has(path)) {
          base.remove(path);
          applied.push({ path, type: 'removed' });
          continue;
        }
        const { content } = await api.readFile(path);
        const text = content ?? '';
        if (base.has(path) && base.read(path) === text) continue;
        base.load({ ...exportMap(), [path]: text });
        applied.push({ path, type: base.has(path) ? 'changed' : 'added' });
      } catch (error) {
        skipped.push(path);
      }
    }

    for (const item of applied) external.push({ ...item, at: Date.now() });
    if (external.length > 100) external.splice(0, external.length - 100);
    return { applied, skipped };
  }

  /* Текущее содержимое зеркала одним объектом (для точечного обновления). */
  function exportMap() {
    const map = {};
    for (const path of base.list()) map[path] = base.read(path);
    return map;
  }

  function startSync({ intervalMs = 1500, onChange = null, dirty = null } = {}) {
    if (dirty) isDirty = dirty;
    stopSync();
    const tick = async () => {
      try {
        const result = await sync({ dirty: isDirty });
        // Важно сообщать и о пропущенных изменениях: при dirty-файле это конфликт,
        // иначе внешнее обновление будет незаметно отброшено.
        if ((result.applied.length || result.skipped.length) && onChange) onChange(result);
      } catch (error) {
        errors.push({ path: '/api/changes', message: error.message, at: Date.now() });
      }
    };
    syncTimer = setInterval(tick, intervalMs);
    return syncTimer;
  }

  function stopSync() {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
  }

  return {
    remote: true,
    name: projectName,
    load,
    flush,
    sync,
    startSync,
    stopSync,
    external,
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
    get watching() {
      return Boolean(syncTimer);
    },
    errors,
  };
}
