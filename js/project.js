/* Проектный менеджер: долговременный контекст, backlog с ИИ и статус задач. */

import { createProjectId, createProjectStore } from './project-store.js';

const STATUS_LABELS = { todo: 'К выполнению', in_progress: 'В работе', done: 'Готово', blocked: 'Блокер' };
const PRIORITY_LABELS = { low: 'низкий приоритет', normal: 'обычный приоритет', high: 'высокий приоритет' };
const STATUS_ORDER = ['todo', 'in_progress', 'done', 'blocked'];
const BACKLOG_FENCE = /```kaitos-project\s*\n([\s\S]*?)```/i;
const MAX_GENERATED_TASKS = 12;
const CHECK_SCRIPT = /^(test|build|lint|check|typecheck)(:[a-zA-Z0-9_-]+)*$/;

export function parseBacklog(text) {
  const match = BACKLOG_FENCE.exec(String(text ?? ''));
  if (!match) throw new Error('Модель не вернула структурированный план проекта. Попробуйте ещё раз.');
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (error) {
    throw new Error('Черновик плана проекта содержит повреждённый JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Ожидался JSON-объект плана проекта.');

  const goals = Array.isArray(data.goals) ? data.goals.map((goal) => String(goal || '').trim()).filter(Boolean) : [];
  if (goals.length > 8) throw new Error('Слишком много целей: ограничение — 8.');
  const rawTasks = Array.isArray(data.tasks) ? data.tasks : [];
  if (!rawTasks.length || rawTasks.length > MAX_GENERATED_TASKS) {
    throw new Error(`План должен содержать от 1 до ${MAX_GENERATED_TASKS} задач.`);
  }
  const tasks = rawTasks.map((task, index) => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error(`Задача ${index + 1} имеет неверный формат.`);
    const title = String(task.title || '').trim();
    if (!title || title.length > 180) throw new Error(`У задачи ${index + 1} должно быть короткое название.`);
    const rawDependencies = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    const dependsOn = [...new Set(rawDependencies.map(Number))];
    if (dependsOn.some((dependency) => !Number.isInteger(dependency) || dependency < 0 || dependency >= rawTasks.length || dependency === index)) {
      throw new Error(`У задачи ${index + 1} указана недопустимая зависимость.`);
    }
    const priority = ['low', 'normal', 'high'].includes(task.priority) ? task.priority : 'normal';
    return {
      title,
      description: String(task.description || '').trim().slice(0, 1200),
      priority,
      dependsOn,
    };
  });

  const visiting = new Set();
  const visited = new Set();
  function visit(index) {
    if (visiting.has(index)) throw new Error('В плане есть циклическая зависимость между задачами.');
    if (visited.has(index)) return;
    visiting.add(index);
    for (const dependency of tasks[index].dependsOn) visit(dependency);
    visiting.delete(index);
    visited.add(index);
  }
  tasks.forEach((_, index) => visit(index));
  return { summary: String(data.summary || '').trim().slice(0, 1000), goals: goals.slice(0, 8), tasks };
}

export function initProject(ctx, { root = '' } = {}) {
  const $ = (selector) => document.querySelector(selector);
  const modal = $('#project-modal');
  const titleInput = $('#project-title');
  const visionInput = $('#project-vision');
  const generateButton = $('#project-generate');
  const aiStatus = $('#project-ai-status');
  const preview = $('#project-preview');
  const previewGoals = $('#project-preview-goals');
  const previewTasks = $('#project-preview-tasks');
  const currentGoals = $('#project-current-goals');
  const taskList = $('#project-task-list');
  const taskCount = $('#project-task-count');
  const taskForm = $('#project-task-form');
  const taskInput = $('#project-task-input');
  const saveState = $('#project-save-state');
  const storage = ctx.storage || {};
  const store = createProjectStore({ root, name: storage.name || (ctx.fs.name && ctx.fs.name()) });
  let draft = null;
  let busy = false;
  const execution = { taskId: null, controller: null };

  function saveProject() {
    store.update({ title: titleInput.value, vision: visionInput.value });
    saveState.textContent = 'Сохранено в этом браузере';
  }

  function renderGoals() {
    currentGoals.replaceChildren();
    const goals = store.get().goals;
    if (!goals.length) {
      const empty = document.createElement('span');
      empty.className = 'muted small';
      empty.textContent = 'Цели появятся после составления backlog.';
      currentGoals.append(empty);
      return;
    }
    for (const goal of goals) {
      const chip = document.createElement('span');
      chip.className = 'project-goal';
      chip.textContent = goal;
      currentGoals.append(chip);
    }
  }

  function dependencyState(task, tasks) {
    const byId = new Map(tasks.map((item) => [item.id, item]));
    const waiting = task.dependsOn.map((id) => byId.get(id)).filter((dependency) => dependency && dependency.status !== 'done');
    return { ready: waiting.length === 0, waiting };
  }

  function availableChecks() {
    if (!ctx.fs.has('package.json')) return [];
    try {
      const data = JSON.parse(ctx.fs.read('package.json'));
      const scripts = data && data.scripts && typeof data.scripts === 'object' ? data.scripts : {};
      return Object.entries(scripts)
        .filter(([name, script]) => CHECK_SCRIPT.test(name) && String(script || '').trim())
        .map(([name, script]) => {
          const lifecycle = [`pre${name}`, name, `post${name}`]
            .filter((hook) => scripts[hook])
            .map((hook) => `${hook}: ${String(scripts[hook])}`);
          return {
            name,
            script: lifecycle.join(' · ').slice(0, 480),
            command: name === 'test' ? 'npm test' : `npm run ${name}`,
          };
        })
        .slice(0, 8);
    } catch (error) {
      return [];
    }
  }

  function renderVerification(task, checks) {
    if (task.status !== 'in_progress' && !task.verification) return null;
    const section = document.createElement('div');
    section.className = 'project-task__verification';
    if (task.verification) {
      const result = document.createElement('div');
      result.className = `project-check-result ${task.verification.ok ? 'project-check-result--ok' : 'project-check-result--err'}`;
      const status = task.verification.ok ? 'Проверка прошла' : 'Проверка не пройдена';
      result.textContent = `${status}: ${task.verification.command} · код ${task.verification.code ?? 'нет ответа'} · ${task.verification.durationMs} мс`;
      section.append(result);
      if (task.verification.output) {
        const output = document.createElement('pre');
        output.className = 'project-check-output';
        output.textContent = task.verification.output;
        section.append(output);
      }
    }
    if (task.status === 'in_progress') {
      if (!checks.length) {
        const note = document.createElement('div');
        note.className = 'muted small';
        note.textContent = 'В package.json нет скриптов test/build/lint/check для запуска.';
        section.append(note);
      } else {
        const controls = document.createElement('div');
        controls.className = 'project-check-controls';
        const select = document.createElement('select');
        select.className = 'input project-task__status';
        select.dataset.checkSelect = task.id;
        select.setAttribute('aria-label', `Команда проверки: ${task.title}`);
        for (const item of checks) {
          const option = document.createElement('option');
          option.value = item.command;
          option.textContent = `${item.command} — ${item.script}`;
          select.append(option);
        }
        const run = document.createElement('button');
        run.type = 'button';
        run.className = 'btn-ghost btn-xs';
        run.dataset.runCheck = task.id;
        run.textContent = execution.taskId === task.id ? 'Выполняется…' : 'Запустить проверку';
        run.disabled = execution.taskId !== null || !ctx.api?.run || ctx.storage?.mode !== 'disk';
        controls.append(select, run);
        if (execution.taskId === task.id) {
          const stop = document.createElement('button');
          stop.type = 'button';
          stop.className = 'btn-ghost btn-xs';
          stop.dataset.stopCheck = task.id;
          stop.textContent = 'Остановить';
          controls.append(stop);
        }
        section.append(controls);
        if (ctx.storage?.mode !== 'disk') {
          const note = document.createElement('div');
          note.className = 'muted small';
          note.textContent = 'Подключите локальный сервер Kaitos, чтобы выполнять команды проекта.';
          section.append(note);
        }
      }
      if (task.verification && !task.verification.ok) {
        const repair = document.createElement('button');
        repair.type = 'button';
        repair.className = 'btn-ghost btn-xs';
        repair.dataset.fixCheck = task.id;
        repair.textContent = 'Передать ошибку агенту';
        repair.disabled = Boolean(ctx.chat?.busy || ctx.chat?.planPending);
        section.append(repair);
      }
    }
    return section;
  }

  function renderTasks() {
    const state = store.get();
    const checks = availableChecks();
    const counts = { todo: 0, in_progress: 0, done: 0, blocked: 0 };
    state.tasks.forEach((task) => { counts[task.status] += 1; });
    taskCount.textContent = `${state.tasks.length} · ${counts.done} готово · ${counts.in_progress} в работе`;
    taskList.replaceChildren();
    if (!state.tasks.length) {
      const empty = document.createElement('div');
      empty.className = 'project-empty';
      empty.textContent = 'Задач пока нет. Добавьте задачу или попросите ИИ составить backlog.';
      taskList.append(empty);
      return;
    }

    for (const task of state.tasks) {
      const card = document.createElement('article');
      card.className = `project-task${task.status === 'done' ? ' project-task--done' : ''}`;
      card.dataset.taskId = task.id;
      const info = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'project-task__title';
      title.textContent = task.title;
      info.append(title);
      const meta = document.createElement('div');
      meta.className = 'project-task__meta';
      const dep = dependencyState(task, state.tasks);
      const depText = dep.waiting.length ? ` · ждёт: ${dep.waiting.map((item) => item.title).join(', ')}` : '';
      meta.textContent = `${PRIORITY_LABELS[task.priority]}${depText}${task.description ? ` · ${task.description}` : ''}`;
      info.append(meta);

      const controls = document.createElement('div');
      controls.className = 'project-task__controls';
      const status = document.createElement('select');
      status.className = 'input project-task__status';
      status.dataset.taskStatus = task.id;
      status.setAttribute('aria-label', `Статус: ${task.title}`);
      for (const value of STATUS_ORDER) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = STATUS_LABELS[value];
        status.append(option);
      }
      status.value = task.status;
      const plan = document.createElement('button');
      plan.type = 'button';
      plan.className = 'btn-ghost btn-xs';
      plan.dataset.planTask = task.id;
      plan.textContent = 'В чат';
      plan.title = dep.ready ? 'Передать задачу агенту для планирования' : 'Сначала завершите зависимые задачи';
      plan.disabled = !dep.ready;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn-ghost btn-xs';
      remove.dataset.removeTask = task.id;
      remove.textContent = 'Удалить';
      controls.append(status, plan, remove);
      card.append(info, controls);
      const verification = renderVerification(task, checks);
      if (verification) card.append(verification);
      taskList.append(card);
    }
  }

  function render() {
    const state = store.get();
    titleInput.value = state.title;
    visionInput.value = state.vision;
    renderGoals();
    renderTasks();
  }

  function open() {
    render();
    modal.hidden = false;
    titleInput.focus();
  }

  function close() {
    modal.hidden = true;
  }

  function showDraft(value) {
    draft = value;
    previewGoals.replaceChildren();
    previewTasks.replaceChildren();
    for (const goal of value.goals) {
      const chip = document.createElement('span');
      chip.className = 'project-goal';
      chip.textContent = goal;
      previewGoals.append(chip);
    }
    value.tasks.forEach((task, index) => {
      const item = document.createElement('li');
      const dependencyText = task.dependsOn.length ? ` (после задач ${task.dependsOn.map((dep) => dep + 1).join(', ')})` : '';
      item.textContent = `${task.title} — ${PRIORITY_LABELS[task.priority]}${dependencyText}`;
      if (task.description) item.title = task.description;
      previewTasks.append(item);
    });
    preview.hidden = false;
  }

  function discardDraft() {
    draft = null;
    preview.hidden = true;
    previewGoals.replaceChildren();
    previewTasks.replaceChildren();
  }

  async function generateBacklog() {
    saveProject();
    if (!ctx.llm || !ctx.llm.isConfigured()) {
      aiStatus.textContent = 'Сначала выберите модель в «Настройках».';
      return;
    }
    if (!visionInput.value.trim()) {
      aiStatus.textContent = 'Опишите цель проекта, чтобы ИИ мог предложить задачи.';
      visionInput.focus();
      return;
    }
    if (busy) return;
    busy = true;
    generateButton.disabled = true;
    aiStatus.textContent = 'ИИ анализирует описание и дерево проекта…';
    try {
      const files = ctx.fs.list().slice(0, 250).join('\n').slice(0, 9000) || '(проект пока пуст)';
      const messages = [
        {
          role: 'system',
          content: [
            'Ты менеджер программного проекта. Разбей цель на выполнимые инженерные задачи, не создавай код и не выдумывай уже реализованные функции.',
            'Верни только один JSON-объект в блоке ```kaitos-project с полями summary (строка), goals (массив строк, максимум 8), tasks (массив объектов, от 1 до 12).',
            'У каждой задачи обязательны title и description; priority — low, normal или high; dependsOn — массив нумерованных с нуля индексов задач, без циклов.',
            'Порядок задач должен быть практичным: подготовка, реализация, проверка. Текст пиши по-русски, а задачи делай небольшими и проверяемыми.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Проект: ${titleInput.value.trim()}\n\nЦель и контекст:\n${visionInput.value.trim()}\n\nТекущие цели:\n${store.get().goals.join('\n') || '(пока нет)'}\n\nФайлы проекта:\n${files}\n\nСоставь проектный backlog. Учитывай текущую структуру файлов, но не считай наличие файла доказательством, что функция полностью готова.`,
        },
      ];
      const result = await ctx.llm.chat({ messages });
      const parsed = parseBacklog(result);
      showDraft(parsed);
      aiStatus.textContent = parsed.summary || `Предложено целей: ${parsed.goals.length}, задач: ${parsed.tasks.length}. Проверьте черновик.`;
    } catch (error) {
      aiStatus.textContent = error.message || 'Не удалось составить backlog.';
    } finally {
      busy = false;
      generateButton.disabled = false;
    }
  }

  function importDraft() {
    if (!draft) return;
    const ids = draft.tasks.map(() => createProjectId());
    const tasks = draft.tasks.map((task, index) => ({
      id: ids[index],
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: 'todo',
      dependsOn: task.dependsOn.map((dependency) => ids[dependency]),
    }));
    try {
      store.addGoals(draft.goals);
      store.addTasks(tasks);
      discardDraft();
      aiStatus.textContent = 'Backlog добавлен в проект. Отмечайте статус по мере выполнения.';
      renderGoals();
      renderTasks();
    } catch (error) {
      aiStatus.textContent = error.message;
    }
  }

  function sendTaskToChat(id, verification = null) {
    const state = store.get();
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    const dep = dependencyState(task, state.tasks);
    if (!dep.ready) {
      aiStatus.textContent = `Сначала завершите: ${dep.waiting.map((item) => item.title).join(', ')}`;
      return;
    }
    if (!ctx.chat || typeof ctx.chat.planTask !== 'function' || ctx.chat.busy || ctx.chat.planPending) {
      aiStatus.textContent = 'Сначала завершите текущий запрос и выполните или отмените ожидающий план.';
      return;
    }
    store.updateTask(id, { status: 'in_progress' });
    renderTasks();
    close();
    const prompt = [
      `Проект: ${state.title}`,
      `Цель проекта: ${state.vision || '(описание не задано)'}`,
      `Задача: ${task.title}`,
      `Описание: ${task.description || '(нет дополнительного описания)'}`,
      ...(verification ? [
        `Проверка завершилась ошибкой: команда ${verification.command}, код выхода ${verification.code ?? 'нет ответа'}.`,
        `Вывод проверки:\n${String(verification.output || '(пустой вывод)').slice(0, 4000)}`,
        'Исправь проблему в рамках этой задачи. Сначала составь план правок и перечисли только нужные файлы.',
      ] : ['Сначала составь план реализации именно этой задачи и перечисли только необходимые файлы.']),
    ].join('\n\n');
    ctx.chat.planTask(prompt);
  }

  function planTask(id) {
    sendTaskToChat(id);
  }

  function fixFailedCheck(id) {
    const task = store.get().tasks.find((item) => item.id === id);
    if (!task || !task.verification || task.verification.ok) return;
    sendTaskToChat(id, task.verification);
  }

  async function runVerification(id, command) {
    if (execution.taskId !== null) return;
    const task = store.get().tasks.find((item) => item.id === id);
    const approved = availableChecks().find((item) => item.command === command);
    if (!task || task.status !== 'in_progress' || !approved) {
      aiStatus.textContent = 'Выберите проверку из списка package.json.';
      return;
    }
    if (ctx.storage?.mode !== 'disk' || !ctx.api?.run) {
      aiStatus.textContent = 'Для запуска команд подключите локальный сервер Kaitos.';
      return;
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    execution.taskId = id;
    execution.controller = controller;
    renderTasks();
    aiStatus.textContent = `Запускаю ${approved.command}. Команда проекта может выполнять произвольный код — подтверждение дано нажатием кнопки.`;
    const startedAt = Date.now();
    try {
      const result = await ctx.api.run(approved.command, controller ? controller.signal : null);
      const record = {
        command: approved.command,
        ok: result.code === 0 && !result.timedOut,
        code: Number.isInteger(result.code) ? result.code : null,
        output: String(result.output || '').slice(-1600),
        durationMs: Number(result.durationMs) || Date.now() - startedAt,
        at: Date.now(),
      };
      store.updateTask(id, { verification: record });
      aiStatus.textContent = record.ok
        ? `${approved.command}: проверка прошла. Отметьте задачу готовой после просмотра результата.`
        : `${approved.command}: проверка завершилась с ошибкой. Можно передать её агенту для исправления.`;
    } catch (error) {
      const record = {
        command: approved.command,
        ok: false,
        code: null,
        output: error.message || 'Команду не удалось запустить.',
        durationMs: Date.now() - startedAt,
        at: Date.now(),
      };
      store.updateTask(id, { verification: record });
      aiStatus.textContent = record.output;
    } finally {
      execution.taskId = null;
      execution.controller = null;
      renderTasks();
    }
  }

  function stopVerification(id) {
    if (execution.taskId === id && execution.controller) execution.controller.abort();
  }

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close="project"]')) close();
  });
  taskList.addEventListener('change', (event) => {
    const select = event.target.closest('[data-task-status]');
    if (!select) return;
    const state = store.get();
    const task = state.tasks.find((item) => item.id === select.dataset.taskStatus);
    const dep = task && dependencyState(task, state.tasks);
    if (task && select.value !== 'todo' && !dep.ready) {
      select.value = task.status;
      aiStatus.textContent = `Сначала завершите зависимости: ${dep.waiting.map((item) => item.title).join(', ')}`;
      return;
    }
    store.updateTask(select.dataset.taskStatus, { status: select.value });
    renderTasks();
  });
  taskList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-plan-task]');
    if (button) planTask(button.dataset.planTask);
    const runButton = event.target.closest('[data-run-check]');
    if (runButton) {
      const select = runButton.closest('.project-task').querySelector('[data-check-select]');
      if (select) runVerification(runButton.dataset.runCheck, select.value);
    }
    const stopButton = event.target.closest('[data-stop-check]');
    if (stopButton) stopVerification(stopButton.dataset.stopCheck);
    const fixButton = event.target.closest('[data-fix-check]');
    if (fixButton) fixFailedCheck(fixButton.dataset.fixCheck);
    const removeButton = event.target.closest('[data-remove-task]');
    if (removeButton) {
      store.removeTask(removeButton.dataset.removeTask);
      renderTasks();
    }
  });
  taskForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = taskInput.value.trim();
    if (!title) return;
    store.addTasks([{ id: createProjectId(), title, status: 'todo' }]);
    taskInput.value = '';
    renderTasks();
  });
  titleInput.addEventListener('change', saveProject);
  visionInput.addEventListener('change', saveProject);
  generateButton.addEventListener('click', generateBacklog);
  $('#project-import').addEventListener('click', importDraft);
  $('#project-discard').addEventListener('click', discardDraft);
  $('#btn-project').addEventListener('click', open);
  $('#project-close').addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) close();
  });

  render();
  return { store, open, close, generateBacklog, planTask };
}
