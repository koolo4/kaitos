/*
 * Панель ассистента: настоящие ответы модели с потоковой отрисовкой,
 * отмена запроса, разметка markdown, копирование кода и демо-режим без модели.
 */

import { $, formatTime } from './dom.js';
import { buildMessages } from './prompts.js';
import { renderChatMessage } from './markdown.js';
import { parseEdits, stripEditBlocks } from './tools.js';
import { renderDiffHtml, diffStats, diffLines } from './diff.js';

const ROLE_LABEL = { assistant: 'Kaitos', user: 'Вы' };

export function initChat(ctx) {
  const messagesEl = $('#chat-messages');
  const form = $('#chat-form');
  const input = $('#chat-input');
  const quick = $('#chat-quick');
  const stopButton = $('#chat-stop');
  const sendButton = $('#chat-send');

  const messages = [];
  const state = { busy: false, controller: null, pending: [] };

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

  /* Карточка предложенной правки: diff, «Применить», «Отклонить». */
  function renderEditCards(node, edits) {
    edits.forEach((edit, index) => {
      const card = document.createElement('div');
      card.className = 'edit-card';
      card.dataset.index = String(state.pending.length);

      const head = document.createElement('div');
      head.className = 'edit-card__head';

      const title = document.createElement('span');
      title.className = 'edit-card__title';
      title.textContent = edit.error ? `✕ ${edit.rawPath}` : `${edit.path}`;

      const badge = document.createElement('span');
      badge.className = 'edit-card__badge';
      const before = !edit.error && ctx.fs.has(edit.path) ? ctx.fs.read(edit.path) : '';
      const stats = edit.error ? { added: 0, removed: 0 } : diffStats(diffLines(before, edit.content));
      badge.textContent = edit.error
        ? 'нельзя применить'
        : `${ctx.fs.has(edit.path) ? 'изменение' : 'новый файл'} · +${stats.added} −${stats.removed}`;

      head.append(title, badge);
      card.append(head);

      if (edit.error) {
        const error = document.createElement('div');
        error.className = 'edit-card__error';
        error.textContent = edit.error;
        card.append(error);
      } else {
        const body = document.createElement('div');
        body.className = 'edit-card__diff';
        body.innerHTML = renderDiffHtml(before, edit.content, 2);
        card.append(body);

        const actions = document.createElement('div');
        actions.className = 'edit-card__actions';

        const apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'btn-primary btn-sm';
        apply.dataset.applyEdit = String(state.pending.length);
        apply.textContent = 'Применить';

        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'btn-ghost btn-sm';
        reject.dataset.rejectEdit = String(state.pending.length);
        reject.textContent = 'Отклонить';

        actions.append(apply, reject);
        card.append(actions);
      }

      state.pending.push(edit);
      node.append(card);
      void index;
    });
    scrollDown();
  }

  function applyEdit(index, card) {
    const edit = state.pending[index];
    if (!edit || edit.error) return;
    ctx.fs.write(edit.path, edit.content);
    if (ctx.editor && ctx.editor.refresh) ctx.editor.refresh(edit.path);
    if (ctx.tree && ctx.tree.render) ctx.tree.render();
    if (ctx.onFilesChanged) ctx.onFilesChanged();
    card.classList.add('edit-card--applied');
    const actions = card.querySelector('.edit-card__actions');
    if (actions) actions.innerHTML = '<span class="edit-card__done">✓ применено</span>';
    addMessage('assistant', `Файл ${edit.path} обновлён.`);
  }

  function rejectEdit(index, card) {
    card.classList.add('edit-card--rejected');
    const actions = card.querySelector('.edit-card__actions');
    if (actions) actions.innerHTML = '<span class="edit-card__done">отклонено</span>';
    void index;
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
      answer.text = stripEditBlocks(answer.text) || 'Готово.';
      updateNode(node, answer);
      answer.edits = parseEdits(text);
      if (answer.edits.length) renderEditCards(node, answer.edits);
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

  /* Применение и отклонение предложенных правок. */
  messagesEl.addEventListener('click', (event) => {
    const apply = event.target.closest('[data-apply-edit]');
    if (apply) {
      const card = apply.closest('.edit-card');
      applyEdit(Number(apply.dataset.applyEdit), card);
      return;
    }
    const reject = event.target.closest('[data-reject-edit]');
    if (reject) {
      const card = reject.closest('.edit-card');
      rejectEdit(Number(reject.dataset.rejectEdit), card);
    }
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
