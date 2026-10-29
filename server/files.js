/*
 * Файловые операции сервера поверх node:fs.
 * Все пути проходят через защиту createPathGuard — наружу проекта выйти нельзя.
 */

import { promises as fs } from 'node:fs';
import { createPathGuard, toPosix, assertFileName, PathError } from './paths.js';
import { dirname, join } from 'node:path';

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 МБ на файл
const SKIP_DIRS = new Set(['.git', '.justai', 'node_modules', 'dist', '.vite']);
const TEXT_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'css', 'scss', 'html', 'htm', 'md', 'txt',
  'yml', 'yaml', 'sh', 'bat', 'env', 'gitignore', 'svg', 'xml', 'toml', 'ini', 'py', 'rb', 'go', 'rs',
]);

export function createFileService(root) {
  const guard = createPathGuard(root);

  function isTextFile(relativePath) {
    const name = toPosix(relativePath).split('/').pop() || '';
    if (name.startsWith('.')) return true;
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    return TEXT_EXTENSIONS.has(ext);
  }

  /* Список файлов проекта (без служебных папок). */
  async function list(dir = '.') {
    const start = guard.resolveInside(dir);
    const files = [];

    async function walk(absolute, relative, depth = 0) {
      if (depth > 24) return; // защита от символических циклов
      let entries;
      try {
        entries = await fs.readdir(absolute, { withFileTypes: true });
      } catch (error) {
        // Папку без прав, занятую или уже удалённую просто пропускаем:
        // один недоступный каталог не должен ронять весь список файлов.
        if (['ENOENT', 'EACCES', 'EPERM', 'EBUSY', 'ELOOP', 'ENOTDIR', 'EINVAL'].includes(error.code)) return;
        throw error;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        const childAbsolute = join(absolute, entry.name);
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(childAbsolute, childRelative, depth + 1);
        } else if (entry.isFile()) {
          files.push(childRelative);
          if (files.length > 5000) throw new PathError('Слишком много файлов в проекте (лимит 5000)');
        }
      }
    }

    await walk(start.absolute, start.relative);
    return files.sort((a, b) => a.localeCompare(b));
  }

  async function stat(relativePath) {
    const target = guard.resolveInside(relativePath);
    try {
      const info = await fs.stat(target.absolute);
      return {
        path: target.relative,
        type: info.isDirectory() ? 'dir' : 'file',
        size: info.size,
        modified: info.mtimeMs,
      };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function read(relativePath) {
    const target = guard.resolveInside(relativePath);
    const info = await stat(target.relative);
    if (!info) throw new PathError(`Файл не найден: ${target.relative}`);
    if (info.type === 'dir') throw new PathError(`Это папка, а не файл: ${target.relative}`);
    if (info.size > MAX_FILE_BYTES) throw new PathError(`Файл больше 2 МБ: ${target.relative}`);
    if (!isTextFile(target.relative)) throw new PathError(`Двоичный файл не поддерживается: ${target.relative}`);
    return fs.readFile(target.absolute, 'utf8');
  }

  async function write(relativePath, content) {
    const target = guard.resolveInside(relativePath);
    const text = String(content ?? '');
    if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) throw new PathError('Содержимое больше 2 МБ');
    const existing = await stat(target.relative);
    if (existing && existing.type === 'dir') throw new PathError(`Это папка: ${target.relative}`);
    // dirname, а не поиск '/': на Windows в пути обратные слэши
    await fs.mkdir(dirname(target.absolute), { recursive: true });
    await fs.writeFile(target.absolute, text, 'utf8');
    return { path: target.relative, created: !existing, size: Buffer.byteLength(text, 'utf8') };
  }

  async function create(relativePath, content = '') {
    const target = guard.resolveInside(relativePath);
    const existing = await stat(target.relative);
    if (existing) throw new PathError(`Уже существует: ${target.relative}`);
    assertFileName(target.relative.split('/').pop());
    return write(target.relative, content);
  }

  async function remove(relativePath) {
    const target = guard.resolveInside(relativePath);
    const existing = await stat(target.relative);
    if (!existing) throw new PathError(`Не найдено: ${target.relative}`);
    if (existing.type === 'dir') throw new PathError(`Удаление папок не поддерживается: ${target.relative}`);
    await fs.unlink(target.absolute);
    return { path: target.relative, removed: true };
  }

  return { root: guard.root, list, stat, read, write, create, remove, isTextFile, guard };
}
