/* Локальное хранилище целей и задач проекта. Ключ привязан к корню проекта, но сам путь не сохраняется. */

const STATUSES = new Set(['todo', 'in_progress', 'done', 'blocked']);
const PRIORITIES = new Set(['low', 'normal', 'high']);
const MAX_TASKS = 200;
const MAX_GOALS = 30;
const MAX_TASK_ATTEMPTS = 3;

function hashKey(value) {
  let hash = 2166136261;
  for (const char of String(value || 'project')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createProjectId(prefix = 'task') {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

function cleanText(value, limit) {
  return String(value ?? '').trim().slice(0, limit);
}

function normalizeTask(task = {}) {
  const id = cleanText(task.id, 120) || createProjectId();
  const dependsOn = Array.isArray(task.dependsOn)
    ? [...new Set(task.dependsOn.map((id) => cleanText(id, 120)).filter((id) => id && id !== task.id))].slice(0, 20)
    : [];
  return {
    id,
    title: cleanText(task.title, 180) || 'Новая задача',
    description: cleanText(task.description, 2000),
    status: STATUSES.has(task.status) ? task.status : 'todo',
    priority: PRIORITIES.has(task.priority) ? task.priority : 'normal',
    dependsOn,
    attempts: Math.max(0, Math.min(MAX_TASK_ATTEMPTS, Math.floor(Number(task.attempts) || 0))),
    verification: task.verification && typeof task.verification === 'object'
      ? {
        command: cleanText(task.verification.command, 180),
        ok: Boolean(task.verification.ok),
        code: Number.isInteger(task.verification.code) ? task.verification.code : null,
        output: cleanText(task.verification.output, 1600),
        durationMs: Math.max(0, Number(task.verification.durationMs) || 0),
        at: Number(task.verification.at) || Date.now(),
      }
      : null,
    createdAt: Number(task.createdAt) || Date.now(),
  };
}

function normalizeState(value, projectName) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const tasks = Array.isArray(source.tasks) ? source.tasks.slice(0, MAX_TASKS).map(normalizeTask) : [];
  const taskIds = new Set(tasks.map((task) => task.id));
  for (const task of tasks) task.dependsOn = task.dependsOn.filter((id) => taskIds.has(id));
  return {
    version: 1,
    title: cleanText(source.title, 120) || cleanText(projectName, 120) || 'Новый проект',
    vision: cleanText(source.vision, 4000),
    goals: Array.isArray(source.goals)
      ? [...new Set(source.goals.map((goal) => cleanText(goal, 240)).filter(Boolean))].slice(0, MAX_GOALS)
      : [],
    tasks,
    updatedAt: Number(source.updatedAt) || Date.now(),
  };
}

export function createProjectStore({ root = '', name = 'project', storage = null } = {}) {
  const identity = String(root || name || 'project');
  const key = `kaitos.project.v1.${hashKey(identity)}`;
  let backend = storage;
  try {
    if (!backend) backend = globalThis.localStorage;
  } catch (error) {
    backend = null;
  }
  let state;

  function fresh() {
    return normalizeState({}, name);
  }

  function load() {
    try {
      const raw = backend?.getItem(key);
      state = raw ? normalizeState(JSON.parse(raw), name) : fresh();
    } catch (error) {
      state = fresh();
    }
    return clone(state);
  }

  function save(next = state) {
    state = normalizeState({ ...next, updatedAt: Date.now() }, name);
    try {
      backend?.setItem(key, JSON.stringify(state));
    } catch (error) {
      // Режим чтения/изменения остаётся доступен, даже если браузер запретил localStorage.
    }
    return clone(state);
  }

  function get() {
    return clone(state || load());
  }

  function update(patch) {
    return save({ ...get(), ...patch });
  }

  function addGoals(goals) {
    const current = get();
    return update({ goals: [...current.goals, ...(Array.isArray(goals) ? goals : [])] });
  }

  function addTasks(tasks) {
    const current = get();
    const incoming = Array.isArray(tasks) ? tasks : [];
    if (current.tasks.length + incoming.length > MAX_TASKS) throw new Error(`Нельзя хранить больше ${MAX_TASKS} задач`);
    return update({ tasks: [...current.tasks, ...incoming] });
  }

  function updateTask(id, patch) {
    const current = get();
    if (!current.tasks.some((task) => task.id === id)) return current;
    return update({ tasks: current.tasks.map((task) => task.id === id ? normalizeTask({ ...task, ...patch, id }) : task) });
  }

  function removeTask(id) {
    const current = get();
    return update({
      tasks: current.tasks
        .filter((task) => task.id !== id)
        .map((task) => ({ ...task, dependsOn: task.dependsOn.filter((dependency) => dependency !== id) })),
    });
  }

  load();
  return { key, get, load, save, update, addGoals, addTasks, updateTask, removeTask };
}

export const PROJECT_LIMITS = { MAX_TASKS, MAX_GOALS, MAX_TASK_ATTEMPTS };
