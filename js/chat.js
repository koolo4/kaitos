/*
 * Панель ассистента: настоящие ответы модели с потоковой отрисовкой,
 * отмена запроса, разметка markdown, копирование кода и демо-режим без модели.
 */

import { $, formatTime } from './dom.js';
import { buildMessages } from './prompts.js';
import { renderChatMessage } from './markdown.js';
import { parseEdits, parsePatches, patchesToEdits, patchContent, stripEditBlocks } from './tools.js';
import { renderDiffHtml, diffStats, diffLines } from './diff.js';
import { buildPlanMessages, buildImplementationMessages, parsePlan } from './planner.js';

const ROLE_LABEL = { assistant: 'Kaitos', user: 'Вы' };

export function initChat(ctx) {
  const messagesEl = $('#chat-messages');
  const form = $('#chat-form');
  const input = $('#chat-input');
  const quick = $('#chat-quick');
  const stopButton = $('#chat-stop');
  const sendButton = $('#chat-send');
  const planToggle = $('#chat-plan-toggle');

  const messages = [];
  const state = { busy: false, controller: null, pending: [], planMode: false, pendingPlan: null };

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

  function updateControls() {
    if (sendButton) sendButton.disabled = state.busy || Boolean(state.pendingPlan);
    if (planToggle) {
      planToggle.disabled = state.busy || Boolean(state.pendingPlan);
      planToggle.setAttribute('aria-pressed', String(state.planMode));
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    if (stopButton) stopButton.hidden = !busy;
    updateControls();
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
    if (!edit || edit.error) return false;

    // Точечную правку считаем от актуального текста, а не от снимка в карточке:
    // так порядок нажатий не важен и несколько правок одного файла не затирают друг друга.
    let content = edit.content;
    if (edit.kind === 'patch' && ctx.fs.has(edit.path)) {
      try {
        content = patchContent(ctx.fs.read(edit.path), edit.find, edit.replace);
      } catch (error) {
        if (ctx.terminal) ctx.terminal.print(`Правка ${edit.path} не применилась: ${error.message}`, 'err');
        card.classList.add('edit-card--rejected');
        const actions = card.querySelector('.edit-card__actions');
        if (actions) actions.innerHTML = `<span class="edit-card__done">не применилось: ${error.message}</span>`;
        return false;
      }
    }

    ctx.fs.write(edit.path, content);
    if (ctx.editor && ctx.editor.refresh) ctx.editor.refresh(edit.path);
    if (ctx.tree && ctx.tree.render) ctx.tree.render();
    if (ctx.onFilesChanged) ctx.onFilesChanged();
    card.classList.add('edit-card--applied');
    const actions = card.querySelector('.edit-card__actions');
    if (actions) actions.innerHTML = '<span class="edit-card__done">✓ применено</span>';
    addMessage('assistant', `Файл ${edit.path} обновлён.`);
    return true;
  }

  function rejectEdit(index, card) {
    card.classList.add('edit-card--rejected');
    const actions = card.querySelector('.edit-card__actions');
    if (actions) actions.innerHTML = '<span class="edit-card__done">отклонено</span>';
    void index;
  }

  function renderPlanCard(node, plan) {
    const card = document.createElement('section');
    card.className = 'plan-card';
    card.dataset.planCard = 'true';

    const title = document.createElement('h3');
    title.className = 'plan-card__title';
    title.textContent = plan.title;

    const steps = document.createElement('ol');
    steps.className = 'plan-card__steps';
    for (const item of plan.steps) {
      const li = document.createElement('li');
      li.textContent = item;
      steps.append(li);
    }

    const files = document.createElement('div');
    files.className = 'plan-card__files';
    files.textContent = `Файлы: ${plan.files.join(', ')}`;

    const actions = document.createElement('div');
    actions.className = 'plan-card__actions';
    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'btn-primary btn-sm';
    run.dataset.runPlan = 'true';
    run.textContent = 'Выполнить план';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn-ghost btn-sm';
    cancel.dataset.cancelPlan = 'true';
    cancel.textContent = 'Отменить';
    actions.append(run, cancel);

    card.append(title, steps, files, actions);
    node.append(card);
    scrollDown();
    return card;
  }

  async function requestPlan(task) {
    addMessage('user', task);
    if (!ctx.llm || !ctx.llm.isConfigured()) {
      addMessage('assistant', 'Для планирования выберите модель в «Настройках» (например, Ollama с qwen3.5:9b).', { error: true });
      return;
    }

    const answer = addMessage('assistant', '');
    const node = messagesEl.lastElementChild;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    state.controller = controller;
    setBusy(true);
    showTyping();
    let text = '';
    try {
      const messages = buildPlanMessages({ task, files: ctx.fs.list(), activeFile: currentFile() });
      await ctx.llm.chat({
        messages,
        signal: controller ? controller.signal : null,
        onToken: (chunk) => {
          text += chunk;
          if (text.length <= 6000) {
            answer.text = text;
            updateNode(node, answer);
          }
        },
      });
      hideTyping();
      const plan = parsePlan(text);
      answer.text = text.replace(/```kaitos-plan\s*[\s\S]*?```/i, '').trim() || 'План готов. Проверьте шаги и запустите выполнение.';
      updateNode(node, answer);
      state.pendingPlan = { task, plan, card: renderPlanCard(node, plan) };
      updateControls();
    } catch (error) {
      hideTyping();
      answer.error = true;
      answer.text = error && error.code === 'aborted' ? 'Планирование отменено.' : error.message || 'Не удалось составить план.';
      updateNode(node, answer);
    } finally {
      setBusy(false);
      state.controller = null;
    }
  }

  function cancelPlan(card) {
    if (state.pendingPlan && state.pendingPlan.card === card) state.pendingPlan = null;
    card.classList.add('plan-card--done');
    const actions = card.querySelector('.plan-card__actions');
    if (actions) actions.textContent = 'План отменён';
    updateControls();
  }

  async function executePlan(card) {
    const pending = state.pendingPlan;
    if (!pending || pending.card !== card || state.busy) return;
    state.pendingPlan = null;
    updateControls();
    card.classList.add('plan-card--done');
    const actions = card.querySelector('.plan-card__actions');
    if (actions) actions.textContent = 'План выполняется…';

    const answer = addMessage('assistant', 'Выполняю согласованный план…');
    const node = messagesEl.lastElementChild;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    state.controller = controller;
    setBusy(true);
    showTyping();
    let text = '';
    try {
      const messages = buildImplementationMessages({ task: pending.task, plan: pending.plan, fs: ctx.fs });
      text = await ctx.llm.chat({
        messages,
        signal: controller ? controller.signal : null,
        onToken: (chunk) => {
          text += chunk;
          if (text.length <= 12000) {
            answer.text = stripEditBlocks(text);
            updateNode(node, answer);
          }
        },
      });
      hideTyping();
      answer.text = stripEditBlocks(text) || 'План реализован.';
      updateNode(node, answer);

      const edits = [...patchesToEdits(ctx.fs, parsePatches(text)), ...parseEdits(text)];
      const allowedPaths = new Set(pending.plan.files);
      for (const edit of edits) {
        if (!edit.error && !allowedPaths.has(edit.path)) {
          edit.error = `Файл не входит в согласованный план: ${edit.path}`;
          edit.content = '';
        }
      }
      if (!edits.length) {
        answer.error = true;
        answer.text = 'Модель не вернула правки файлов. Проверьте план или повторите выполнение.';
        updateNode(node, answer);
        return;
      }

      const firstIndex = state.pending.length;
      renderEditCards(node, edits);
      const cards = Array.from(node.querySelectorAll('.edit-card'));
      const applied = [];
      const failed = [];
      edits.forEach((edit, index) => {
        if (edit.error) {
          failed.push(`${edit.path || edit.rawPath}: ${edit.error}`);
          return;
        }
        if (applyEdit(firstIndex + index, cards[cards.length - edits.length + index])) applied.push(edit.path);
        else failed.push(`${edit.path}: файл изменился или правка не применилась`);
      });

      if (ctx.fs.flush) {
        const previousErrorCount = Array.isArray(ctx.fs.errors) ? ctx.fs.errors.length : 0;
        const flushed = await ctx.fs.flush();
        if (flushed.errors > previousErrorCount) {
          const newErrors = Array.isArray(ctx.fs.errors) ? ctx.fs.errors.slice(previousErrorCount) : [];
          failed.push(newErrors.length
            ? `запись на диск: ${newErrors.map((item) => `${item.path} — ${item.message}`).join(', ')}`
            : 'часть файлов не удалось записать на диск');
        }
      }
      addMessage('assistant', failed.length
        ? `План выполнен частично. Изменены: ${applied.join(', ') || 'нет файлов'}. Нужно проверить: ${failed.join('; ')}`
        : `План выполнен. Изменены файлы: ${applied.join(', ')}.`);
      card.classList.add('plan-card--done');
      if (actions) actions.textContent = failed.length ? 'Выполнено частично' : 'Выполнено';
      state.planMode = false;
      updateControls();
    } catch (error) {
      hideTyping();
      answer.error = true;
      answer.text = error && error.code === 'aborted' ? 'Выполнение плана остановлено.' : error.message || 'Не удалось выполнить план.';
      updateNode(node, answer);
      if (actions) actions.textContent = 'Выполнение остановлено';
    } finally {
      setBusy(false);
      state.controller = null;
    }
  }

  async function send(rawText) {
    const prompt = String(rawText || '').trim();
    if (!prompt || state.busy || state.pendingPlan) return;
    input.value = '';

    if (state.planMode) {
      await requestPlan(prompt);
      return;
    }

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
      answer.edits = [
        ...patchesToEdits(ctx.fs, parsePatches(text)),
        ...parseEdits(text),
      ];
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
    state.pendingPlan = null;
    state.planMode = false;
    if (planToggle) planToggle.textContent = 'План';
    if (input) input.placeholder = 'Спросите о коде…';
    messagesEl.innerHTML = '';
    updateControls();
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
  if (planToggle) planToggle.addEventListener('click', () => {
    state.planMode = !state.planMode;
    planToggle.textContent = state.planMode ? 'План: вкл' : 'План';
    input.placeholder = state.planMode ? 'Опишите, что нужно спланировать и реализовать…' : 'Спросите о коде…';
    updateControls();
  });

  quick.addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]');
    if (button) send(button.dataset.prompt);
  });

  /* Применение и отклонение предложенных правок. */
  messagesEl.addEventListener('click', (event) => {
    const runPlan = event.target.closest('[data-run-plan]');
    if (runPlan) {
      executePlan(runPlan.closest('.plan-card'));
      return;
    }
    const cancelPlanButton = event.target.closest('[data-cancel-plan]');
    if (cancelPlanButton) {
      cancelPlan(cancelPlanButton.closest('.plan-card'));
      return;
    }
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

  function planTask(text) {
    state.planMode = true;
    if (planToggle) planToggle.textContent = 'План: вкл';
    if (input) input.placeholder = 'Опишите, что нужно спланировать и реализовать…';
    updateControls();
    return send(text);
  }

  return {
    send,
    planTask,
    stop,
    clear,
    addMessage,
    messages,
    get busy() {
      return state.busy;
    },
    get planPending() {
      return Boolean(state.pendingPlan);
    },
  };
}
