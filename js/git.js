/* Панель git: изменения в проекте, diff и коммит. */

import { $, toast } from './dom.js';

const LABELS = {
  modified: 'изменён',
  added: 'добавлен',
  deleted: 'удалён',
  renamed: 'переименован',
  copied: 'скопирован',
  conflict: 'конфликт',
  untracked: 'новый',
  ignored: 'игнор',
};

const LETTERS = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  conflict: '!',
  untracked: '?',
};

export function initGit(ctx) {
  const section = $('#git-panel');
  const head = $('#git-summary');
  const list = $('#git-changes');
  const diffBox = $('#git-diff');
  const messageInput = $('#git-message');
  const commitButton = $('#btn-git-commit');
  const refreshButton = $('#btn-git-refresh');

  const state = { changes: [], branch: null, repo: false, busy: false, selected: null };

  function api() {
    return ctx.api && ctx.api.git;
  }

  function enabled() {
    return Boolean(api() && ctx.storage && ctx.storage.mode === 'disk');
  }

  function render() {
    if (!section) return;
    section.hidden = !enabled();
    if (!enabled()) return;

    head.textContent = state.repo
      ? `${state.branch || 'без ветки'} · ${state.changes.length} ${plural(state.changes.length, 'изменение', 'изменения', 'изменений')}`
      : 'проект не под git';

    list.innerHTML = '';
    if (!state.repo) {
      const empty = document.createElement('div');
      empty.className = 'git-empty';
      empty.textContent = 'В этой папке нет git-репозитория';
      list.append(empty);
    } else if (!state.changes.length) {
      const empty = document.createElement('div');
      empty.className = 'git-empty';
      empty.textContent = 'Изменений нет';
      list.append(empty);
    } else {
      for (const change of state.changes) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'git-row' + (state.selected === change.path ? ' is-active' : '');
        row.dataset.path = change.path;
        row.title = `${change.path} — ${LABELS[change.status] || change.status}`;

        const badge = document.createElement('span');
        badge.className = `git-badge git-badge--${change.status}`;
        badge.textContent = LETTERS[change.status] || 'M';

        const name = document.createElement('span');
        name.className = 'git-name';
        name.textContent = change.path;

        row.append(badge, name);
        row.addEventListener('click', () => showDiff(change.path));
        list.append(row);
      }
    }

    if (commitButton) {
      commitButton.disabled = state.busy || !state.repo || !state.changes.length;
    }
  }

  function plural(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  async function refresh() {
    if (!enabled()) return;
    try {
      const data = await api().status();
      state.repo = Boolean(data.repo);
      state.branch = data.branch;
      state.changes = data.changes || [];
      render();
    } catch (error) {
      if (head) head.textContent = `git недоступен: ${error.message}`;
    }
  }

  /* Показывает diff выбранного файла. */
  async function showDiff(path) {
    state.selected = path;
    render();
    if (!diffBox) return;
    diffBox.hidden = false;
    diffBox.textContent = 'Читаю diff…';
    try {
      const data = await api().diff(path);
      diffBox.innerHTML = '';
      if (data.empty) {
        const empty = document.createElement('div');
        empty.className = 'git-empty';
        empty.textContent = 'Отличий нет';
        diffBox.append(empty);
        return;
      }
      for (const line of data.diff.split('\n')) {
        const row = document.createElement('div');
        row.className = 'git-diff-row';
        if (line.startsWith('+++') || line.startsWith('---')) row.classList.add('git-diff-row--meta');
        else if (line.startsWith('@@')) row.classList.add('git-diff-row--hunk');
        else if (line.startsWith('+')) row.classList.add('git-diff-row--add');
        else if (line.startsWith('-')) row.classList.add('git-diff-row--del');
        else if (line.startsWith('diff ') || line.startsWith('index ')) row.classList.add('git-diff-row--meta');
        row.textContent = line || ' ';
        diffBox.append(row);
      }
    } catch (error) {
      diffBox.textContent = `Не удалось получить diff: ${error.message}`;
    }
  }

  async function commit() {
    if (!enabled() || state.busy) return;
    const message = (messageInput && messageInput.value.trim()) || '';
    if (!message) {
      toast('Напишите сообщение коммита', 'err');
      if (messageInput) messageInput.focus();
      return;
    }
    state.busy = true;
    render();
    try {
      const result = await api().commit(message);
      if (messageInput) messageInput.value = '';
      if (diffBox) diffBox.hidden = true;
      state.selected = null;
      toast(`Коммит ${result.hash}: ${result.files} файлов`, 'ok');
      if (ctx.terminal) ctx.terminal.print(`git commit ${result.hash} — ${message}`, 'ok');
      // коммит меняет файлы .git — обновляем дерево и статус
      await refresh();
    } catch (error) {
      toast(`Коммит не удался: ${error.message}`, 'err');
      if (ctx.terminal) ctx.terminal.print(`git commit: ${error.message}`, 'err');
    } finally {
      state.busy = false;
      render();
    }
  }

  if (commitButton) commitButton.addEventListener('click', commit);
  if (refreshButton) refreshButton.addEventListener('click', refresh);
  if (messageInput) {
    messageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        commit();
      }
    });
  }

  return { refresh, render, showDiff, commit, get changes() { return state.changes.slice(); } };
}
