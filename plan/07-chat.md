Цель: Сделать чат с ассистентом: сообщения, отправка по Enter и кнопкой, индикатор «печатает…», быстрые кнопки-подсказки. Ответы пока демонстрационные, без сети.

Проект: Kaitos — AI-редактор кода в браузере (аналог Cursor / Claude Code).
Стек: Vite 5 + ванильный JavaScript, ES-модули. Все файлы — в корне репозитория.
Файл `index.html` уже существует, его менять нельзя: в нём зафиксированы id элементов.

Требования:

1. Новый файл — `js/chat.js`, второй файл заменяет точку входа `js/app.js`.
2. Создай файл `js/chat.js` с текстом ниже — инструментом write_file. Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
/* Панель ассистента. Сейчас — демо-ответы без сети; подключение модели — следующая фаза. */

import { $, formatTime } from './dom.js';

const ROLE_LABEL = { assistant: 'Kaitos', user: 'Вы' };

export function initChat(ctx) {
  const messagesEl = $('#chat-messages');
  const form = $('#chat-form');
  const input = $('#chat-input');
  const quick = $('#chat-quick');
  const messages = [];

  function scrollDown() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderMessage(message) {
    const wrap = document.createElement('div');
    wrap.className = `chat-msg chat-msg--${message.role}`;

    const head = document.createElement('div');
    head.className = 'chat-msg__head';

    const role = document.createElement('span');
    role.className = 'chat-msg__role';
    role.textContent = ROLE_LABEL[message.role] || message.role;

    const time = document.createElement('span');
    time.className = 'chat-msg__time';
    time.textContent = message.time;

    head.append(role, time);

    const text = document.createElement('div');
    text.className = 'chat-msg__text';
    text.textContent = message.text;

    wrap.append(head, text);
    return wrap;
  }

  function addMessage(role, text) {
    const message = { role, text, time: formatTime() };
    messages.push(message);
    messagesEl.append(renderMessage(message));
    scrollDown();
    return message;
  }

  function showTyping() {
    const wrap = document.createElement('div');
    wrap.className = 'chat-msg chat-msg--assistant chat-msg--typing';
    wrap.id = 'chat-typing';

    const text = document.createElement('div');
    text.className = 'chat-msg__text';
    text.textContent = 'Kaitos печатает…';

    wrap.append(text);
    messagesEl.append(wrap);
    scrollDown();
  }

  function hideTyping() {
    const node = $('#chat-typing');
    if (node) node.remove();
  }

  function currentFile() {
    return ctx.editor && ctx.editor.active ? ctx.editor.active : null;
  }

  function mockReply(prompt) {
    const path = currentFile();
    const lower = prompt.toLowerCase();

    if (!path) {
      return 'Откройте файл в дереве слева — тогда я смогу опереться на его текст. Сейчас работает демо-режим: настоящая модель ещё не подключена.';
    }

    const text = ctx.editor.contentOf(path);
    const lines = text.split('\n').length;

    if (lower.includes('ошибк') || lower.includes('error')) {
      return `Просмотрел ${path} (${lines} строк). Явных синтаксических ошибок не видно. Искать логические я смогу, когда в «Настройках» будет указана модель.`;
    }
    if (lower.includes('объясн')) {
      return `Файл ${path}: ${lines} строк, ${text.length} символов. Это демо-ответ — подключите Ollama или OpenAI-совместимый API в «Настройках», и я разберу код по-настоящему.`;
    }
    if (lower.includes('коммент')) {
      return `Могу добавить комментарии в ${path}, но в демо-режиме файлы не меняю. Подключите модель в «Настройках» — тогда я предложу правку и покажу её diff.`;
    }
    return `Принял: «${prompt}». Контекст — ${path} (${lines} строк). Сейчас это демо-ответ без модели: подключение нейросети — следующая фаза проекта.`;
  }

  function send(text) {
    const value = String(text || '').trim();
    if (!value) return;
    addMessage('user', value);
    input.value = '';
    showTyping();
    window.setTimeout(() => {
      hideTyping();
      addMessage('assistant', mockReply(value));
    }, 600);
  }

  function clear() {
    messages.length = 0;
    messagesEl.innerHTML = '';
    addMessage('assistant', 'Чат очищен. О чём поговорим?');
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send(input.value);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(input.value);
    }
  });

  quick.addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]');
    if (button) send(button.dataset.prompt);
  });

  addMessage('assistant', 'Привет! Я ассистент Kaitos. Откройте файл и спросите о нём — подскажу, что внутри.');

  return { send, clear, addMessage, messages };
}
````

3. Замени всё содержимое файла `js/app.js` на текст ниже — инструментом write_file (не edit_file). Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
/*
 * Kaitos v0.1.0 — точка входа.
 * Подключены файловая система, редактор, дерево файлов и чат. Терминал — следующая задача.
 */

import { $, formatTime } from './dom.js';
import { createFs } from './fs.js';
import { initEditor } from './editor.js';
import { initTree } from './tree.js';
import { initChat } from './chat.js';

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

4. Проверь в браузере: открой файл в дереве, напиши в чат «Объясни этот файл», нажми «Отправить».

Готово, когда:
- При загрузке страницы в чате одно приветственное сообщение ассистента.
- Ввод текста и Enter (или кнопка «Отправить») добавляют сообщение пользователя, затем на ~0,6 с появляется «Kaitos печатает…» и приходит ответ.
- Ответ упоминает имя открытого файла и число строк в нём; если файл не открыт — просит открыть файл.
- Три быстрые кнопки («Объясни файл», «Найди ошибки», «Комментарии») отправляют свой вопрос.
- В шапке панели чип `#chat-context` показывает путь открытого файла (например, `src/utils.js`) или «без файла».
- Классы сообщений: `.chat-msg`, `.chat-msg--user`, `.chat-msg--assistant`.

Не делать:
- Не подключай сеть, fetch, модели и API — только демо-ответы из текста задания.
- Не меняй index.html, css-файлы, js/fs.js, js/editor.js, js/tree.js, js/dom.js.
- Не создавай терминал — это следующая задача.
