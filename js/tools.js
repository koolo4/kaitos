/*
 * Инструменты агента: разбор предложенных моделью правок файлов.
 *
 * Протокол в ответе модели — блок кода с языком kaitos-write и путём:
 *
 *   ```kaitos-write src/utils.js
 *   <полное новое содержимое файла>
 *   ```
 *
 * Правка не применяется сама: интерфейс показывает diff и ждёт нажатия «Применить».
 */

export const WRITE_FENCE = /```kaitos-write[ \t]+([^\n`]+)\n([\s\S]*?)```/g;

export class EditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EditError';
  }
}

/* Путь должен быть относительным, без выхода за пределы проекта. */
export function normalizeEditPath(raw) {
  const value = String(raw || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!value) throw new EditError('Не указан путь файла');
  if (value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)) throw new EditError(`Абсолютный путь запрещён: ${value}`);
  if (value.split(/[\\/]/).includes('..')) throw new EditError(`Выход за пределы проекта запрещён: ${value}`);
  if (value.length > 240) throw new EditError('Слишком длинный путь');
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

/* Возвращает список правок: путь, новое содержимое, исходный блок. */
export function parseEdits(text) {
  const source = String(text ?? '');
  const edits = [];
  WRITE_FENCE.lastIndex = 0;
  let match = WRITE_FENCE.exec(source);
  while (match) {
    const rawPath = match[1].trim();
    let path = '';
    let error = '';
    try {
      path = normalizeEditPath(rawPath);
    } catch (problem) {
      error = problem.message;
    }
    const content = match[2].replace(/\s+$/, '\n');
    edits.push({ path, rawPath, content, error, raw: match[0] });
    match = WRITE_FENCE.exec(source);
  }
  return edits;
}

/* Применяет правки к файловой системе. Возвращает отчёт по каждой. */
export function applyEdits(fs, edits) {
  const results = [];
  for (const edit of edits) {
    if (edit.error) {
      results.push({ ...edit, applied: false, reason: edit.error });
      continue;
    }
    try {
      const existed = fs.has(edit.path);
      fs.write(edit.path, edit.content);
      results.push({ ...edit, applied: true, created: !existed });
    } catch (error) {
      results.push({ ...edit, applied: false, reason: error.message });
    }
  }
  return results;
}

/* Текст ответа без служебных блоков — его показываем как обычный ответ. */
export function stripEditBlocks(text) {
  return String(text ?? '').replace(WRITE_FENCE, '').replace(/\n{3,}/g, '\n\n').trim();
}
