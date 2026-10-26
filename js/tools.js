/*
 * Инструменты агента: разбор предложенных моделью правок файлов.
 *
 * Два протокола в ответе модели:
 *
 *   1) новый файл или полная перезапись:
 *      ```kaitos-write src/utils.js
 *      <полное новое содержимое файла>
 *      ```
 *
 *   2) точечная правка — найти и заменить (для мелких изменений это надёжнее,
 *      потому что модель не переписывает весь файл и не портит соседние строки):
 *      ```kaitos-edit src/utils.js
 *      <<<<<<< НАЙТИ
 *      старый текст
 *      =======
 *      новый текст
 *      >>>>>>> ЗАМЕНИТЬ
 *      ```
 *
 * Правка не применяется сама: интерфейс показывает diff и ждёт нажатия «Применить».
 */

export const WRITE_FENCE = /```kaitos-write[ \t]+([^\n`]+)\n([\s\S]*?)```/g;
export const EDIT_FENCE = /```kaitos-edit[ \t]+([^\n`]+)\n([\s\S]*?)```/g;

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

/* Разбирает блок «найти и заменить». Возвращает список патчей. */
export function parsePatches(text) {
  const source = String(text ?? '');
  const patches = [];
  EDIT_FENCE.lastIndex = 0;
  let match = EDIT_FENCE.exec(source);
  while (match) {
    const rawPath = match[1].trim();
    const body = match[2];
    let path = '';
    let error = '';
    try {
      path = normalizeEditPath(rawPath);
    } catch (problem) {
      error = problem.message;
    }
    const parts = splitPatch(body);
    if (!error && (!parts.find.length || !parts.replace.length)) {
      error = 'В блоке kaitos-edit нужны обе части: «НАЙТИ» и «ЗАМЕНИТЬ»';
    }
    patches.push({ path, rawPath, find: parts.find, replace: parts.replace, error, raw: match[0] });
    match = EDIT_FENCE.exec(source);
  }
  return patches;
}

function splitPatch(body) {
  const text = String(body ?? '').replace(/\r\n/g, '\n');
  const marker = /^<<<<<<<[^\n]*$/m.exec(text);
  const middle = /^=======$/m.exec(text);
  const end = /^>>>>>>>[^\n]*$/m.exec(text);
  if (!marker || !middle || !end) {
    return { find: '', replace: '' };
  }
  const afterStart = marker.index + marker[0].length;
  return {
    find: text.slice(afterStart, middle.index).replace(/^\n/, '').replace(/\n$/, ''),
    replace: text.slice(middle.index + middle[0].length, end.index).replace(/^\n/, '').replace(/\n$/, ''),
  };
}

/*
 * Заменяет фрагмент в тексте. Требует, чтобы фрагмент встречался ровно один раз:
 * иначе непонятно, какое место править, и правку лучше отклонить.
 */
export function patchContent(source, find, replace) {
  const text = String(source ?? '');
  const needle = String(find ?? '');
  if (!needle) throw new EditError('Пустой фрагмент «НАЙТИ»');

  const first = text.indexOf(needle);
  if (first !== -1) {
    if (text.indexOf(needle, first + needle.length) !== -1) {
      throw new EditError('Фрагмент «НАЙТИ» встречается несколько раз — добавьте соседние строки для однозначности');
    }
    return text.slice(0, first) + String(replace ?? '') + text.slice(first + needle.length);
  }

  // Мягкий вариант: разница в переводах строк и хвостовых пробелах
  const normalize = (value) =>
    value
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/, ''))
      .join('\n');
  const haystack = normalize(text);
  const compact = normalize(needle);
  const found = haystack.indexOf(compact);
  if (found !== -1 && haystack.indexOf(compact, found + compact.length) === -1) {
    // переводим позицию обратно в исходный текст по строкам
    const before = haystack.slice(0, found).split('\n').length - 1;
    const count = compact.split('\n').length;
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const result = [
      ...lines.slice(0, before),
      ...String(replace ?? '').split('\n'),
      ...lines.slice(before + count),
    ].join('\n');
    return result;
  }

  throw new EditError('Фрагмент «НАЙТИ» не найден в файле — текст должен совпадать с файлом посимвольно');
}

/* Превращает патчи в обычные правки: с готовым новым содержимым файла. */
export function patchesToEdits(fs, patches) {
  /*
   * Несколько правок одного файла в одном ответе применяются последовательно:
   * каждая следующая считается от результата предыдущей. Иначе вторая правка не нашла бы
   * свой фрагмент, если первая уже изменила соседнюю строку.
   */
  const working = new Map();
  const rejected = new Set(); // файл уже получил ошибку — остальные правки к нему не применяем

  return patches.map((patch) => {
    if (patch.error) return { ...patch, content: '', kind: 'patch' };
    if (!fs.has(patch.path) && !working.has(patch.path)) {
      return { ...patch, content: '', error: `Файл не найден: ${patch.path}`, kind: 'patch' };
    }
    if (rejected.has(patch.path)) {
      return { ...patch, content: '', error: 'Пропущено: предыдущая правка этого файла не применилась', kind: 'patch' };
    }
    try {
      const before = working.has(patch.path) ? working.get(patch.path) : fs.read(patch.path);
      const content = patchContent(before, patch.find, patch.replace);
      working.set(patch.path, content);
      return { ...patch, content, kind: 'patch' };
    } catch (error) {
      rejected.add(patch.path);
      return { ...patch, content: '', error: error.message, kind: 'patch' };
    }
  });
}

/* Текст ответа без служебных блоков — его показываем как обычный ответ. */
export function stripEditBlocks(text) {
  return String(text ?? '')
    .replace(WRITE_FENCE, '')
    .replace(EDIT_FENCE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
