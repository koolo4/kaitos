/*
 * Живой тест: приложение подключается к настоящему серверу файлов и работает с диском.
 * Требует запущенных `npm run server` и `npm run dev`. Если сервер не отвечает — набор пропускается.
 */

import { bootApp, reporter } from './harness.mjs';

const APP = process.env.KAITOS_APP || 'http://localhost:5173';

// Набор недетерминирован: нужен запущенный сервер файлов. В общий прогон включается по флагу,
// иначе — только при явном запуске `npm run test:live`.
if (!process.env.KAITOS_LIVE && process.env.npm_lifecycle_event !== 'test:live') {
  console.log('\n⏭  живой набор: запустите npm run test:live при работающих npm run server и npm run dev');
  process.exit(0);
}
const { check, result } = reporter('Живой сервер');

async function serverUp() {
  try {
    const response = await fetch(new URL('/api/health', APP), { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch (error) {
    return false;
  }
}

if (!(await serverUp())) {
  console.log('\n⏭  сервер файлов не запущен — набор пропущен (нужны npm run server и npm run dev)');
  process.exit(0);
}

const fetchToApp = (url, options) => fetch(new URL(String(url), APP), options);

await check('приложение видит локальный сервер', async () => {
  const { doc, K } = await bootApp({}, { fetchMock: fetchToApp });
  if (!K.storage || K.storage.mode !== 'disk') throw new Error(`режим: ${K.storage && K.storage.mode}`);
  const chip = doc.querySelector('#status-storage');
  return `${chip.textContent}, файлов ${K.storage.files}`;
});

await check('дерево показывает файлы проекта с диска', async () => {
  const { doc, K } = await bootApp({}, { fetchMock: fetchToApp });
  const rows = Array.from(doc.querySelectorAll('.tree-row')).map((row) => row.dataset.path);
  const expected = ['index.html', 'js/llm.js', 'server/index.js'];
  for (const path of expected) {
    if (!rows.includes(path)) throw new Error(`нет ${path} в дереве (${rows.length} строк)`);
  }
  if (!K.fs.read('package.json').includes('"name": "kaitos"')) throw new Error('package.json не прочитан с диска');
  return `${rows.length} элементов дерева`;
});

await check('реальный файл читается и подсвечивается', async () => {
  const { window, doc, K } = await bootApp({}, { fetchMock: fetchToApp });
  const row = Array.from(doc.querySelectorAll('.tree-row')).find((item) => item.dataset.path === 'server/paths.js');
  if (!row) throw new Error('нет server/paths.js');
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  if (!doc.querySelector('#editor-input').value.includes('resolveInside')) throw new Error('файл не открылся');
  if (!doc.querySelector('#editor-highlight').innerHTML.includes('tok-keyword')) throw new Error('нет подсветки');
  return K.editor.active;
});

await check('запись файла доходит до диска и откатывается', async () => {
  const { window, doc, K } = await bootApp({}, { fetchMock: fetchToApp });
  const path = 'docs/LIVE-TEST.md';
  const original = K.fs.has(path) ? K.fs.read(path) : null;
  K.fs.write(path, '# живой тест\n');
  await K.fs.flush();
  const onDisk = await (await fetch(new URL(`/api/file?path=${encodeURIComponent(path)}`, APP))).json();
  if (!onDisk.content.includes('живой тест')) throw new Error('файл не записался на диск');
  K.fs.remove(path);
  await K.fs.flush();
  const after = await fetch(new URL(`/api/file?path=${encodeURIComponent(path)}`, APP));
  if (after.status !== 400) throw new Error(`файл не удалён (статус ${after.status})`);
  void window;
  void doc;
  void original;
  return 'записан и удалён';
});

await check('правка на диске сама появляется в приложении', async () => {
  const path = 'docs/LIVE-WATCH.md';
  const { doc, K } = await bootApp({}, { fetchMock: fetchToApp });
  // создаём файл мимо приложения — как это сделал бы другой редактор
  await fetch(new URL('/api/file', APP), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content: '# привет из другого редактора\n' }),
  });
  const started = Date.now();
  let seen = false;
  while (Date.now() - started < 6000) {
    if (K.fs.has(path)) {
      seen = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!seen) throw new Error('файл не появился в приложении');
  if (!K.fs.read(path).includes('другого редактора')) throw new Error('содержимое не подхватилось');
  if (!doc.querySelector(`.tree-row[data-path="${path}"]`)) throw new Error('дерево не обновилось');
  await fetch(new URL(`/api/file?path=${encodeURIComponent(path)}`, APP), { method: 'DELETE' });
  return `${Math.round((Date.now() - started) / 100) / 10} с`;
});

process.exit(result() ? 1 : 0);
