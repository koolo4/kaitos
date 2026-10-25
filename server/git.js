/*
 * Git на локальном сервере: статус, diff, журнал и коммит.
 *
 * Команды запускаются через execFile — без shell, аргументами, с таймаутом.
 * Всё происходит в корне проекта; пути дополнительно проверяет вызывающий код.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(execFile);
const TIMEOUT = 15000;
const MAX_DIFF = 300 * 1024;

const STATUS_NAMES = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'conflict',
  '?': 'untracked',
  '!': 'ignored',
};

export function parseStatus(text) {
  const result = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    const index = line[0];
    const worktree = line[1];
    let path = line.slice(3);
    if (line.startsWith('R') || line.startsWith('C')) {
      // «R  старый -> новый» (в porcelain это «старый -> новый»)
      const parts = path.split(' -> ');
      path = parts[parts.length - 1];
    }
    const code = index !== ' ' ? index : worktree;
    result.push({
      path: path.trim(),
      status: STATUS_NAMES[code] || 'modified',
      code,
      staged: index !== ' ' && index !== '?',
    });
  }
  return result;
}

export function createGit({ root } = {}) {
  async function git(args) {
    const { stdout } = await run('git', args, {
      cwd: root,
      timeout: TIMEOUT,
      maxBuffer: MAX_DIFF * 2,
      windowsHide: true,
    });
    return String(stdout || '');
  }

  async function available() {
    try {
      await git(['rev-parse', '--is-inside-work-tree']);
      return true;
    } catch (error) {
      return false;
    }
  }

  async function status() {
    if (!(await available())) return { ok: true, repo: false, branch: null, changes: [] };
    let branch = '';
    try {
      branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    } catch (error) {
      branch = '';
    }
    const changes = parseStatus(await git(['status', '--porcelain=v1']));
    return { ok: true, repo: true, branch, changes };
  }

  async function diff(path) {
    const args = ['diff', '--no-color', '--unified=3'];
    if (path) args.push('--', path);
    let text = await git(args);
    if (!text && path) {
      // Неотслеживаемый файл: git diff его не показывает, собираем вид «новый файл» сами.
      try {
        const content = await readFile(join(root, path), 'utf8');
        const lines = content.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        text = [
          `diff --git a/${path} b/${path}`,
          'new file mode 100644',
          '--- /dev/null',
          `+++ b/${path}`,
          `@@ -0,0 +1,${lines.length} @@`,
          ...lines.map((line) => `+${line}`),
          '',
        ].join('\n');
      } catch (error) {
        text = '';
      }
    }
    if (text.length > MAX_DIFF) text = `${text.slice(0, MAX_DIFF)}\n… diff обрезан (больше 300 КБ)`;
    return { ok: true, path: path || null, diff: text, empty: !text.trim() };
  }

  async function log(limit = 10) {
    if (!(await available())) return { ok: true, commits: [] };
    let text = '';
    try {
      text = await git(['log', `-${Math.min(Math.max(limit, 1), 50)}`, '--pretty=%h%x1f%s%x1f%an%x1f%ar']);
    } catch (error) {
      return { ok: true, commits: [] }; // ещё нет коммитов
    }
    const commits = text
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, subject, author, date] = line.split('\x1f');
        return { hash, subject, author, date };
      });
    return { ok: true, commits };
  }

  async function commit(message) {
    const text = String(message || '').trim();
    if (!text) throw new Error('Пустое сообщение коммита');
    if (text.length > 2000) throw new Error('Сообщение коммита длиннее 2000 символов');
    if (!(await available())) throw new Error('Это не git-репозиторий');

    const before = parseStatus(await git(['status', '--porcelain=v1']));
    if (!before.length) throw new Error('Нечего коммитить: рабочая копия чистая');

    await git(['add', '-A']);
    try {
      await git([
        '-c',
        'user.name=' + (process.env.KAITOS_GIT_NAME || 'Kaitos'),
        '-c',
        'user.email=' + (process.env.KAITOS_GIT_EMAIL || 'kaitos@localhost'),
        'commit',
        '-m',
        text,
      ]);
    } catch (error) {
      const output = `${error.stdout || ''}${error.stderr || ''}`.trim();
      throw new Error(output || error.message);
    }
    const hash = (await git(['rev-parse', '--short', 'HEAD'])).trim();
    return { ok: true, hash, files: before.length };
  }

  return { git, available, status, diff, log, commit, root };
}
