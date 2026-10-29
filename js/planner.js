/* Планирование задачи и подготовка контекста для одного автономного шага реализации. */

import { EDIT_PROTOCOL, SYSTEM_PROMPT, MAX_CONTEXT_CHARS } from './prompts.js';
import { normalizeEditPath } from './tools.js';

const PLAN_FENCE = /```kaitos-plan\s*\n([\s\S]*?)```/i;
const MAX_PLAN_FILES = 8;
const MAX_TREE_CHARS = 7000;
const MAX_PLAN_SOURCE_CHARS = 12000;

export class PlanError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlanError';
  }
}

export function parsePlan(text) {
  const source = String(text ?? '');
  const match = PLAN_FENCE.exec(source);
  if (!match) throw new PlanError('Модель не вернула план в формате kaitos-plan. Попробуйте сформулировать задачу точнее.');

  let value;
  try {
    value = JSON.parse(match[1]);
  } catch (error) {
    throw new PlanError('План получен, но его JSON повреждён. Запросите план ещё раз.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlanError('План должен быть JSON-объектом с названием, шагами и файлами.');
  }

  const title = String(value.title || '').trim();
  const steps = Array.isArray(value.steps) ? value.steps.map((step) => String(step || '').trim()).filter(Boolean) : [];
  const files = Array.isArray(value.files) ? value.files.map((path) => {
    try {
      const normalized = normalizeEditPath(path);
      const segments = normalized.split('/');
      if (normalized.startsWith('/') || segments.some((segment) => !segment || segment === '.')) {
        throw new PlanError(`Недопустимый путь: ${normalized}`);
      }
      if (segments.some((segment) => ['.git', '.justai', 'node_modules'].includes(segment))) {
        throw new PlanError(`Служебная папка недоступна: ${normalized}`);
      }
      return normalized;
    } catch (error) {
      throw new PlanError(error.message);
    }
  }) : [];

  if (!title || title.length > 160) throw new PlanError('В плане нужно короткое название задачи.');
  if (steps.length < 1 || steps.length > 8) throw new PlanError('План должен содержать от 1 до 8 шагов.');
  if (files.length < 1 || files.length > MAX_PLAN_FILES) {
    throw new PlanError(`Укажите в плане от 1 до ${MAX_PLAN_FILES} файлов для изменения.`);
  }
  if (new Set(files).size !== files.length) throw new PlanError('В плане повторяется путь файла.');
  return { title, steps, files };
}

function treeText(files) {
  const names = Array.isArray(files) ? files : [];
  const text = names.slice(0, 300).join('\n');
  const suffix = names.length > 300 ? `\n… ещё ${names.length - 300} файлов` : '';
  return `${text.slice(0, MAX_TREE_CHARS)}${suffix}` || '(проект пока пуст)';
}

function fileText(fs, path, budget) {
  if (!fs.has(path)) return `[${path}] — нового файла ещё нет.`;
  let content = '';
  try {
    content = fs.read(path);
  } catch (error) {
    return `[${path}] — не удалось прочитать: ${error.message}`;
  }
  if (content.length > budget) {
    content = `${content.slice(0, budget)}\n… файл сокращён для контекста`;
  }
  return `[Файл: ${path}]\n\`\`\`\n${content}\n\`\`\``;
}

export function buildPlanMessages({ task, files = [], activeFile = null }) {
  const selected = activeFile && activeFile.path
    ? `\n\nТекущий файл редактора: ${activeFile.path}\n\`\`\`\n${String(activeFile.content || '').slice(0, 3000)}\n\`\`\``
    : '';
  return [
    {
      role: 'system',
      content: [
        SYSTEM_PROMPT,
        'Ты планировщик автономного программного агента. Пока только планируй — не пиши код и не предлагай патчи.',
        'Составь короткий выполнимый план на русском языке: от 1 до 8 конкретных шагов.',
        'Укажи от 1 до 8 относительных путей файлов, которые нужно создать или изменить.',
        'Путь должен находиться внутри проекта. Не предлагай абсолютные пути, .., .git, .justai или node_modules.',
        'Верни JSON строго в блоке ```kaitos-plan с полями title (строка), steps (массив строк), files (массив путей).',
        'Не добавляй комментарии внутрь JSON и не используй другие блоки инструментов.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Задача пользователя:\n${String(task || '').trim()}\n\nФайлы проекта:\n${treeText(files)}${selected}`,
    },
  ];
}

export function buildImplementationMessages({ task, plan, fs }) {
  const sections = [];
  let budget = MAX_PLAN_SOURCE_CHARS;
  for (const path of plan.files) {
    const content = fileText(fs, path, Math.max(0, Math.min(4000, budget)));
    budget -= content.length;
    sections.push(content);
  }

  const workspace = treeText(fs.list());
  const planText = plan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
  return [
    {
      role: 'system',
      content: [
        SYSTEM_PROMPT,
        'Ты реализуешь согласованный план автономно. Не задавай уточняющих вопросов.',
        'В ответе кратко подведи итог и выдай правки всех нужных файлов в форматах kaitos-edit или kaitos-write.',
        'Для существующих файлов предпочитай точечный kaitos-edit; для новых — kaitos-write с полным содержимым.',
        'Работай только с перечисленными в плане файлами и не запускай команды.',
        EDIT_PROTOCOL,
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: [
        `Задача пользователя:\n${String(task || '').trim()}`,
        `Согласованный план:\n${planText}`,
        `Файлы плана:\n${plan.files.join('\n')}`,
        `Файлы проекта:\n${workspace}`,
        `Исходное содержимое запланированных файлов:\n${sections.join('\n\n')}`,
        'Выполни план целиком и верни применимые блоки правок для всех затронутых файлов.',
      ].join('\n\n'),
    },
  ];
}

export const PLAN_LIMITS = { MAX_PLAN_FILES, MAX_TREE_CHARS, MAX_PLAN_SOURCE_CHARS, MAX_CONTEXT_CHARS };
