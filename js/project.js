/* Проектный менеджер: долговременный контекст, backlog с ИИ и статус задач. */

import { createProjectId, createProjectStore } from './project-store.js';

const STATUS_LABELS = { todo: 'К выполнению', in_progress: 'В работе', done: 'Готово', blocked: 'Блокер' };
const PRIORITY_LABELS = { low: 'низкий приоритет', normal: 'обычный приоритет', high: 'высокий приоритет' };
const STATUS_ORDER = ['todo', 'in_progress', 'done', 'blocked'];
const BACKLOG_FENCE = /```kaitos-project\s*\n([\s\S]*?)```/i;
const MAX_GENERATED_TASKS = 12;

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

  function renderTasks() {
    const state = store.get();
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

  function planTask(id) {
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
      'Сначала составь план реализации именно этой задачи и перечисли только необходимые файлы.',
    ].join('\n\n');
    if (ctx.chat && typeof ctx.chat.planTask === 'function') ctx.chat.planTask(prompt);
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
