/* Проверки инструментов агента: разбор правок, diff, применение из интерфейса, защита путей. */

import { bootApp, reporter, wait } from './harness.mjs';
import { diffLines, diffStats, compactOps, renderDiffHtml } from '../js/diff.js';
import { parseEdits, stripEditBlocks, normalizeEditPath, applyEdits } from '../js/tools.js';

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

await check('промпт содержит протокол правок', async () => {
  const { buildMessages } = await import('../js/prompts.js');
  const messages = buildMessages({ prompt: 'привет', projectName: 'demo' });
  if (!messages[0].content.includes('kaitos-write')) throw new Error('протокол не описан в системном промпте');
  return true;
});

process.exit(result() ? 1 : 0);
