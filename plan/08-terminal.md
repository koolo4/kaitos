Цель: Сделать терминал с командами над демо-проектом: help, ls, cat, open, pwd, echo, date, theme, model, clear, whoami, история по стрелкам вверх/вниз.

Проект: Kaitos — AI-редактор кода в браузере (аналог Cursor / Claude Code).
Стек: Vite 5 + ванильный JavaScript, ES-модули. Все файлы — в корне репозитория.
Разметка приложения живёт в index.html, стили — в css/, код — в js/. Какие файлы создать или заменить, сказано в требованиях.

Требования:

1. Новый файл — `js/terminal.js`, второй файл заменяет точку входа `js/app.js`.
2. Создай файл `js/terminal.js` с текстом ниже — инструментом write_file. Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
/* Встроенный терминал: виртуальные команды над демо-проектом, история по стрелкам. */

import { $ } from './dom.js';

export function initTerminal(ctx) {
  const output = $('#terminal-output');
  const form = $('#terminal-form');
  const input = $('#terminal-input');
  const history = [];
  let historyIndex = 0;

  function print(text, kind = '') {
    const line = document.createElement('div');
    line.className = 'term-line' + (kind ? ` term-line--${kind}` : '');
    line.textContent = text;
    output.append(line);
    output.scrollTop = output.scrollHeight;
  }

  function clear() {
    output.innerHTML = '';
  }

  const commands = {
    help() {
      print('Команды: help, ls [папка], cat <файл>, open <файл>, pwd, echo <текст>, date, theme dark|light, model, clear, whoami', 'muted');
    },
    ls(args) {
      const dir = args[0] || '';
      const items = ctx.fs.listDir(dir);
      if (!items.length) {
        print(`пусто: ${dir || '/'}`);
        return;
      }
      print(items.map((item) => (item.type === 'dir' ? `${item.name}/` : item.name)).join('  '));
    },
    cat(args) {
      if (!args[0]) {
        print('использование: cat <путь>', 'err');
        return;
      }
      try {
        print(ctx.fs.read(args[0]));
      } catch (error) {
        print(error.message, 'err');
      }
    },
    open(args) {
      if (!args[0]) {
        print('использование: open <путь>', 'err');
        return;
      }
      if (!ctx.fs.has(args[0])) {
        print(`Файл не найден: ${args[0]}`, 'err');
        return;
      }
      ctx.editor.open(args[0]);
      print(`открыт ${args[0]}`, 'ok');
    },
    pwd() {
      print('/home/user/demo');
    },
    echo(args) {
      print(args.join(' '));
    },
    date() {
      print(new Date().toLocaleString('ru-RU'));
    },
    theme(args) {
      const value = args[0];
      if (value !== 'dark' && value !== 'light') {
        print('использование: theme dark|light', 'err');
        return;
      }
      ctx.updateSettings({ theme: value });
      print(`тема: ${value}`, 'ok');
    },
    model() {
      print(`провайдер: ${ctx.settings.provider}, модель: ${ctx.settings.model || '—'}`);
    },
    whoami() {
      print('kaitos');
    },
    clear() {
      clear();
    },
  };

  function run(line) {
    const value = String(line || '').trim();
    print(`kaitos:~/demo $ ${value}`, 'cmd');
    if (!value) return;
    history.push(value);
    historyIndex = history.length;
    const parts = value.split(/\s+/);
    const name = parts[0];
    const args = parts.slice(1);
    const command = commands[name];
    if (!command) {
      print(`команда не найдена: ${name}. Введите help.`, 'err');
      return;
    }
    try {
      command(args);
    } catch (error) {
      print(error.message, 'err');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run(input.value);
    input.value = '';
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = history[historyIndex] || '';
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      historyIndex = Math.min(history.length, historyIndex + 1);
      input.value = history[historyIndex] || '';
    }
  });

  print('Kaitos v0.1.0 — виртуальный терминал демо-проекта. Введите help.', 'muted');

  return { run, clear, print };
}
````

3. Замени всё содержимое файла `js/app.js` на текст ниже — инструментом write_file (не edit_file). Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
/*
 * Kaitos v0.1.0 — точка входа.
 * Подключены файловая система, редактор, дерево файлов, чат и терминал. Настройки — следующая задача.
 */

import { $, formatTime } from './dom.js';
import { createFs } from './fs.js';
import { initEditor } from './editor.js';
import { initTree } from './tree.js';
import { initChat } from './chat.js';
import { initTerminal } from './terminal.js';

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
  ctx.chat = initChat(ctx);
  ctx.terminal = initTerminal(ctx);

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
  $('#btn-terminal-clear').addEventListener('click', () => ctx.terminal.clear());

  startClock();

  ctx.toggleSidebar = toggleSidebar;
  ctx.toggleTerminal = toggleTerminal;
  ctx.ready = true;
  window.Kaitos = ctx;
}

boot();
````

4. Проверь в браузере: введи `help`, затем `ls`, затем `cat src/main.js`.

Готово, когда:
- При загрузке в терминале приветственная строка с подсказкой про `help`.
- `ls` выводит содержимое корня (`src/`, `docs/`, `styles/`, файлы), `ls src` — содержимое папки `src`.
- `cat src/main.js` печатает текст файла, `cat нет-такого` — красную строку «Файл не найден».
- `open src/utils.js` открывает файл в редакторе и пишет «открыт src/utils.js».
- `help` перечисляет команды; неизвестная команда даёт строку «команда не найдена» красным.
- Стрелки ↑ и ↓ листают историю команд.
- Кнопка «Очистить» в шапке терминала (id `#btn-terminal-clear`) очищает вывод.
- В консоли браузера нет ошибок.

Не делать:
- Не запускай настоящие системные команды и не подключай сеть — только виртуальные команды.
- Не меняй index.html, css-файлы и другие js-модули, кроме `js/app.js`.
- Не создавай настройки — это следующая задача.
