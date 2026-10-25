/* Проверки git-панели: разбор статуса, операции в настоящем репозитории, HTTP и интерфейс. */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { reporter, bootApp, wait } from './harness.mjs';
import { createGit, parseStatus } from '../server/git.js';
import { createServer } from '../server/index.js';

const { check, result } = reporter('Git');

let gitAvailable = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch (error) {
  gitAvailable = false;
}

await check('разбор вывода git status', () => {
  const parsed = parseStatus(['M  src/a.js', 'MM src/b.js', '?? новый.js', 'A  c.js', 'R  старое.js -> переименовано.js'].join('\n'));
  const byPath = Object.fromEntries(parsed.map((item) => [item.path, item.status]));
  if (byPath['src/a.js'] !== 'modified') throw new Error('M не разобран');
  if (byPath['src/b.js'] !== 'modified') throw new Error('MM не разобран');
  if (byPath['новый.js'] !== 'untracked') throw new Error('?? не разобран');
  if (byPath['c.js'] !== 'added') throw new Error('A не разобран');
  if (byPath['переименовано.js'] !== 'renamed') throw new Error('R не разобран');
  return parsed.map((item) => `${item.status}:${item.path}`).join(', ');
});

if (!gitAvailable) {
  console.log('⏭  git не найден — набор пропущен');
  process.exit(0);
}

const root = mkdtempSync(join(tmpdir(), 'kaitos-git-'));
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const quietGit = (args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });

git(['init', '-q']);
quietGit(['config', 'user.email', 'test@kaitos']);
quietGit(['config', 'user.name', 'Тест']);
writeFileSync(join(root, 'a.js'), 'export const a = 1;\n', 'utf8');
writeFileSync(join(root, 'README.md'), '# проект\n', 'utf8');
quietGit(['add', '-A']);
quietGit(['commit', '-qm', 'первый коммит']);

const api = createGit({ root });

await check('статус чистого репозитория', async () => {
  const data = await api.status();
  if (!data.repo) throw new Error('репозиторий не найден');
  if (!data.branch) throw new Error('нет ветки');
  if (data.changes.length) throw new Error(`изменения: ${data.changes.length}`);
  return data.branch;
});

await check('правка и новый файл видны в статусе', async () => {
  writeFileSync(join(root, 'a.js'), 'export const a = 2;\n', 'utf8');
  writeFileSync(join(root, 'b.js'), 'export const b = 1;\n', 'utf8');
  const data = await api.status();
  const statuses = data.changes.map((item) => `${item.path}=${item.status}`).sort();
  if (!statuses.includes('a.js=modified')) throw new Error(statuses.join(', '));
  if (!statuses.includes('b.js=untracked')) throw new Error(statuses.join(', '));
  return statuses.join(', ');
});

await check('diff изменённого файла', async () => {
  const data = await api.diff('a.js');
  if (data.empty) throw new Error('diff пустой');
  if (!data.diff.includes('+export const a = 2;')) throw new Error('нет добавленной строки');
  if (!data.diff.includes('-export const a = 1;')) throw new Error('нет удалённой строки');
  return `${data.diff.split('\n').length} строк`;
});

await check('diff нового файла собирается без git', async () => {
  const data = await api.diff('b.js');
  if (data.empty) throw new Error('diff пустой');
  if (!data.diff.includes('new file mode')) throw new Error('нет пометки нового файла');
  if (!data.diff.includes('+export const b = 1;')) throw new Error('нет содержимого');
  return 'new file';
});

await check('коммит и журнал', async () => {
  const committed = await api.commit('правка движка');
  if (!committed.hash) throw new Error('нет хеша');
  if (committed.files !== 2) throw new Error(`файлов: ${committed.files}`);
  const after = await api.status();
  if (after.changes.length) throw new Error('остались изменения');
  const log = await api.log(5);
  if (!log.commits.length) throw new Error('журнал пуст');
  if (log.commits[0].subject !== 'правка движка') throw new Error(log.commits[0].subject);
  return `${committed.hash}: ${log.commits[0].subject}`;
});

await check('ошибки коммита понятны', async () => {
  try {
    await api.commit('   ');
    throw new Error('пустое сообщение принято');
  } catch (error) {
    if (!error.message.includes('Пустое сообщение')) throw new Error(error.message);
  }
  try {
    await api.commit('нечего коммитить');
    throw new Error('пустой коммит прошёл');
  } catch (error) {
    if (!error.message.includes('Нечего коммитить')) throw new Error(error.message);
  }
  return 'ок';
});

await check('не git-папка: статус пустой, коммит отказывает', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'kaitos-nogit-'));
  const plainApi = createGit({ root: plain });
  const data = await plainApi.status();
  if (data.repo) throw new Error('папка принята за репозиторий');
  try {
    await plainApi.commit('пробный');
    throw new Error('коммит в обычной папке прошёл');
  } catch (error) {
    if (!error.message.includes('не git-репозиторий')) throw new Error(error.message);
  }
  rmSync(plain, { recursive: true, force: true });
  return 'отказ';
});

/* --- HTTP --- */

const server = createServer({ root, watchFiles: false });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;

await check('HTTP: статус, diff, коммит', async () => {
  const status = await (await fetch(`${base}/git/status`)).json();
  if (!status.repo) throw new Error('нет репозитория');

  writeFileSync(join(root, 'a.js'), 'export const a = 3;\n', 'utf8');
  const diff = await (await fetch(`${base}/git/diff?path=a.js`)).json();
  if (!diff.diff.includes('+export const a = 3;')) throw new Error('diff не пришёл');

  const commit = await fetch(`${base}/git/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'третий' }),
  });
  const payload = await commit.json();
  if (commit.status !== 200 || !payload.hash) throw new Error(JSON.stringify(payload));

  const log = await (await fetch(`${base}/git/log?limit=3`)).json();
  if (log.commits[0].subject !== 'третий') throw new Error(log.commits[0].subject);
  return payload.hash;
});

await check('HTTP: путь вне проекта отклоняется', async () => {
  const response = await fetch(`${base}/git/diff?path=${encodeURIComponent('../etc/passwd')}`);
  const payload = await response.json();
  if (response.status !== 400) throw new Error(`статус ${response.status}`);
  if (payload.ok !== false) throw new Error('нет ошибки');
  return '400';
});

await new Promise((resolve) => server.close(resolve));

/* --- интерфейс --- */

function mockServer({ repo = true, changes = [], diff = '' } = {}) {
  const store = { 'a.js': 'export const a = 1;\n' };
  const calls = { commit: [], diff: [] };
  const fetchMock = async (url, options = {}) => {
    const full = String(url);
    const method = options.method || 'GET';
    const json = (status, payload) => ({ ok: status < 400, status, json: async () => payload });

    if (full.includes('/api/health')) return json(200, { ok: true, root: '/home/user/git-demo' });
    if (full.includes('/api/changes')) return json(200, { ok: true, seq: 0, changes: [], watching: true });
    if (full.includes('/api/files')) return json(200, { ok: true, files: Object.keys(store) });
    if (full.includes('/api/git/status')) return json(200, { ok: true, repo, branch: 'main', changes });
    if (full.includes('/api/git/diff')) {
      calls.diff.push(full.split('path=')[1]);
      return json(200, { ok: true, diff, empty: !diff, path: 'a.js' });
    }
    if (full.endsWith('/api/git/commit')) {
      const body = JSON.parse(options.body);
      calls.commit.push(body.message);
      return json(200, { ok: true, hash: 'abc1234', files: 1 });
    }
    if (full.includes('/api/file?path=') && method === 'GET') {
      const path = decodeURIComponent(full.split('path=')[1]);
      return json(200, { ok: true, path, content: store[path] ?? '' });
    }
    return json(404, { ok: false, error: 'нет маршрута' });
  };
  return { calls, fetchMock };
}

await check('интерфейс: панель показывает ветку и изменения', async () => {
  const mock = mockServer({
    changes: [
      { path: 'a.js', status: 'modified', code: ' M' },
      { path: 'новый.js', status: 'untracked', code: '??' },
    ],
  });
  const { doc } = await bootApp({}, { fetchMock: mock.fetchMock });
  await wait(30);
  const panel = doc.querySelector('#git-panel');
  if (panel.hidden) throw new Error('панель скрыта');
  const summary = doc.querySelector('#git-summary').textContent;
  if (!summary.includes('main')) throw new Error(summary);
  if (!summary.includes('2')) throw new Error(`нет числа изменений: ${summary}`);
  const rows = Array.from(doc.querySelectorAll('.git-row')).map((row) => row.dataset.path);
  if (!rows.includes('a.js') || !rows.includes('новый.js')) throw new Error(rows.join(', '));
  const badge = doc.querySelector('.git-badge').textContent;
  if (!badge) throw new Error('нет значка статуса');
  return summary;
});

await check('интерфейс: клик по файлу показывает diff', async () => {
  const mock = mockServer({
    changes: [{ path: 'a.js', status: 'modified', code: ' M' }],
    diff: ['diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js', '@@ -1 +1 @@', '-export const a = 1;', '+export const a = 2;'].join('\n'),
  });
  const { window, doc } = await bootApp({}, { fetchMock: mock.fetchMock });
  await wait(30);
  doc.querySelector('.git-row').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(60);
  const box = doc.querySelector('#git-diff');
  if (box.hidden) throw new Error('diff скрыт');
  const added = box.querySelectorAll('.git-diff-row--add').length;
  const removed = box.querySelectorAll('.git-diff-row--del').length;
  if (!added || !removed) throw new Error(`add ${added}, del ${removed}`);
  return `${added} добавлено, ${removed} удалено`;
});

await check('интерфейс: коммит отправляет сообщение и чистит поле', async () => {
  const mock = mockServer({ changes: [{ path: 'a.js', status: 'modified', code: ' M' }] });
  const { window, doc } = await bootApp({}, { fetchMock: mock.fetchMock });
  await wait(30);
  const input = doc.querySelector('#git-message');
  const button = doc.querySelector('#btn-git-commit');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(20);
  if (mock.calls.commit.length) throw new Error('коммит отправлен без сообщения');

  input.value = 'моя правка';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  await wait(120);
  if (!mock.calls.commit.includes('моя правка')) throw new Error(`вызовы: ${mock.calls.commit.join(',')}`);
  if (input.value !== '') throw new Error('поле не очищено');
  return mock.calls.commit[0];
});

await check('интерфейс: без git панель честно говорит об этом', async () => {
  const mock = mockServer({ repo: false });
  const { doc } = await bootApp({}, { fetchMock: mock.fetchMock });
  await wait(30);
  const summary = doc.querySelector('#git-summary').textContent;
  if (!summary.includes('не под git')) throw new Error(summary);
  const commitButton = doc.querySelector('#btn-git-commit');
  if (!commitButton.disabled) throw new Error('кнопка коммита активна без репозитория');
  return summary;
});

await check('интерфейс: в демо-режиме панель скрыта', async () => {
  const fetchMock = async () => {
    throw new TypeError('Failed to fetch');
  };
  const { doc } = await bootApp({}, { fetchMock });
  await wait(30);
  if (!doc.querySelector('#git-panel').hidden) throw new Error('панель показана в демо-режиме');
  return 'скрыта';
});

rmSync(root, { recursive: true, force: true });
process.exit(result() ? 1 : 0);
