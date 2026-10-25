/* Проверки подсветки синтаксиса: языки, экранирование, устойчивость к странному вводу. */

import { reporter } from './harness.mjs';
import { highlight, detectLanguage, escapeCode } from '../js/highlight.js';

const { check, result } = reporter('Подсветка синтаксиса');

await check('js: ключевые слова, строки, комментарии, функции', () => {
  const html = highlight('const x = greet("мир"); // привет\nfunction greet(n) { return n; }', 'js');
  if (!html.includes('tok-keyword')) throw new Error('нет ключевых слов');
  if (!html.includes('tok-string')) throw new Error('нет строк');
  if (!html.includes('tok-comment')) throw new Error('нет комментария');
  if (!html.includes('tok-fn')) throw new Error('нет функции');
  return `${(html.match(/<span/g) || []).length} подсветок`;
});

await check('js: числа и многострочный комментарий', () => {
  const html = highlight('const n = 42;\n/* блок\nкомментарий */\nlet m = 3.14;', 'js');
  const numbers = (html.match(/tok-number/g) || []).length;
  const comments = (html.match(/tok-comment/g) || []).length;
  if (numbers !== 2) throw new Error(`числа: ${numbers}`);
  if (comments !== 1) throw new Error(`комментарии: ${comments}`);
  return `${numbers} числа, ${comments} комментарий`;
});

await check('css: селекторы, свойства, значения', () => {
  const html = highlight('.box { color: red; margin: 0 auto; }', 'css');
  if (!html.includes('tok-selector')) throw new Error('нет селектора');
  if (!html.includes('tok-prop')) throw new Error('нет свойства');
  if (!html.includes('tok-value')) throw new Error('нет значения');
  return true;
});

await check('html: теги, атрибуты, строки', () => {
  const html = highlight('<div class="box" data-id=\'1\'>текст</div>', 'html');
  if (!html.includes('tok-tag')) throw new Error('нет тегов');
  if (!html.includes('tok-attr')) throw new Error('нет атрибутов');
  if (!html.includes('tok-string')) throw new Error('нет значений атрибутов');
  return true;
});

await check('json: ключи, строки, числа, литералы', () => {
  const html = highlight('{"a": 1, "b": "текст", "c": true, "d": null}', 'json');
  if (!html.includes('tok-prop')) throw new Error('нет ключей');
  if (!html.includes('tok-number')) throw new Error('нет чисел');
  if (!html.includes('tok-keyword')) throw new Error('нет литералов');
  return true;
});

await check('markdown: заголовки и списки', () => {
  const html = highlight('# Заголовок\n- пункт\n> цитата', 'md');
  if (!html.includes('tok-keyword')) throw new Error('нет заголовка');
  if (!html.includes('tok-prop')) throw new Error('нет списка');
  if (!html.includes('tok-comment')) throw new Error('нет цитаты');
  return true;
});

await check('текст без языка не ломается', () => {
  const html = highlight('просто текст <b>и теги</b>', 'text');
  if (html.includes('<b>')) throw new Error('HTML не экранирован');
  if (!html.includes('&lt;b&gt;')) throw new Error('неверное экранирование');
  return true;
});

await check('экранирование: скрипт в коде не исполняется', () => {
  const samples = [
    '<script>alert(1)</script>',
    'const s = "<img src=x onerror=alert(1)>";',
    '// </span><script>bad()</script>',
    'a < b && c > d',
  ];
  for (const sample of samples) {
    for (const lang of ['js', 'css', 'html', 'json', 'md', 'sh', 'text']) {
      const html = highlight(sample, lang);
      if (/<script/i.test(html)) throw new Error(`скрипт прошёл в ${lang}: ${sample}`);
      if (/<img/i.test(html)) throw new Error(`img прошёл в ${lang}: ${sample}`);
    }
  }
  return `${samples.length} образца × 7 языков`;
});

await check('незакрытые конструкции не роняют подсветку', () => {
  const samples = ['const s = "не закрыта', '/* комментарий без конца', '`шаблон ${', '.a { color: ', '<div class="x"'];
  for (const sample of samples) {
    for (const lang of ['js', 'css', 'html']) {
      const html = highlight(sample, lang);
      if (typeof html !== 'string') throw new Error('не строка');
    }
  }
  return `${samples.length} обрывков`;
});

await check('большой файл подсвечивается быстро', () => {
  const big = Array.from({ length: 400 }, (_, i) => `function f${i}(a) { return a + ${i}; } // шаг ${i}`).join('\n');
  const started = Date.now();
  const html = highlight(big, 'js');
  const elapsed = Date.now() - started;
  if (!html.includes('tok-keyword')) throw new Error('нет подсветки');
  if (elapsed > 1500) throw new Error(`слишком медленно: ${elapsed} мс`);
  return `${(big.length / 1024).toFixed(0)} КБ за ${elapsed} мс`;
});

await check('определение языка по имени файла', () => {
  const cases = {
    'src/app.js': 'js',
    'main.ts': 'js',
    'style.css': 'css',
    'index.html': 'html',
    'package.json': 'json',
    'README.md': 'md',
    'run.sh': 'sh',
    'notes.txt': 'text',
  };
  for (const [path, expected] of Object.entries(cases)) {
    const actual = detectLanguage(path);
    if (actual !== expected) throw new Error(`${path}: ${actual} вместо ${expected}`);
  }
  return `${Object.keys(cases).length} имён файлов`;
});

await check('escapeCode экранирует пять символов', () => {
  if (escapeCode('& < > " \'') !== '&amp; &lt; &gt; &quot; &#39;') throw new Error(escapeCode('& < > " \''));
  return true;
});

await check('пустой ввод безопасен', () => {
  for (const value of ['', null, undefined]) {
    const html = highlight(value, 'js');
    if (html !== '') throw new Error(`для ${value} вернулось «${html}»`);
  }
  return true;
});

process.exit(result() ? 1 : 0);
