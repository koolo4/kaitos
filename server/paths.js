/*
 * Безопасная работа с путями проекта на сервере.
 * Любой путь приводится к абсолютному и проверяется, что он внутри корня проекта.
 */

import { resolve, relative, isAbsolute, sep, join, normalize } from 'node:path';

export class PathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PathError';
  }
}

const FORBIDDEN_SEGMENTS = new Set(['.git', '.justai', 'node_modules']);

/* Приводит путь к виду «a/b/c» без ведущих ./ и без обратных слэшей. */
export function toPosix(path) {
  return String(path ?? '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
}

export function createPathGuard(root) {
  if (!root) throw new PathError('Не задан корень проекта');
  const projectRoot = resolve(root);

  /* Абсолютный путь внутри проекта либо PathError. */
  function resolveInside(relativePath = '.') {
    const raw = String(relativePath ?? '.').trim();
    if (raw.includes('\0')) throw new PathError('В пути недопустимый символ');
    if (isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
      throw new PathError(`Абсолютный путь запрещён: ${raw}`);
    }
    const target = normalize(join(projectRoot, raw));
    const rel = relative(projectRoot, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new PathError(`Путь выходит за пределы проекта: ${raw}`);
    }
    if (rel === '') return { absolute: projectRoot, relative: '' };
    const segments = toPosix(rel).split('/');
    const forbidden = segments.find((segment) => FORBIDDEN_SEGMENTS.has(segment));
    if (forbidden) throw new PathError(`Служебная папка недоступна: ${forbidden}`);
    return { absolute: target, relative: toPosix(rel) };
  }

  function isInside(relativePath) {
    try {
      resolveInside(relativePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  return { root: projectRoot, resolveInside, isInside, sep };
}

/* Проверка имени файла для создания: без сегментов пути, без точек в начале. */
export function assertFileName(name) {
  const value = String(name ?? '').trim();
  if (!value) throw new PathError('Пустое имя файла');
  if (value !== toPosix(value).split('/').pop()) throw new PathError('Имя не должно содержать путь');
  if (value === '.' || value === '..') throw new PathError('Недопустимое имя файла');
  if (/[<>:"|?*\0]/.test(value)) throw new PathError('В имени недопустимые символы');
  return value;
}
