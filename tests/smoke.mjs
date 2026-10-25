/* Сквозные проверки интерфейса в jsdom: дерево, редактор, чат, терминал, настройки, палитра. */

import { bootApp, reporter, wait, click, submit } from './harness.mjs';

const { check, result } = reporter('Интерфейс');
const { window, doc, errors, K } = await bootApp();
const $ = (selector) => doc.querySelector(selector);
const $$ = (selector) => doc.querySelectorAll(selector);

await check('приложение загружено', () => Boolean(K && K.ready));
await check('дерево файлов построено', () => $$('.tree-row').length >= 6);
await check('чат: приветствие', () => $$('.chat-msg').length === 1);
await check('терминал: подсказка', () => $('#terminal-output').textContent.includes('help'));
await check('строка состояния: файл не открыт', () => $('#status-file').textContent === 'файл не открыт');

await check('открытие файла из дерева', () => {
  click(window, Array.from($$('.tree-row')).find((row) => row.dataset.path === 'src/utils.js'));
  if (!$('#editor').classList.contains('is-open')) throw new Error('редактор не открылся');
  if (!$('#editor-input').value.includes('export function greet')) throw new Error('нет текста файла');
  return $('#status-file').textContent;
});

await check('вкладка активна и одна', () => $$('.tab.is-active').length === 1);
await check('нумерация строк', () => $('#line-numbers').textContent.split('\n').length);

await check('подсветка синтаксиса в редакторе', () => {
  const layer = $('#editor-highlight');
  if (!layer) throw new Error('нет слоя подсветки');
  const html = layer.innerHTML;
  if (!html.includes('tok-keyword')) throw new Error('нет ключевых слов');
  if (!html.includes('tok-string')) throw new Error('нет строк');
  if (!html.includes('tok-fn')) throw new Error('нет имён функций');
  if (html.includes('<script')) throw new Error('HTML не экранирован');
  return `${(html.match(/tok-/g) || []).length} подсветок`;
});

await check('подсветка обновляется при вводе', () => {
  const layer = $('#editor-highlight');
  const before = layer.innerHTML.length;
  const input = $('#editor-input');
  input.value += '\n// новый комментарий\nconst added = 1;\n';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const html = layer.innerHTML;
  if (!html.includes('новый комментарий')) throw new Error('текст не попал в слой');
  if (!html.includes('tok-comment')) throw new Error('комментарий не подсвечен');
  if (html.length <= before) throw new Error('слой не вырос');
  return true;
});

await check('подсветка переключается на язык другого файла', () => {
  click(window, Array.from($$('.tree-row')).find((row) => row.dataset.path === 'styles/theme.css'));
  const html = $('#editor-highlight').innerHTML;
  if (!html.includes('tok-selector')) throw new Error('css-селекторы не подсвечены');
  if (!html.includes('tok-prop')) throw new Error('css-свойства не подсвечены');
  click(window, Array.from($$('.tree-row')).find((row) => row.dataset.path === 'src/utils.js'));
  return 'css → js';
});
await check('чип контекста в чате', () => $('#chat-context').textContent === 'src/utils.js');

await check('правка файла помечается как несохранённая', () => {
  const input = $('#editor-input');
  input.value += '\nexport const VERSION = 2;\n';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  if (!$('#status-dirty').textContent.includes('не сохранено')) throw new Error('нет отметки в статусе');
  if ($$('.tab__dot').length !== 1) throw new Error('нет точки на вкладке');
  return $('#status-dirty').textContent;
});

await check('Ctrl+S сохраняет в файловую систему', () => {
  $('#editor-input').dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  if (!K.fs.read('src/utils.js').includes('VERSION = 2')) throw new Error('файл не записан');
  if ($('#status-dirty').textContent !== '') throw new Error('отметка не снята');
  return true;
});

await check('терминал: cat показывает файл', () => {
  $('#terminal-input').value = 'cat src/utils.js';
  submit(window, $('#terminal-form'));
  if (!$('#terminal-output').textContent.includes('export function greet')) throw new Error('нет вывода');
  return true;
});

await check('терминал: ls и неизвестная команда', () => {
  $('#terminal-input').value = 'ls';
  submit(window, $('#terminal-form'));
  $('#terminal-input').value = 'foobar';
  submit(window, $('#terminal-form'));
  const text = $('#terminal-output').textContent;
  return text.includes('src/') && text.includes('команда не найдена');
});

await check('тема переключается в обе стороны', () => {
  click(window, $('#btn-theme'));
  const light = doc.documentElement.dataset.theme === 'light';
  click(window, $('#btn-theme'));
  return light && doc.documentElement.dataset.theme === 'dark';
});

await check('настройки: сохранение модели и шрифта', () => {
  click(window, $('#btn-settings'));
  if ($('#settings-modal').hidden) throw new Error('модалка не открылась');
  $('#settings-provider').value = 'ollama';
  $('#settings-model').value = 'qwen2.5-coder:7b';
  $('#settings-baseurl').value = 'http://localhost:11434';
  $('#settings-fontsize').value = '15';
  $('#settings-temperature').value = '0.3';
  click(window, $('#settings-save'));
  if (!$('#settings-modal').hidden) throw new Error('модалка не закрылась');
  if (!$('#model-chip').textContent.includes('qwen2.5-coder:7b')) throw new Error('чип модели не обновился');
  if (doc.documentElement.style.getPropertyValue('--code-size') !== '15px') throw new Error('шрифт не применился');
  const saved = JSON.parse(window.localStorage.getItem('kaitos.settings.v1'));
  if (saved.temperature !== 0.3) throw new Error('температура не сохранена');
  return saved.model;
});

await check('Esc закрывает настройки', () => {
  click(window, $('#btn-settings'));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return $('#settings-modal').hidden;
});

await check('палитра: Ctrl+K и переход к файлу', () => {
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  if ($('#palette').hidden) throw new Error('палитра не открылась');
  const input = $('#palette-input');
  input.value = 'README';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  click(window, $('.palette__item'));
  if (K.editor.active !== 'README.md') throw new Error(`открыт ${K.editor.active}`);
  return K.editor.active;
});

await check('палитра закрывается по Esc', () => {
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return $('#palette').hidden;
});

await check('панели сворачиваются и возвращаются', () => {
  click(window, $('#btn-terminal-toggle'));
  click(window, $('#btn-sidebar-toggle'));
  const collapsed = $('#main-area').classList.contains('is-terminal-collapsed')
    && $('#app').classList.contains('sidebar-collapsed');
  click(window, $('#btn-terminal-toggle'));
  click(window, $('#btn-sidebar-toggle'));
  return collapsed && !$('#app').classList.contains('sidebar-collapsed');
});

await check('вкладка закрывается', () => {
  const before = $$('.tab').length;
  click(window, $('.tab .tab__close'));
  return $$('.tab').length === before - 1;
});

await check('демо-ответ чата упоминает открытый файл', async () => {
  K.updateSettings({ provider: 'none', model: '', baseUrl: '', apiKey: '' });
  click(window, Array.from($$('.tree-row')).find((row) => row.dataset.path === 'README.md'));
  $('#chat-input').value = 'Объясни этот файл';
  submit(window, $('#chat-form'));
  await wait(700);
  const texts = Array.from($$('.chat-msg__text')).map((node) => node.textContent);
  if (!texts.some((text) => text.includes('README.md'))) throw new Error('ответ без контекста файла');
  return texts[texts.length - 1].slice(0, 50);
});

await check('ошибок в консоли нет', () => {
  if (errors.length) throw new Error(errors.join(' | '));
  return true;
});

process.exit(result() ? 1 : 0);
