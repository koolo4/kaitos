/*
 * Панель ассистента: настоящие ответы модели с потоковой отрисовкой,
 * отмена запроса, разметка markdown, копирование кода и демо-режим без модели.
 */

import { $, formatTime } from './dom.js';
import { buildMessages } from './prompts.js';
import { renderChatMessage } from './markdown.js';

const ROLE_LABEL = { assistant: 'Kaitos', user: 'Вы' };

export function initChat(ctx) {
  const messagesEl = $('#chat-messages');
  const form = $('#chat-form');
  const input = $('#chat-input');
  const quick = $('#chat-quick');
  const stopButton = $('#chat-stop');
  const sendButton = $('#chat-send');

  const messages = [];
  const state = { busy: false, controller: null };

  function scrollDown() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function currentFile() {
    if (!ctx.editor || !ctx.editor.active) return null;
    const path = ctx.editor.active;
    let content = '';
    try {
      content = ctx.editor.contentOf(path);
    } catch (error) {
      content = '';
    }
    return { path, content };
  }

  function createMessageNode(message) {
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
    if (message.role === 'assistant') text.innerHTML = renderChatMessage(message.text || '');
    else text.textContent = message.text;

    wrap.append(head, text);
    return wrap;
  }

  function updateNode(node, message) {
    const text = node.querySelector('.chat-msg__text');
    if (!text) return;
    if (message.role === 'assistant') {
      text.innerHTML = message.error
        ? `<span class="chat-error">${escapeText(message.text)}</span>${message.detail ? `<span class="chat-error__detail">${escapeText(message.detail)}</span>` : ''}`
        : renderChatMessage(message.text || '');
    } else {
      text.textContent = message.text;
    }
    scrollDown();
  }

  function escapeText(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function addMessage(role, text, extra = {}) {
    const message = { role, text, time: formatTime(), ...extra };
    messages.push(message);
    messagesEl.append(createMessageNode(message));
    scrollDown();
    return message;
  }

  function setBusy(busy) {
    state.busy = busy;
    if (stopButton) stopButton.hidden = !busy;
    if (sendButton) sendButton.disabled = busy;
    document.body.classList.toggle('is-chat-busy', busy);
  }

  function showTyping() {
    hideTyping();
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

  function demoReply(prompt) {
    const file = currentFile();
    const lower = prompt.toLowerCase();
    if (!file) {
      return 'Откройте файл в дереве слева — тогда я смогу опереться на его текст. Сейчас работает демо-режим: настоящая модель ещё не подключена. Откройте «Настройки» и выберите провайдера (Ollama или OpenAI-совместимый API).';
    }
    const lines = file.content.split('\n').length;
    if (lower.includes('ошибк') || lower.includes('error')) {
      return `Просмотрел ${file.path} (${lines} строк). Явных синтаксических ошибок не видно. Настоящий разбор включится, когда в «Настройках» будет выбрана модель.`;
    }
    if (lower.includes('объясн')) {
      return `Файл ${file.path}: ${lines} строк, ${file.content.length} символов. Это демо-ответ — подключите Ollama или OpenAI-совместимый API в «Настройках», и я разберу код по-настоящему.`;
    }
    if (lower.includes('коммент')) {
      return `Могу добавить комментарии в ${file.path}, но в демо-режиме файлы не меняю. Подключите модель в «Настройках» — тогда я предложу правку и покажу её diff.`;
    }
    return `Принял: «${prompt}». Контекст — ${file.path} (${lines} строк). Сейчас это демо-ответ: модель не выбрана в «Настройках».`;
  }

  function historyForModel() {
    return messages
      .filter((item) => !item.error && item.text)
      .map((item) => ({ role: item.role, text: item.text }));
  }

  async function send(rawText) {
    const prompt = String(rawText || '').trim();
    if (!prompt || state.busy) return;
    input.value = '';

    addMessage('user', prompt);
    const file = currentFile();
    const useModel = ctx.llm && ctx.llm.isConfigured();

    if (!useModel) {
      showTyping();
      await new Promise((resolve) => setTimeout(resolve, 400));
      hideTyping();
      addMessage('assistant', demoReply(prompt));
      return;
    }

    const answer = addMessage('assistant', '');
    const node = messagesEl.lastElementChild;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    state.controller = controller;

    setBusy(true);
    showTyping();

    const payload = buildMessages({
      prompt,
      history: historyForModel().slice(0, -1),
      file,
      projectName: ctx.fs && ctx.fs.name ? ctx.fs.name() : 'demo',
    });

    let streamed = false;
    try {
      const text = await ctx.llm.chat({
        messages: payload,
        signal: controller ? controller.signal : null,
        onToken: (chunk) => {
          if (!streamed) {
            streamed = true;
            hideTyping();
          }
          answer.text = (answer.text || '') + chunk;
          updateNode(node, answer);
        },
      });
      if (!answer.text) answer.text = text;
      if (!streamed) hideTyping();
      updateNode(node, answer);
      if (!answer.text.trim()) {
        answer.text = 'Модель вернула пустой ответ. Попробуйте другую модель или уменьшите объём контекста.';
        answer.error = true;
        updateNode(node, answer);
      }
    } catch (error) {
      hideTyping();
      const aborted = error && error.code === 'aborted';
      if (aborted && !answer.text) {
        answer.text = 'Запрос отменён.';
        answer.error = true;
      } else {
        answer.error = true;
        answer.text = aborted ? `Ответ остановлен:\n${answer.text}` : error.message || 'Не удалось получить ответ модели.';
        answer.detail = error && error.detail ? error.detail : '';
      }
      updateNode(node, answer);
    } finally {
      setBusy(false);
      state.controller = null;
    }
  }

  function stop() {
    if (state.controller) state.controller.abort();
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

  if (stopButton) stopButton.addEventListener('click', stop);

  quick.addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]');
    if (button) send(button.dataset.prompt);
  });

  /* Копирование блоков кода из ответов. */
  messagesEl.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const code = button.closest('.md-code');
    const text = code ? code.querySelector('code').textContent : '';
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Скопировано';
    } catch (error) {
      button.textContent = 'Не удалось';
    }
    window.setTimeout(() => {
      button.textContent = 'Копировать';
    }, 1500);
  });

  addMessage('assistant', 'Привет! Я ассистент Kaitos. Откройте файл и спросите о нём — подскажу, что внутри.');

  return {
    send,
    stop,
    clear,
    addMessage,
    messages,
    get busy() {
      return state.busy;
    },
  };
}
