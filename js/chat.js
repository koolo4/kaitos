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
