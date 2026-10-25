/* Редактор кода: вкладки, нумерация строк, черновики, сохранение в файловую систему. */

import { $, toast } from './dom.js';

export function initEditor(ctx) {
  const editorEl = $('#editor');
  const input = $('#editor-input');
  const gutter = $('#line-numbers');
  const tabsEl = $('#tabs');
  const emptyEl = $('#editor-empty');

  const state = { tabs: [], active: null, drafts: new Map(), listeners: [] };

  function contentOf(path) {
    return state.drafts.has(path) ? state.drafts.get(path) : ctx.fs.read(path);
  }

  function isDirty(path) {
    if (!path || !state.drafts.has(path)) return false;
    return state.drafts.get(path) !== ctx.fs.read(path);
  }

  function cursor() {
    const before = input.value.slice(0, input.selectionStart);
    const lines = before.split('\n');
    return { line: lines.length, col: lines[lines.length - 1].length + 1 };
  }

  function info() {
    const position = cursor();
    return {
      path: state.active,
      dirty: isDirty(state.active),
      line: position.line,
      col: position.col,
      tabs: state.tabs.slice(),
    };
  }

  function notify() {
    const payload = info();
    for (const listener of state.listeners) listener(payload);
  }

  function renderGutter() {
    const count = Math.max(input.value.split('\n').length, 1);
    const numbers = [];
    for (let i = 1; i <= count; i += 1) numbers.push(i);
    gutter.textContent = numbers.join('\n');
    gutter.scrollTop = input.scrollTop;
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const path of state.tabs) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab' + (path === state.active ? ' is-active' : '');
      tab.dataset.path = path;

      const label = document.createElement('span');
      label.textContent = path.split('/').pop();
      label.title = path;
      tab.append(label);

      if (isDirty(path)) {
        const dot = document.createElement('span');
        dot.className = 'tab__dot';
        tab.append(dot);
      }

      const close = document.createElement('span');
      close.className = 'tab__close';
      close.dataset.close = path;
      close.textContent = '×';
      tab.append(close);

      tabsEl.append(tab);
    }
  }

  function showEditor(visible) {
    editorEl.classList.toggle('is-open', visible);
    emptyEl.hidden = visible;
  }

  function open(path) {
    if (!ctx.fs.has(path)) {
      toast(`Файл не найден: ${path}`, 'err');
      return;
    }
    if (!state.tabs.includes(path)) state.tabs.push(path);
    state.active = path;
    input.value = contentOf(path);
    showEditor(true);
    renderTabs();
    renderGutter();
    input.scrollTop = 0;
    input.selectionStart = 0;
    input.selectionEnd = 0;
    notify();
    if (ctx.tree) ctx.tree.setActive(path);
    input.focus();
  }

  function close(path) {
    state.tabs = state.tabs.filter((item) => item !== path);
    state.drafts.delete(path);
    if (state.active === path) {
      state.active = state.tabs.length ? state.tabs[state.tabs.length - 1] : null;
      if (state.active) {
        input.value = contentOf(state.active);
        showEditor(true);
      } else {
        input.value = '';
        showEditor(false);
      }
    }
    renderTabs();
    renderGutter();
    notify();
    if (ctx.tree) ctx.tree.setActive(state.active);
  }

  function save() {
    if (!state.active) return;
    ctx.fs.write(state.active, input.value);
    state.drafts.delete(state.active);
    renderTabs();
    notify();
    toast(`Сохранено: ${state.active}`, 'ok');
  }

  /* Перечитывает файл из файловой системы (после правки моделью). */
  function refresh(path) {
    if (!path) return;
    state.drafts.delete(path);
    if (state.active === path) {
      input.value = ctx.fs.has(path) ? ctx.fs.read(path) : '';
      renderGutter();
    }
    renderTabs();
    notify();
  }

  function onChange(listener) {
    state.listeners.push(listener);
    listener(info());
  }

  input.addEventListener('input', () => {
    if (!state.active) return;
    state.drafts.set(state.active, input.value);
    renderGutter();
    renderTabs();
    notify();
  });

  input.addEventListener('scroll', () => {
    gutter.scrollTop = input.scrollTop;
  });

  input.addEventListener('keydown', (event) => {
    const saveKey = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
    if (saveKey) {
      event.preventDefault();
      save();
      return;
    }
    if (event.key === 'Tab' && state.active) {
      event.preventDefault();
      input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end');
      state.drafts.set(state.active, input.value);
      renderGutter();
      renderTabs();
      notify();
    }
  });

  input.addEventListener('keyup', notify);
  input.addEventListener('click', notify);

  tabsEl.addEventListener('click', (event) => {
    const closeButton = event.target.closest('[data-close]');
    if (closeButton) {
      event.stopPropagation();
      close(closeButton.dataset.close);
      return;
    }
    const tab = event.target.closest('.tab');
    if (tab) open(tab.dataset.path);
  });

  showEditor(false);

  return {
    open,
    close,
    save,
    refresh,
    onChange,
    contentOf,
    isDirty,
    renderTabs,
    get active() {
      return state.active;
    },
    get tabs() {
      return state.tabs.slice();
    },
  };
}
