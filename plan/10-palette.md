Цель: Добавить палитру команд: открытие по Ctrl+K и кнопке «Команды», фильтр по вводу, стрелки и Enter, переход к любому файлу проекта.

Проект: Kaitos — AI-редактор кода в браузере (аналог Cursor / Claude Code).
Стек: Vite 5 + ванильный JavaScript, ES-модули. Все файлы — в корне репозитория.
Файл `index.html` уже существует, его менять нельзя: в нём зафиксированы id элементов.

Требования:

1. Новый файл — `js/palette.js`, второй файл заменяет точку входа `js/app.js` на итоговую версию со всеми модулями.
2. Создай файл `js/palette.js` с текстом ниже — инструментом write_file. Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
/* Палитра команд (Ctrl+K): команды приложения и быстрый переход к файлам. */

import { $ } from './dom.js';

export function initPalette(ctx) {
  const root = $('#palette');
  const inputEl = $('#palette-input');
  const listEl = $('#palette-list');
  let items = [];
  let selected = 0;

  function buildCommands() {
    const commands = [
      { group: 'Приложение', title: 'Настройки', run: () => ctx.settingsApi.open() },
      {
        group: 'Приложение',
        title: 'Переключить тему',
        run: () => ctx.updateSettings({ theme: ctx.settings.theme === 'dark' ? 'light' : 'dark' }),
      },
      { group: 'Приложение', title: 'Очистить чат', run: () => ctx.chat.clear() },
      { group: 'Терминал', title: 'Очистить терминал', run: () => ctx.terminal.clear() },
      { group: 'Терминал', title: 'Свернуть или развернуть терминал', run: () => ctx.toggleTerminal() },
      { group: 'Терминал', title: 'Перейти в терминал', run: () => $('#terminal-input').focus() },
      { group: 'Панели', title: 'Свернуть или развернуть дерево файлов', run: () => ctx.toggleSidebar() },
    ];
    for (const path of ctx.fs.list()) {
      commands.push({ group: 'Файлы', title: `Открыть ${path}`, run: () => ctx.editor.open(path) });
    }
    return commands;
  }

  function render(filter = '') {
    const query = filter.trim().toLowerCase();
    const all = buildCommands();
    items = query ? all.filter((item) => item.title.toLowerCase().includes(query)) : all;
    if (selected > items.length - 1) selected = Math.max(0, items.length - 1);

    listEl.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'palette__empty';
      empty.textContent = 'Ничего не найдено';
      listEl.append(empty);
      return;
    }

    let lastGroup = null;
    items.forEach((item, index) => {
      if (item.group !== lastGroup) {
        lastGroup = item.group;
        const group = document.createElement('div');
        group.className = 'palette__group';
        group.textContent = item.group;
        listEl.append(group);
      }

      const row = document.createElement('div');
      row.className = 'palette__item' + (index === selected ? ' is-selected' : '');
      row.dataset.index = String(index);
      row.textContent = item.title;
      listEl.append(row);
    });

    const active = listEl.querySelector('.palette__item.is-selected');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function choose(index) {
    const item = items[index];
    if (!item) return;
    close();
    item.run();
  }

  function open() {
    root.hidden = false;
    inputEl.value = '';
    selected = 0;
    render('');
    inputEl.focus();
  }

  function close() {
    root.hidden = true;
  }

  document.addEventListener('keydown', (event) => {
    const isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
    if (isShortcut) {
      event.preventDefault();
      if (root.hidden) open();
      else close();
      return;
    }
    if (root.hidden) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selected = Math.min(items.length - 1, selected + 1);
      render(inputEl.value);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selected = Math.max(0, selected - 1);
      render(inputEl.value);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(selected);
    }
  });

  inputEl.addEventListener('input', () => {
    selected = 0;
    render(inputEl.value);
  });

  listEl.addEventListener('click', (event) => {
    const row = event.target.closest('[data-index]');
    if (row) choose(Number(row.dataset.index));
  });

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-close="palette"]')) close();
  });

  return { open, close };
}
````

3. Замени всё содержимое файла `js/app.js` на текст ниже — инструментом write_file (не edit_file). Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
/*
 * Kaitos v0.1.0 — точка входа.
 * Собирает модули приложения и связывает их между собой: файловая система,
 * редактор, дерево файлов, чат, терминал, настройки и палитра команд.
 */

import { $, formatTime } from './dom.js';
import { createFs } from './fs.js';
import { initEditor } from './editor.js';
import { initTree } from './tree.js';
import { initChat } from './chat.js';
import { initTerminal } from './terminal.js';
import { initSettings, loadSettings, saveSettings, applySettings } from './settings.js';
import { initPalette } from './palette.js';

const VERSION = '0.1.0';

const ctx = {
  version: VERSION,
  fs: createFs(),
  settings: loadSettings(),
  ready: false,
};

function updateSettings(patch) {
  ctx.settings = { ...ctx.settings, ...patch };
  saveSettings(ctx.settings);
  applySettings(ctx.settings);
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
  applySettings(ctx.settings);

  ctx.editor = initEditor(ctx);
  ctx.tree = initTree(ctx);
  ctx.chat = initChat(ctx);
  ctx.terminal = initTerminal(ctx);
  ctx.settingsApi = initSettings(ctx);
  ctx.palette = initPalette(ctx);

  ctx.updateSettings = updateSettings;
  ctx.toggleSidebar = toggleSidebar;
  ctx.toggleTerminal = toggleTerminal;

  $('#project-name').textContent = ctx.fs.name();
  $('#status-file').textContent = 'файл не открыт';

  ctx.editor.onChange((info) => {
    $('#status-file').textContent = info.path || 'файл не открыт';
    $('#status-dirty').textContent = info.dirty ? '● не сохранено' : '';
    $('#status-position').textContent = `Стр ${info.line}, Кол ${info.col}`;
    $('#chat-context').textContent = info.path || 'без файла';
  });

  $('#btn-theme').addEventListener('click', () => {
    updateSettings({ theme: ctx.settings.theme === 'dark' ? 'light' : 'dark' });
  });
  $('#btn-sidebar-toggle').addEventListener('click', toggleSidebar);
  $('#btn-terminal-toggle').addEventListener('click', toggleTerminal);
  $('#btn-terminal-clear').addEventListener('click', () => ctx.terminal.clear());
  $('#btn-palette').addEventListener('click', () => ctx.palette.open());

  startClock();

  ctx.ready = true;
  window.Kaitos = ctx;
}

boot();
````

4. Проверь в браузере: нажми «Команды», введи `utils`, выбери строку — файл откроется в редакторе.

Готово, когда:
- Кнопка «Команды» и сочетание Ctrl+K открывают палитру `#palette`.
- Ввод фильтрует список: по слову `utils` остаётся строка «Открыть src/utils.js».
- Стрелки ↑/↓ перемещают подсветку `.palette__item.is-selected`, Enter выполняет выбранную команду, Esc и клик по фону закрывают.
- Клик по строке файла открывает его в редакторе, палитра закрывается.
- Команды «Настройки», «Переключить тему», «Очистить чат», «Очистить терминал», «Свернуть или развернуть терминал», «Свернуть или развернуть дерево файлов» работают.
- В консоли браузера нет ошибок.

Не делать:
- Не меняй index.html, css-файлы и другие js-модули, кроме `js/app.js`.
- Не подключай сторонние библиотеки.
