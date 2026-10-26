/* Проверки хранилища проекта и работы менеджера задач через интерфейс. */

import { createProjectStore } from '../js/project-store.js';
import { parseBacklog } from '../js/project.js';
import { bootApp, reporter, wait, click } from './harness.mjs';

const { check, result } = reporter('Управление проектом');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

await check('проект сохраняется отдельно по корню и загружается повторно', () => {
  const storage = memoryStorage();
  const first = createProjectStore({ root: '/work/one', name: 'demo', storage });
  first.update({ title: 'Мой проект', vision: 'Автоматизировать заказы' });
  first.addGoals(['Сократить ручной ввод']);
  first.addTasks([{ id: 'task-1', title: 'Схема данных' }]);
  const restored = createProjectStore({ root: '/work/one', name: 'demo', storage });
  const isolated = createProjectStore({ root: '/work/two', name: 'demo', storage });
  if (restored.get().title !== 'Мой проект' || restored.get().tasks.length !== 1) throw new Error('данные не восстановлены');
  if (isolated.get().title === 'Мой проект' || isolated.get().tasks.length) throw new Error('корни проектов смешались');
  if (storage.values.get(restored.key).includes('/work/one')) throw new Error('путь к проекту сохранён открытым текстом');
  return 'данные пережили повторное создание store и изолированы по проекту';
});

await check('удаление задачи очищает зависимости, статусы ограничены схемой', () => {
  const storage = memoryStorage();
  const store = createProjectStore({ root: '/work/tasks', storage });
  store.addTasks([
    { id: 'base', title: 'Основа', status: 'made-up' },
    { id: 'next', title: 'Продолжение', dependsOn: ['base'] },
  ]);
  if (store.get().tasks[0].status !== 'todo') throw new Error('неизвестный статус не нормализован');
  store.removeTask('base');
  if (store.get().tasks.length !== 1 || store.get().tasks[0].dependsOn.length) throw new Error('зависимость осталась');
  return 'задачи нормализованы, ссылка на удалённую очищена';
});

await check('парсер backlog отклоняет циклические и вне-диапазонные зависимости', () => {
  const cyclic = '```kaitos-project\n{"tasks":[{"title":"A","dependsOn":[1]},{"title":"B","dependsOn":[0]}]}\n```';
  const invalid = '```kaitos-project\n{"tasks":[{"title":"A","dependsOn":[2]}]}\n```';
  for (const text of [cyclic, invalid]) {
    try {
      parseBacklog(text);
      throw new Error('невалидный backlog принят');
    } catch (error) {
      if (error.message === 'невалидный backlog принят') throw error;
      if (!error.message.includes('зависимост')) throw error;
    }
  }
  return 'циклы и ссылки на отсутствующие задачи блокируются';
});

await check('ИИ предлагает backlog, пользователь подтверждает, зависимости управляют доступом', async () => {
  const settings = { provider: 'ollama', model: 'qwen3.5:9b', baseUrl: 'http://localhost:11434', temperature: 0.2, maxTokens: 2048 };
  const { window, doc, K, errors } = await bootApp(settings);
  let calls = 0;
  const backlog = '```kaitos-project\n{"summary":"MVP сервиса заказов","goals":["Создать каталог","Оформить заказ"],"tasks":[{"title":"Создать каталог услуг","description":"Показать доступные услуги","priority":"high","dependsOn":[]},{"title":"Добавить оформление заказа","description":"Сохранить заказ пользователя","priority":"normal","dependsOn":[0]}]}\n```';
  const plan = '```kaitos-plan\n{"title":"Реализация задачи","steps":["Подготовить интерфейс"],"files":["src/main.js"]}\n```';
  K.llm.setMock(async () => (++calls === 1 ? backlog : plan));

  click(window, doc.querySelector('#btn-project'));
  doc.querySelector('#project-title').value = 'Сервис заказов';
  doc.querySelector('#project-vision').value = 'Помогать клиентам выбирать услуги и оформлять заказы.';
  click(window, doc.querySelector('#project-generate'));
  await wait(500);
  if (doc.querySelector('#project-preview').hidden) throw new Error('не показан черновик backlog');
  if (K.project.store.get().tasks.length) throw new Error('backlog добавлен до подтверждения');

  click(window, doc.querySelector('#project-import'));
  const taskCards = doc.querySelectorAll('.project-task');
  if (taskCards.length !== 2) throw new Error(`ожидалось 2 задачи, получено ${taskCards.length}`);
  const child = taskCards[1];
  if (!child.querySelector('[data-plan-task]').disabled) throw new Error('зависимая задача доступна раньше времени');
  const firstStatus = taskCards[0].querySelector('[data-task-status]');
  firstStatus.value = 'done';
  firstStatus.dispatchEvent(new window.Event('change', { bubbles: true }));
  const readyChild = doc.querySelectorAll('.project-task')[1];
  if (readyChild.querySelector('[data-plan-task]').disabled) throw new Error('зависимость не разблокировалась');

  click(window, readyChild.querySelector('[data-plan-task]'));
  await wait(500);
  if (!doc.querySelector('.plan-card')) throw new Error('задача не передана в чат для планирования');
  if (K.project.store.get().tasks[1].status !== 'in_progress') throw new Error('задача не помечена как выполняемая');
  if (K.project.store.get().title !== 'Сервис заказов') throw new Error('контекст проекта не сохранён');
  if (calls !== 2) throw new Error(`неожиданное число запросов к модели: ${calls}`);
  if (errors.length) throw new Error(errors.join('; '));
  return 'backlog подтверждён, зависимость учтена, задача отправлена агенту';
});

process.exit(result() ? 1 : 0);
