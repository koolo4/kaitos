/*
 * Промпты и сборка контекста для модели.
 * Задача — дать небольшой модели ровно то, что нужно: роль, файл, выделение, историю и вопрос.
 */

export const EDIT_PROTOCOL = [
  'Если нужно изменить файл, после объяснения добавь блок с языком kaitos-write и путём файла:',
  '```kaitos-write путь/к/файлу',
  'полное новое содержимое файла',
  '```',
  'В таком блоке всегда полное содержимое файла, а не фрагмент и не многоточие.',
  'Путь только относительный, внутри проекта. Не больше одной правки на ответ без просьбы.',
].join('\n');

export const SYSTEM_PROMPT = [
  'Ты — Kaitos, ассистент внутри редактора кода.',
  'Отвечай по-русски, коротко и по делу.',
  'Если показываешь код — используй блок ``` с названием языка.',
  'Не выдумывай файлы и функции: опирайся только на код в контексте.',
  'Если данных не хватает — скажи, какой файл нужно открыть.',
].join(' ');

export const MAX_CONTEXT_CHARS = 12000;
export const MAX_HISTORY_MESSAGES = 12;

/* Обрезает длинный текст по границе строки, чтобы не рвать код посередине. */
export function trimContext(text, limit = MAX_CONTEXT_CHARS) {
  const value = String(text ?? '');
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastBreak = cut.lastIndexOf('\n');
  return `${lastBreak > limit * 0.6 ? cut.slice(0, lastBreak) : cut}\n… (файл обрезан, показаны первые ${limit} символов)`;
}

export function fileContext(file) {
  if (!file || !file.path) return '';
  const header = `Открытый файл: ${file.path}`;
  const selection = file.selection && file.selection.trim()
    ? `\n\nВыделенный фрагмент:\n\`\`\`\n${trimContext(file.selection, 2000)}\n\`\`\``
    : '';
  const body = file.content
    ? `\n\nСодержимое файла:\n\`\`\`\n${trimContext(file.content)}\n\`\`\``
    : '';
  return `${header}${body}${selection}`;
}

export function buildMessages({ prompt, history = [], file = null, projectName = 'demo' }) {
  const messages = [
    { role: 'system', content: `${SYSTEM_PROMPT}\nПроект: ${projectName}.\n\n${EDIT_PROTOCOL}` },
  ];

  const context = fileContext(file);
  if (context) messages.push({ role: 'system', content: context });

  const recent = history.slice(-MAX_HISTORY_MESSAGES);
  for (const item of recent) {
    if (!item || !item.text) continue;
    messages.push({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.text });
  }

  messages.push({ role: 'user', content: String(prompt || '').trim() });
  return messages;
}

/* Короткое описание запроса для истории и отладки. */
export function summarize(messages, limit = 200) {
  const last = messages[messages.length - 1];
  const text = last ? `${last.role}: ${last.content}` : '';
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
