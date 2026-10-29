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

await check('проект запускает одобренный npm-скрипт и передаёт сбой агенту', async () => {
  const settings = { provider: 'ollama', model: 'qwen3.5:9b', baseUrl: 'http://localhost:11434' };
  const { window, doc, K } = await bootApp(settings);
  K.fs.write('package.json', JSON.stringify({ scripts: { pretest: 'echo before', test: 'node tests/fake.js', posttest: 'echo after', build: 'vite build', lint: 'eslint .', arbitrary: 'rm -rf .' } }));
  K.storage.mode = 'disk';
  const task = { id: 'verify-task', title: 'Проверить сборку', status: 'in_progress' };
  K.project.store.addTasks([task]);
  const commands = [];
  K.api.run = async (command) => {
    commands.push(command);
    return command === 'npm test'
      ? { code: 1, output: 'FAKE TEST FAILURE: assertion failed', durationMs: 17, timedOut: false }
      : { code: 0, output: 'build passed', durationMs: 23, timedOut: false };
  };
  let repairPrompt = '';
  K.llm.setMock(async ({ messages }) => {
    repairPrompt = messages.map((message) => message.content).join('\n');
    return '```kaitos-plan\n{"title":"Исправление теста","steps":["Исправить причину ошибки"],"files":["src/main.js"]}\n```';
  });

  click(window, doc.querySelector('#btn-project'));
  let card = doc.querySelector('.project-task');
  let select = card.querySelector('[data-check-select]');
  if (select.options.length !== 3) throw new Error('не отфильтрованы npm-скрипты');
  if (!select.options[0].textContent.includes('pretest') || !select.options[0].textContent.includes('posttest')) {
    throw new Error('скрытые npm lifecycle-скрипты не показаны');
  }
  select.value = 'npm test';
  click(window, card.querySelector('[data-run-check]'));
  await wait(100);
  if (K.project.store.get().tasks[0].verification.ok) throw new Error('ошибка теста записана как успех');
  click(window, doc.querySelector('[data-fix-check]'));
  await wait(500);
  if (!repairPrompt.includes('FAKE TEST FAILURE')) throw new Error('вывод проверки не передан модели');
  if (!doc.querySelector('.plan-card')) throw new Error('агент не предложил план исправления');

  click(window, doc.querySelector('#btn-project'));
  card = doc.querySelector('.project-task');
  select = card.querySelector('[data-check-select]');
  select.value = 'npm run build';
  click(window, card.querySelector('[data-run-check]'));
  await wait(100);
  if (!K.project.store.get().tasks[0].verification.ok) throw new Error('успешная проверка не сохранена');
  K.project.store.addTasks([{ id: 'stop-task', title: 'Остановка проверки', status: 'in_progress' }]);
  K.api.run = async (command, signal) => {
    commands.push(command);
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Команда остановлена')), { once: true }));
  };
  click(window, doc.querySelector('#project-close'));
  click(window, doc.querySelector('#btn-project'));
  const stopCard = Array.from(doc.querySelectorAll('.project-task')).find((item) => item.dataset.taskId === 'stop-task');
  const stopSelect = stopCard.querySelector('[data-check-select]');
  stopSelect.value = 'npm run lint';
  click(window, stopCard.querySelector('[data-run-check]'));
  await wait(20);
  click(window, doc.querySelector('[data-stop-check="stop-task"]'));
  await wait(20);
  const stopped = K.project.store.get().tasks.find((item) => item.id === 'stop-task');
  if (!stopped.verification.output.includes('Команда остановлена')) throw new Error('остановка не попала в результат');
  if (commands.join(',') !== 'npm test,npm run build,npm run lint') throw new Error(`запущены лишние команды: ${commands.join(',')}`);
  return 'команды требуют явного запуска, сохраняются результаты и сбои; остановка работает';
});

await check('цикл реализации ограничен тремя попытками на задачу', async () => {
  const settings = { provider: 'ollama', model: 'qwen3.5:9b', baseUrl: 'http://localhost:11434' };
  const { window, doc, K } = await bootApp(settings);
  let calls = 0;
  K.llm.setMock(async () => {
    calls += 1;
    return '```kaitos-plan\n{"title":"Ограниченный план","steps":["Проверить задачу"],"files":["src/main.js"]}\n```';
  });
  K.project.store.addTasks([{ id: 'bounded', title: 'Задача с лимитом' }]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    click(window, doc.querySelector('#btn-project'));
    const button = doc.querySelector('[data-plan-task="bounded"]');
    if (!button || button.disabled) throw new Error(`попытка ${attempt + 1} недоступна`);
    click(window, button);
    await wait(300);
    const cancel = doc.querySelector('[data-cancel-plan]');
    if (!cancel) throw new Error(`план ${attempt + 1} не появился`);
    click(window, cancel);
    await wait(20);
  }
  click(window, doc.querySelector('#btn-project'));
  const limited = doc.querySelector('[data-plan-task="bounded"]');
  if (!limited.disabled || !limited.textContent.includes('исчерпан')) throw new Error('лимит не показан в интерфейсе');
  K.project.planTask('bounded');
  await wait(30);
  if (calls !== 3 || K.project.store.get().tasks[0].attempts !== 3) throw new Error(`лишний цикл: calls=${calls}, attempts=${K.project.store.get().tasks[0].attempts}`);
  if (!doc.querySelector('#project-activity-list').textContent.includes('цикл 3/3')) throw new Error('журнал не записал цикл');
  click(window, doc.querySelector('#project-report'));
  if (doc.querySelector('#project-report-output').hidden) throw new Error('отчёт не показан');
  return 'три подтверждаемых цикла, четвёртый заблокирован; журнал и отчёт доступны';
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
