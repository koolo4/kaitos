/* Структура планов и подготовка контекста для автономного выполнения. */

import { createFs } from '../js/fs.js';
import { buildImplementationMessages, buildPlanMessages, parsePlan } from '../js/planner.js';
import { reporter } from './reporter.mjs';

const { check, result } = reporter('Планировщик агента');

await check('разбор структурированного плана', () => {
  const plan = parsePlan('План готов.\n```kaitos-plan\n{"title":"Страница приветствия","steps":["Создать разметку","Добавить стили"],"files":["index.html","css/app.css"]}\n```');
  if (plan.title !== 'Страница приветствия') throw new Error(plan.title);
  if (plan.steps.length !== 2 || plan.files.length !== 2) throw new Error(JSON.stringify(plan));
  return `${plan.steps.length} шага, ${plan.files.length} файла`;
});

await check('пустой JSON-объект не считается планом', () => {
  try {
    parsePlan('```kaitos-plan\nnull\n```');
    throw new Error('null принят как план');
  } catch (error) {
    if (error.message === 'null принят как план') throw error;
    return error.message;
  }
});

await check('план отвергает выход за проект и служебные папки', () => {
  for (const path of ['../evil.js', '.git/config', 'node_modules/p.js', '//server/secret', 'src//file.js']) {
    try {
      parsePlan(`\`\`\`kaitos-plan\n${JSON.stringify({ title: 'План', steps: ['Изменить файл'], files: [path] })}\n\`\`\``);
      throw new Error(`путь принят: ${path}`);
    } catch (error) {
      if (error.message === `путь принят: ${path}`) throw error;
      if (!error.message) throw new Error(`нет причины для отказа: ${path}`);
    }
  }
  return 'опасные пути отклоняются';
});

await check('план и исполнение получают дерево и согласованные файлы', () => {
  const fs = createFs({ 'index.html': '<main>old</main>\n', 'css/app.css': 'body {}\n', 'src/unused.js': 'export const x=1;\n' });
  const planMessages = buildPlanMessages({ task: 'Сделай страницу', files: fs.list() });
  if (!planMessages[1].content.includes('src/unused.js')) throw new Error('нет дерева проекта');
  const plan = { title: 'Страница', steps: ['Обновить главную'], files: ['index.html', 'new.js'] };
  const implementation = buildImplementationMessages({ task: 'Сделай страницу', plan, fs });
  const prompt = implementation.map((item) => item.content).join('\n');
  if (!prompt.includes('<main>old</main>')) throw new Error('нет содержимого существующего файла');
  if (!prompt.includes('new.js') || !prompt.includes('нового файла ещё нет')) throw new Error('не описан новый файл');
  if (!prompt.includes('kaitos-write') || !prompt.includes('kaitos-edit')) throw new Error('нет протокола правок');
  return 'контекст плана передан в реализацию';
});

process.exit(result() ? 1 : 0);
