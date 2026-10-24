Цель: Показать демо-проект деревом: папки сворачиваются, файлы открываются в редакторе, активный файл подсвечен.

Проект: Kaitos — AI-редактор кода в браузере (аналог Cursor / Claude Code).
Стек: Vite 5 + ванильный JavaScript, ES-модули. Все файлы — в корне репозитория.
Файл `index.html` уже существует, его менять нельзя: в нём зафиксированы id элементов.

Требования:

1. Новый файл — `js/tree.js`, второй файл заменяет точку входа `js/app.js`.
2. Создай файл `js/tree.js` с текстом ниже — инструментом write_file. Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
/* Дерево файлов в левой панели: папки сворачиваются, файлы открываются в редакторе. */

import { $ } from './dom.js';

export function initTree(ctx) {
  const root = $('#file-tree');
  const collapsed = new Set();

  function setActive(path) {
    root.querySelectorAll('.tree-row').forEach((row) => {
      row.classList.toggle('is-active', Boolean(path) && row.dataset.path === path);
    });
  }

  function renderNode(node, depth) {
    const row = document.createElement('div');
    row.className = 'tree-row' + (node.type === 'dir' ? ' tree-row--dir' : '');
    row.dataset.path = node.path;
    row.dataset.type = node.type;
    row.style.setProperty('--depth', String(depth));
    row.setAttribute('role', 'treeitem');

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    if (node.type === 'dir') icon.textContent = collapsed.has(node.path) ? '▸' : '▾';
    else icon.textContent = '·';

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node.name;

    row.append(icon, name);

    row.addEventListener('click', () => {
      if (node.type === 'dir') {
        if (collapsed.has(node.path)) collapsed.delete(node.path);
        else collapsed.add(node.path);
        render();
        return;
      }
      if (ctx.editor) ctx.editor.open(node.path);
    });

    const wrap = document.createElement('div');
    wrap.append(row);

    if (node.type === 'dir' && !collapsed.has(node.path)) {
      for (const child of node.children || []) wrap.append(renderNode(child, depth + 1));
    }
    return wrap;
  }

  function render() {
    root.innerHTML = '';
    const nodes = ctx.fs.tree();
    if (!nodes.length) {
      root.textContent = 'В проекте нет файлов';
      return;
    }
    for (const node of nodes) root.append(renderNode(node, 0));
    setActive(ctx.editor ? ctx.editor.active : null);
  }

  render();
  if (ctx.editor) ctx.editor.onChange((info) => setActive(info.path));

  return { render, setActive };
}
````

3. Замени всё содержимое файла `js/app.js` на текст ниже — инструментом write_file (не edit_file). Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
/*
 * Kaitos v0.1.0 — точка входа.
 * Подключены файловая система, редактор и дерево файлов. Чат и терминал — следующие задачи.
 */

import { $, formatTime } from './dom.js';
import { createFs } from './fs.js';
import { initEditor } from './editor.js';
import { initTree } from './tree.js';

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
  ctx.tree = initTree(ctx);

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

4. Проверь в браузере: клик по файлу в дереве открывает его в редакторе.

Готово, когда:
- В левой панели видно дерево: папки `docs`, `src`, `styles` и файлы `README.md`, `package.json`; внутри `src` — `main.js`, `utils.js` и папка `components`.
- Клик по `src/utils.js` открывает файл в редакторе и подсвечивает строку дерева.
- Клик по папке сворачивает и разворачивает её содержимое (стрелка меняется с «▾» на «▸»).
- У каждого элемента дерева есть атрибуты `data-path` (путь файла) и `data-type` (`file` или `dir`).
- В консоли браузера нет ошибок.

Не делать:
- Не меняй index.html, css-файлы, js/fs.js, js/editor.js, js/dom.js.
- Не создавай чат и терминал — это следующие задачи.
- Не добавляй кнопки создания и удаления файлов.
