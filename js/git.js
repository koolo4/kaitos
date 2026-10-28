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
  const branchControls = $('#git-branch-controls');
  const branchSelect = $('#git-branch');
  const switchButton = $('#btn-git-switch');
  const logButton = $('#btn-git-log');
  const logPanel = $('#git-log-panel');
  const logList = $('#git-log');

  const state = { changes: [], branch: null, branches: [], targetBranch: null, repo: false, busy: false, switching: false, logLoaded: false, logOpen: false, selected: null };

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

    if (branchControls) branchControls.hidden = !state.repo || state.branches.length < 2;
    if (logPanel) logPanel.hidden = !state.repo || !state.logOpen;
    if (logButton) logButton.setAttribute('aria-expanded', String(state.logOpen));
    if (branchSelect) {
      const selected = state.targetBranch || state.branch || '';
      branchSelect.innerHTML = '';
      for (const branch of state.branches) {
        const option = document.createElement('option');
        option.value = branch;
        option.textContent = branch;
        branchSelect.append(option);
      }
      branchSelect.value = selected;
      branchSelect.disabled = state.switching || !state.repo;
    }
    if (switchButton) {
      const target = state.targetBranch || state.branch;
      switchButton.disabled = state.switching || !state.repo || target === state.branch || !state.branches.includes(target);
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

  function dataBranchFallback(branch) {
    return branch ? [branch] : [];
  }

  async function refresh() {
    if (!enabled()) return;
    try {
      const [data, branchData] = await Promise.all([
        api().status(),
        api().branches ? api().branches() : Promise.resolve({ branches: dataBranchFallback(state.branch) }),
      ]);
      state.repo = Boolean(data.repo);
      state.branch = data.branch;
      state.changes = data.changes || [];
      state.branches = branchData.branches || [];
      if (!state.targetBranch || !state.branches.includes(state.targetBranch)) state.targetBranch = state.branch;
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

  function hasDirtyEditor() {
    return Boolean(ctx.editor && ctx.editor.tabs.some((path) => ctx.editor.isDirty(path)));
  }

  async function switchBranch() {
    if (!enabled() || !state.repo || state.switching) return;
    const branch = branchSelect ? branchSelect.value : state.targetBranch;
    if (!branch || branch === state.branch) return;
    if (hasDirtyEditor()) {
      toast('Сначала сохраните или закройте файлы с несохранёнными правками', 'warn');
      return;
    }
    if (state.changes.length) {
      toast('Сначала закоммитьте или отмените изменения рабочей копии', 'warn');
      return;
    }

    state.switching = true;
    render();
    try {
      if (ctx.fs.flush) {
        const flushed = await ctx.fs.flush();
        if (flushed.errors) throw new Error('Не все файлы удалось записать на диск');
      }
      const result = await api().checkout(branch);
      ctx.activity?.record?.('git-branch', `Переключена ветка ${result.branch}`);
      await ctx.fs.load();
      if (ctx.tree) ctx.tree.render();
      if (ctx.editor) {
        for (const path of ctx.editor.tabs) {
          if (ctx.fs.has(path)) ctx.editor.refresh(path);
          else ctx.editor.close(path);
        }
      }
      state.targetBranch = result.branch;
      state.logLoaded = false;
      toast(`Переключено на ветку ${result.branch}`, 'ok');
      if (ctx.terminal) ctx.terminal.print(`git switch ${result.branch}`, 'ok');
      await refresh();
      if (state.logOpen) await loadLog();
    } catch (error) {
      toast(`Не удалось переключить ветку: ${error.message}`, 'err');
      if (ctx.terminal) ctx.terminal.print(`git switch: ${error.message}`, 'err');
      await refresh();
    } finally {
      state.switching = false;
      render();
    }
  }

  function renderLog(commits) {
    if (!logList) return;
    logList.innerHTML = '';
    if (!commits.length) {
      const empty = document.createElement('div');
      empty.className = 'git-empty';
      empty.textContent = 'Коммитов пока нет';
      logList.append(empty);
      return;
    }
    for (const commit of commits) {
      const row = document.createElement('div');
      row.className = 'git-log-row';
      const subject = document.createElement('div');
      subject.className = 'git-log-subject';
      subject.textContent = commit.subject || '(без сообщения)';
      const meta = document.createElement('div');
      meta.className = 'git-log-meta';
      const hash = document.createElement('span');
      hash.className = 'git-log-hash';
      hash.textContent = commit.hash || '—';
      const author = document.createElement('span');
      author.textContent = commit.author || 'неизвестный автор';
      const date = document.createElement('span');
      date.textContent = commit.date || '';
      meta.append(hash, document.createTextNode(' · '), author, document.createTextNode(' · '), date);
      row.append(subject, meta);
      logList.append(row);
    }
  }

  async function loadLog() {
    if (!logList) return;
    logList.textContent = 'Загружаю журнал…';
    try {
      const data = await api().log(20);
      state.logLoaded = true;
      renderLog(data.commits || []);
    } catch (error) {
      state.logLoaded = false;
      logList.textContent = `Не удалось загрузить журнал: ${error.message}`;
    }
  }

  async function toggleLog() {
    state.logOpen = !state.logOpen;
    render();
    if (state.logOpen && !state.logLoaded) await loadLog();
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
      ctx.activity?.record?.('git-commit', `Создан коммит ${result.hash} (${result.files} файлов): ${message.slice(0, 180)}`);
      if (messageInput) messageInput.value = '';
      state.logLoaded = false;
      if (diffBox) diffBox.hidden = true;
      state.selected = null;
      toast(`Коммит ${result.hash}: ${result.files} файлов`, 'ok');
      if (ctx.terminal) ctx.terminal.print(`git commit ${result.hash} — ${message}`, 'ok');
      // коммит меняет .git: обновляем статус, журнал и дерево.
      await refresh();
      if (state.logOpen) await loadLog();
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
  if (branchSelect) branchSelect.addEventListener('change', () => {
    state.targetBranch = branchSelect.value;
    render();
  });
  if (switchButton) switchButton.addEventListener('click', switchBranch);
  if (logButton) logButton.addEventListener('click', toggleLog);
  if (messageInput) {
    messageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        commit();
      }
    });
  }

  return {
    refresh,
    render,
    showDiff,
    commit,
    switchBranch,
    loadLog,
    get changes() { return state.changes.slice(); },
    get branches() { return state.branches.slice(); },
  };
}
