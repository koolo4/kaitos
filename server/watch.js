/*
 * Слежение за файлами проекта: замечает правки, сделанные мимо Kaitos
 * (другой редактор, git checkout, скрипт), и отдаёт их списком.
 *
 * Клиенту не нужен постоянный канал: он спрашивает /api/changes?since=N
 * и получает только новое. Так проще и надёжнее через прокси Vite, чем SSE.
 */

import { watch } from 'node:fs';
import { sep } from 'node:path';
import { toPosix } from './paths.js';

const HIDDEN = ['.git', '.justai', 'node_modules', 'dist', '.vite', '.cache', '.arena'];
const TEXT_EXT = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss', 'html', 'htm', 'json', 'md', 'txt',
  'yml', 'yaml', 'sh', 'bat', 'py', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'sql', 'toml', 'ini', 'env',
]);
const DEBOUNCE_MS = 60;

export function isTracked(relativePath) {
  if (!relativePath) return false;
  const parts = toPosix(relativePath).split('/');
  if (parts.some((part) => HIDDEN.includes(part))) return false;
  const name = parts[parts.length - 1];
  if (!name || name.startsWith('.')) return false;
  // Vite на лету пишет временные файлы рядом с конфигом — это не правки проекта
  if (name.includes('.timestamp-')) return false;
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return TEXT_EXT.has(name.slice(dot + 1).toLowerCase());
}

export function createWatcher({ root, limit = 200 } = {}) {
  const changes = []; // [{ seq, path, type, at }]
  const buffered = new Map(); // path -> type, чтобы не отдавать по десять событий на одно сохранение
  let seq = 0;
  let timer = null;
  let closed = false;
  let watcher = null;
  const listeners = new Set();

  function emit(path, type) {
    const key = toPosix(path);
    // перезапись после удаления (и наоборот) важнее: сохраняем последнее событие
    buffered.set(key, type);
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const batch = Array.from(buffered.entries());
      buffered.clear();
      for (const [item, kind] of batch) {
        seq += 1;
        const change = { seq, path: item, type: kind, at: Date.now() };
        changes.push(change);
        if (changes.length > limit) changes.shift();
        for (const listener of listeners) {
          try {
            listener(change);
          } catch (error) {
            // слушатель не должен ломать слежение
          }
        }
      }
    }, DEBOUNCE_MS);
    if (timer.unref) timer.unref();
  }

  function start() {
    if (watcher || closed) return api;
    try {
      watcher = watch(root, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const path = String(filename).split(sep).join('/');
        if (!isTracked(path)) return;
        emit(path, eventType === 'rename' ? 'removed' : 'changed');
      });
      watcher.on('error', () => {
        // рекурсивное слежение поддерживается не везде — молча остаёмся без него
      });
      if (watcher.unref) watcher.unref();
    } catch (error) {
      watcher = null;
    }
    return api;
  }

  /* Изменения после указанной отметки. since=0 — всё, что ещё в буфере. */
  function drain(since = 0) {
    const from = Number(since) || 0;
    return {
      seq,
      changes: changes.filter((change) => change.seq > from).map(({ seq: s, path, type }) => ({ seq: s, path, type })),
    };
  }

  function close() {
    closed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (watcher) watcher.close();
    watcher = null;
    listeners.clear();
  }

  const api = {
    start,
    close,
    drain,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get running() {
      return Boolean(watcher);
    },
    get size() {
      return changes.length;
    },
  };

  return api;
}
