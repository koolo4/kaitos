Цель: Сделать рабочий редактор: открытие файла, вкладки, нумерация строк, отметка несохранённых правок, сохранение по Ctrl+S, координаты курсора в строке состояния.

Проект: Kaitos — AI-редактор кода в браузере (аналог Cursor / Claude Code).
Стек: Vite 5 + ванильный JavaScript, ES-модули. Все файлы — в корне репозитория.
Разметка приложения живёт в index.html, стили — в css/, код — в js/. Какие файлы создать или заменить, сказано в требованиях.

Требования:

1. Новый файл — `js/editor.js`, второй файл заменяет точку входа `js/app.js`.
2. Создай файл `js/editor.js` с текстом ниже — инструментом write_file. Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
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
````

3. Замени всё содержимое файла `js/app.js` на текст ниже — инструментом write_file (не edit_file). Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
/*
 * Kaitos v0.1.0 — точка входа.
 * Подключены файловая система и редактор кода. Дерево файлов, чат и терминал — следующие задачи.
 */

import { $, formatTime } from './dom.js';
import { createFs } from './fs.js';
import { initEditor } from './editor.js';

const VERSION = '0.1.0';

const ctx = {
  version: VERSION,
  fs: createFs(),
  settings: { theme: 'dark' },
  ready: false,
};

function setTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = value;
  ctx.settings.theme = value;
  try {
    window.localStorage.setItem('kaitos.theme', value);
  } catch (error) {
    /* настройки просто не сохранятся */
  }
}

function toggleSidebar() {
  const app = $('#app');
  const collapsed = app.classList.toggle('sidebar-collapsed');
  $('#btn-sidebar-toggle').textContent = collapsed ? '»' : '«';
}

function toggleTerminal() {
  const main = $('#main-area');
  const collapsed = main.classList.toggle('is-terminal-collapsed');
  $('#btn-terminal-toggle').textContent = collapsed ? '⌃' : '⌄';
}

function startClock() {
  const clock = $('#status-clock');
  const tick = () => {
    clock.textContent = formatTime();
  };
  tick();
  window.setInterval(tick, 1000);
}

function boot() {
  let saved = 'dark';
  try {
    saved = window.localStorage.getItem('kaitos.theme') || 'dark';
  } catch (error) {
    saved = 'dark';
  }
  setTheme(saved);

  ctx.editor = initEditor(ctx);

  $('#project-name').textContent = ctx.fs.name();
  $('#status-file').textContent = 'файл не открыт';

  ctx.editor.onChange((info) => {
    $('#status-file').textContent = info.path || 'файл не открыт';
    $('#status-dirty').textContent = info.dirty ? '● не сохранено' : '';
    $('#status-position').textContent = `Стр ${info.line}, Кол ${info.col}`;
    $('#chat-context').textContent = info.path || 'без файла';
  });

  $('#btn-theme').addEventListener('click', () => {
    setTheme(ctx.settings.theme === 'dark' ? 'light' : 'dark');
  });
  $('#btn-sidebar-toggle').addEventListener('click', toggleSidebar);
  $('#btn-terminal-toggle').addEventListener('click', toggleTerminal);

  startClock();

  ctx.toggleSidebar = toggleSidebar;
  ctx.toggleTerminal = toggleTerminal;
  ctx.ready = true;
  window.Kaitos = ctx;
}

boot();
````

4. Проверь вручную в консоли браузера: `Kaitos.editor.open('src/utils.js')` открывает файл, `Kaitos.editor.save()` его сохраняет.

Готово, когда:
- После `Kaitos.editor.open('src/utils.js')` в центре экрана виден код файла, слева от кода — номера строк 1…7.
- Над редактором появилась вкладка `utils.js`, она подсвечена как активная.
- Если напечатать в редакторе символ, на вкладке появляется точка, а в строке состояния — «● не сохранено».
- Ctrl+S сохраняет: точка и надпись исчезают, `Kaitos.fs.read('src/utils.js')` содержит внесённую правку.
- Клик по «×» на вкладке закрывает её, редактор снова показывает подсказку «Выберите файл слева…».
- При движении курсора в строке состояния меняются «Стр N, Кол M».

Не делать:
- Не меняй index.html, css-файлы, js/fs.js и js/dom.js.
- Не создавай дерево файлов и чат — это следующие задачи.
- Не добавляй подсветку синтаксиса и библиотеки — только чистый JS.
