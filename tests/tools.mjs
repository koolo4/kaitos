/* Проверки инструментов агента: разбор правок, diff, применение из интерфейса, защита путей. */

import { bootApp, reporter, wait } from './harness.mjs';
import { diffLines, diffStats, compactOps, renderDiffHtml } from '../js/diff.js';
import {
  parseEdits,
  parsePatches,
  patchesToEdits,
  patchContent,
  stripEditBlocks,
  normalizeEditPath,
  applyEdits,
} from '../js/tools.js';
import { createFs } from '../js/fs.js';

const { check, result } = reporter('Инструменты агента');

await check('diff находит замену, добавление и удаление', () => {
  const ops = diffLines('one\ntwo\nthree', 'one\nTWO\nthree\nfour');
  const plain = ops.map((op) => `${op.type}:${op.text}`);
  const expected = ['equal:one', 'del:two', 'add:TWO', 'equal:three', 'add:four'];
  if (plain.join('|') !== expected.join('|')) throw new Error(plain.join('|'));
  const stats = diffStats(ops);
  if (stats.added !== 2 || stats.removed !== 1) throw new Error(JSON.stringify(stats));
  return `${stats.added} добавлено, ${stats.removed} удалено`;
});

await check('diff одинаковых файлов пуст', () => {
  const ops = diffLines('a\nb', 'a\nb');
  if (ops.some((op) => op.type !== 'equal')) throw new Error('лишние изменения');
  return true;
});

await check('сжатие diff оставляет контекст', () => {
  const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
  const after = before.replace('line 20', 'changed 20');
  const rows = compactOps(diffLines(before, after), 2);
  const gaps = rows.filter((row) => row.type === 'gap').length;
  if (!gaps) throw new Error('нет сжатия');
  if (rows.length > 12) throw new Error(`слишком длинный diff: ${rows.length}`);
  return `${rows.length} строк, ${gaps} пропуск(ов)`;
});

await check('renderDiffHtml экранирует HTML', () => {
  const html = renderDiffHtml('<script>bad()</script>', '<b>ok</b>');
  if (html.includes('<script>')) throw new Error('HTML не экранирован');
  return true;
});

await check('разбор блока kaitos-write', () => {
  const answer = 'Держи правку:\n\n```kaitos-write src/utils.js\nexport const X = 1;\n```\n';
  const edits = parseEdits(answer);
  if (edits.length !== 1) throw new Error(`найдено ${edits.length}`);
  if (edits[0].path !== 'src/utils.js') throw new Error(edits[0].path);
  if (!edits[0].content.includes('export const X = 1;')) throw new Error('нет содержимого');
  const text = stripEditBlocks(answer);
  if (text.includes('kaitos-write')) throw new Error('служебный блок остался в тексте');
  if (!text.includes('Держи правку')) throw new Error('текст потерялся');
  return `${edits[0].path}: ${edits[0].content.trim()}`;
});

await check('разбор нескольких блоков в одном ответе', () => {
  const answer = '```kaitos-write a.js\nconst a = 1;\n```\nтекст\n```kaitos-write b/c.js\nconst c = 2;\n```\n';
  const edits = parseEdits(answer);
  if (edits.length !== 2) throw new Error(`найдено ${edits.length}`);
  return edits.map((edit) => edit.path).join(', ');
});

await check('защита путей: абсолютные и выход за проект', () => {
  const bad = ['/etc/passwd', '../evil.js', 'src/../../evil.js', 'C:\\Windows\\x.js'];
  for (const path of bad) {
    let blocked = false;
    try {
      normalizeEditPath(path);
    } catch (error) {
      blocked = true;
    }
    if (!blocked) throw new Error(`пропущен путь ${path}`);
  }
  const answer = '```kaitos-write ../../evil.js\nbad\n```\n';
  const edits = parseEdits(answer);
  if (!edits[0].error) throw new Error('правка с плохим путём не помечена');
  return `${bad.length} пути заблокированы`;
});

await check('нормализация пути убирает ./ и обратные слэши', () => {
  const one = normalizeEditPath('./src\\utils.js');
  const two = normalizeEditPath('src/utils.js');
  if (one !== 'src/utils.js' || two !== one) throw new Error(`${one} / ${two}`);
  return one;
});

await check('applyEdits пишет файлы и создаёт новые', () => {
  const files = new Map([['a.js', 'old']]);
  const fs = {
    has: (path) => files.has(path),
    write: (path, content) => files.set(path, content),
  };
  const results = applyEdits(fs, [
    { path: 'a.js', content: 'new\n' },
    { path: 'b.js', content: 'created\n' },
    { path: '', error: 'плохой путь', content: '' },
  ]);
  if (files.get('a.js') !== 'new\n') throw new Error('файл не обновлён');
  if (!files.has('b.js')) throw new Error('файл не создан');
  if (!results[2].applied === false) throw new Error('ошибочная правка применена');
  if (!results[1].created) throw new Error('не отмечено создание файла');
  return `${results.filter((item) => item.applied).length} правки применены`;
});

/* --- интерфейс: карточка правки и применение --- */

await check('ответ модели с правкой показывает diff и кнопку', async () => {
  const { window, doc, K } = await bootApp({ provider: 'ollama', model: 'm', baseUrl: 'http://localhost:11434' });
  K.llm.setMock(async () => 'Улучшил функцию:\n\n```kaitos-write src/utils.js\nexport function greet(name) {\n  return `Привет, ${name}!!`;\n}\n```\n');
  const row = Array.from(doc.querySelectorAll('.tree-row')).find((item) => item.dataset.path === 'src/utils.js');
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  doc.querySelector('#chat-input').value = 'Предложи правку';
  doc.querySelector('#chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(1400);

  const card = doc.querySelector('.edit-card');
  if (!card) throw new Error('карточки правки нет');
  if (!card.querySelector('.diff-row--add')) throw new Error('в diff нет добавленных строк');
  if (!card.querySelector('[data-apply-edit]')) throw new Error('нет кнопки «Применить»');
  if (card.textContent.includes('kaitos-write')) throw new Error('служебный блок попал в текст ответа');
  return card.querySelector('.edit-card__title').textContent;
});

await check('«Применить» записывает файл и обновляет редактор', async () => {
  const { window, doc, K } = await bootApp({ provider: 'ollama', model: 'm', baseUrl: 'http://localhost:11434' });
  K.llm.setMock(async () => '```kaitos-write src/new-file.js\nexport const NEW = true;\n```\n');
  doc.querySelector('#chat-input').value = 'Создай файл';
  doc.querySelector('#chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(1300);

  const apply = doc.querySelector('[data-apply-edit]');
  if (!apply) throw new Error('нет кнопки применения');
  apply.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  if (!K.fs.has('src/new-file.js')) throw new Error('файл не создан');
  if (!K.fs.read('src/new-file.js').includes('NEW = true')) throw new Error('неверное содержимое');
  if (!doc.querySelector('.edit-card--applied')) throw new Error('карточка не помечена как применённая');
  if (K.editor.active === 'src/new-file.js' && !doc.querySelector('#editor-input').value.includes('NEW = true')) {
    throw new Error('редактор показывает старое содержимое');
  }
  return 'файл создан и записан';
});

await check('«Отклонить» не меняет файлы', async () => {
  const { window, doc, K } = await bootApp({ provider: 'ollama', model: 'm', baseUrl: 'http://localhost:11434' });
  const before = K.fs.list().length;
  K.llm.setMock(async () => '```kaitos-write src/rejected.js\nbad\n```\n');
  doc.querySelector('#chat-input').value = 'Правка';
  doc.querySelector('#chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(1200);

  const reject = doc.querySelector('[data-reject-edit]');
  if (!reject) throw new Error('нет кнопки отклонения');
  reject.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  if (K.fs.has('src/rejected.js')) throw new Error('файл всё равно создан');
  if (K.fs.list().length !== before) throw new Error('список файлов изменился');
  if (!doc.querySelector('.edit-card--rejected')) throw new Error('карточка не помечена');
  return true;
});

await check('обновление открытого файла видно в редакторе', async () => {
  const { window, doc, K } = await bootApp({ provider: 'ollama', model: 'm', baseUrl: 'http://localhost:11434' });
  const row = Array.from(doc.querySelectorAll('.tree-row')).find((item) => item.dataset.path === 'README.md');
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const original = doc.querySelector('#editor-input').value;
  if (!original.includes('Kaitos')) throw new Error('файл не открылся');

  K.llm.setMock(async () => '```kaitos-write README.md\n# Новый заголовок\n```\n');
  doc.querySelector('#chat-input').value = 'Перепиши README';
  doc.querySelector('#chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(1200);
  doc.querySelector('[data-apply-edit]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  const value = doc.querySelector('#editor-input').value;
  if (!value.includes('Новый заголовок')) throw new Error(`редактор показывает: ${value.slice(0, 60)}`);
  if (doc.querySelector('#status-dirty').textContent) throw new Error('файл помечен как несохранённый');
  return 'редактор перечитал файл';
});

await check('правка с плохим путём не применяется и объясняет причину', async () => {
  const { window, doc, K } = await bootApp({ provider: 'ollama', model: 'm', baseUrl: 'http://localhost:11434' });
  K.llm.setMock(async () => '```kaitos-write ../outside.js\nbad\n```\n');
  doc.querySelector('#chat-input').value = 'Правка';
  doc.querySelector('#chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(1200);

  const card = doc.querySelector('.edit-card');
  if (!card) throw new Error('карточки нет');
  if (!card.querySelector('.edit-card__error')) throw new Error('нет объяснения ошибки');
  if (card.querySelector('[data-apply-edit]')) throw new Error('кнопка применения у опасной правки');
  if (K.fs.has('outside.js')) throw new Error('файл создан вне проекта');
  return card.querySelector('.edit-card__error').textContent;
});

await check('промпт содержит оба способа правки', async () => {
  const { buildMessages } = await import('../js/prompts.js');
  const messages = buildMessages({ prompt: 'привет', projectName: 'demo' });
  if (!messages[0].content.includes('kaitos-write')) throw new Error('нет kaitos-write в промпте');
  if (!messages[0].content.includes('kaitos-edit')) throw new Error('нет kaitos-edit в промпте');
  if (!messages[0].content.includes('НАЙТИ')) throw new Error('нет описания формата замены');
  return true;
});

/* --- точечные правки --- */

const PATCH = [
  '```kaitos-edit src/utils.js',
  '<<<<<<< НАЙТИ',
  'return `Привет, ${name}!`;',
  '=======',
  'return `Здравствуй, ${name}!`;',
  '>>>>>>> ЗАМЕНИТЬ',
  '```',
].join('\n');

await check('разбор блока kaitos-edit', () => {
  const patches = parsePatches(PATCH);
  if (patches.length !== 1) throw new Error(`патчей ${patches.length}`);
  const [patch] = patches;
  if (patch.path !== 'src/utils.js') throw new Error(patch.path);
  if (patch.error) throw new Error(patch.error);
  if (!patch.find.includes('Привет')) throw new Error(`найти: ${patch.find}`);
  if (!patch.replace.includes('Здравствуй')) throw new Error(`заменить: ${patch.replace}`);
  return `${patch.path}: ${patch.find.trim()} → ${patch.replace.trim()}`;
});

await check('patchContent заменяет единственное вхождение', () => {
  const source = 'export function greet(name) {\n  return `Привет, ${name}!`;\n}\n';
  const result = patchContent(source, 'return `Привет, ${name}!`;', 'return `Здравствуй, ${name}!`;');
  if (!result.includes('Здравствуй')) throw new Error(result);
  if (result.includes('Привет')) throw new Error('старый текст остался');
  if (result.split('\n').length !== source.split('\n').length) throw new Error('число строк изменилось');
  return result.split('\n')[1].trim();
});

await check('patchContent прощает хвостовые пробелы и CRLF', () => {
  const source = 'const a = 1;   \r\nconst b = 2;\r\n';
  const result = patchContent(source, 'const a = 1;\nconst b = 2;', 'const a = 10;\nconst b = 2;');
  if (!result.includes('const a = 10;')) throw new Error(result);
  return 'мягкое совпадение';
});

await check('patchContent отказывает: фрагмент не найден', () => {
  try {
    patchContent('const a = 1;\n', 'const z = 9;', 'const z = 10;');
    throw new Error('правка прошла');
  } catch (error) {
    if (!error.message.includes('не найден')) throw new Error(error.message);
    return 'отказ';
  }
});

await check('patchContent отказывает: несколько вхождений', () => {
  const source = 'x();\nx();\n';
  try {
    patchContent(source, 'x();', 'y();');
    throw new Error('неоднозначная правка прошла');
  } catch (error) {
    if (!error.message.includes('несколько раз')) throw new Error(error.message);
    return 'отказ';
  }
});

await check('патч превращается в правку с новым содержимым', () => {
  const fs = createFs({ 'src/utils.js': 'export const n = 1;\nexport const m = 2;\n' });
  const edits = patchesToEdits(fs, parsePatches('```kaitos-edit src/utils.js\n<<<<<<< НАЙТИ\nconst m = 2;\n=======\nconst m = 20;\n>>>>>>> ЗАМЕНИТЬ\n```'));
  if (edits.length !== 1) throw new Error(`правок ${edits.length}`);
  if (edits[0].error) throw new Error(edits[0].error);
  if (!edits[0].content.includes('const m = 20;')) throw new Error(edits[0].content);
  if (!edits[0].content.includes('const n = 1;')) throw new Error('потерялась первая строка');
  if (edits[0].kind !== 'patch') throw new Error('нет пометки вида');
  return 'готово к применению';
});

await check('патч к несуществующему файлу отклоняется', () => {
  const fs = createFs({ 'a.js': 'x\n' });
  const edits = patchesToEdits(fs, parsePatches('```kaitos-edit b.js\n<<<<<<< НАЙТИ\nx\n=======\ny\n>>>>>>> ЗАМЕНИТЬ\n```'));
  if (!edits[0].error) throw new Error('ошибки нет');
  if (!edits[0].error.includes('не найден')) throw new Error(edits[0].error);
  return edits[0].error;
});

await check('несколько правок одного файла применяются последовательно', () => {
  const fs = createFs({ 'a.js': 'const first = 1;\nconst second = 2;\nconst third = 3;\n' });
  const text = [
    '```kaitos-edit a.js\n<<<<<<< НАЙТИ\nconst first = 1;\n=======\nconst first = 10;\n>>>>>>> ЗАМЕНИТЬ\n```',
    '```kaitos-edit a.js\n<<<<<<< НАЙТИ\nconst third = 3;\n=======\nconst third = 30;\n>>>>>>> ЗАМЕНИТЬ\n```',
  ].join('\n');
  const edits = patchesToEdits(fs, parsePatches(text));
  if (edits.length !== 2) throw new Error(`правок ${edits.length}`);
  for (const edit of edits) if (edit.error) throw new Error(edit.error);
  if (!edits[1].content.includes('const first = 10;')) throw new Error('вторая правка потеряла первую');
  if (!edits[1].content.includes('const third = 30;')) throw new Error('вторая правка не применилась');
  if (!edits[1].content.includes('const second = 2;')) throw new Error('потерялась неизменённая строка');
  return 'обе правки в одном результате';
});

await check('ошибка одной правки не ломает остальные правки файла', () => {
  const fs = createFs({ 'a.js': 'const a = 1;\n' });
  const text = [
    '```kaitos-edit a.js\n<<<<<<< НАЙТИ\nconst zzz = 9;\n=======\nconst zzz = 10;\n>>>>>>> ЗАМЕНИТЬ\n```',
    '```kaitos-edit a.js\n<<<<<<< НАЙТИ\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> ЗАМЕНИТЬ\n```',
  ].join('\n');
  const edits = patchesToEdits(fs, parsePatches(text));
  if (!edits[0].error) throw new Error('первая правка должна была не найтись');
  if (!edits[1].error) throw new Error('вторая правка должна быть пропущена');
  if (!edits[1].error.includes('Пропущено')) throw new Error(edits[1].error);
  return edits[1].error;
});

await check('порядок применения правок не важен', async () => {
  const { window, doc, K } = await bootApp({ provider: 'ollama', model: 'm', baseUrl: 'http://localhost:11434' });
  const original = K.fs.read('src/utils.js');
  if (!original.includes('greet')) throw new Error('нет демо-файла utils.js');

  const answer = [
    'Две правки.',
    '```kaitos-edit src/utils.js\n<<<<<<< НАЙТИ\nreturn `Привет, ${name}!`;\n=======\nreturn `Здравствуй, ${name}!`;\n>>>>>>> ЗАМЕНИТЬ\n```',
    '```kaitos-edit src/utils.js\n<<<<<<< НАЙТИ\nexport function greet(name) {\n=======\nexport function greet(name = \'мир\') {\n>>>>>>> ЗАМЕНИТЬ\n```',
  ].join('\n');
  K.llm.setMock(async () => answer);

  const row = Array.from(doc.querySelectorAll('.tree-row')).find((item) => item.dataset.path === 'src/utils.js');
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  doc.querySelector('#chat-input').value = 'Две правки';
  doc.querySelector('#chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(1400);

  const cards = Array.from(doc.querySelectorAll('.edit-card'));
  if (cards.length !== 2) throw new Error(`карточек ${cards.length}`);

  // нарочно применяем вторую раньше первой
  cards[1].querySelector('[data-apply-edit]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(40);
  cards[0].querySelector('[data-apply-edit]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(40);

  const result = K.fs.read('src/utils.js');
  if (!result.includes('Здравствуй')) throw new Error('первая правка потерялась');
  if (!result.includes("name = 'мир'")) throw new Error('вторая правка потерялась');
  if (!result.includes('export function sum')) throw new Error('файл потерял остальные функции');
  return 'обе правки на месте при обратном порядке';
});

await check('stripEditBlocks убирает и kaitos-edit', () => {
  const text = `До.\n\n${PATCH}\n\nПосле.`;
  const clean = stripEditBlocks(text);
  if (clean.includes('kaitos-edit') || clean.includes('НАЙТИ')) throw new Error(clean);
  if (!clean.includes('До.') || !clean.includes('После.')) throw new Error(clean);
  return clean.replace(/\n+/g, ' ');
});

await check('ответ с точечной правкой показывает diff и кнопки', async () => {
  const { window, doc, K } = await bootApp({ provider: 'ollama', model: 'm', baseUrl: 'http://localhost:11434' });
  K.llm.setMock(async () => `Поменяю приветствие.\n\n${PATCH}\n`);
  const row = Array.from(doc.querySelectorAll('.tree-row')).find((item) => item.dataset.path === 'src/utils.js');
  if (!row) throw new Error('нет src/utils.js в демо-проекте');
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  doc.querySelector('#chat-input').value = 'Замени приветствие';
  doc.querySelector('#chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(1400);

  const card = doc.querySelector('.edit-card');
  if (!card) throw new Error('карточка правки не появилась');
  if (!card.querySelector('.edit-card__diff')) throw new Error('нет diff');
  const apply = card.querySelector('[data-apply-edit]');
  if (!apply) throw new Error('нет кнопки «Применить»');
  apply.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(40);
  const content = K.fs.read('src/utils.js');
  if (!content.includes('Здравствуй')) throw new Error('правка не применена');
  if (content.includes('Привет,')) throw new Error('старый текст остался');
  if (content.split('\n').length < 3) throw new Error('файл потерял строки');
  return 'точечная правка применена';
});

process.exit(result() ? 1 : 0);
