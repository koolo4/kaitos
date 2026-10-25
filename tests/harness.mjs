/* Общий каркас тестов: собирает приложение esbuild-ом и поднимает его в jsdom. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function bundleApp() {
  const result = await build({
    entryPoints: [join(ROOT, 'js/app.js')],
    bundle: true,
    write: false,
    format: 'iife',
    logLevel: 'error',
  });
  return result.outputFiles[0].text;
}

export function appHtml() {
  return readFileSync(join(ROOT, 'index.html'), 'utf8')
    .replace('<script type="module" src="js/app.js"></script>', '');
}

export async function bootApp(settings = {}, options = {}) {
  const [code, html] = [await bundleApp(), appHtml()];
  const dom = new JSDOM(html, { url: 'http://localhost:5173/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', (event) => errors.push(String(event.error || event.message)));
  if (!window.HTMLElement.prototype.scrollIntoView) window.HTMLElement.prototype.scrollIntoView = () => {};
  // jsdom не реализует TextDecoder/TextEncoder, а клиент модели читает ими поток
  if (!window.TextDecoder) window.TextDecoder = globalThis.TextDecoder;
  if (!window.TextEncoder) window.TextEncoder = globalThis.TextEncoder;
  if (Object.keys(settings).length) {
    window.localStorage.setItem('kaitos.settings.v1', JSON.stringify(settings));
  }
  if (options.fetchMock) window.fetch = options.fetchMock;
  window.eval(code);
  const K = window.Kaitos;
  // boot асинхронный: ждём события готовности (проверка локального сервера файлов)
  await new Promise((resolve) => {
    if (K && K.ready) {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    window.addEventListener('kaitos:ready', done, { once: true });
    setTimeout(done, 1500);
  });
  return { window, doc: window.document, errors, K };
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function reporter(title) {
  const state = { failed: 0, passed: 0 };
  console.log(`\n=== ${title} ===`);
  return {
    async check(name, fn) {
      try {
        const value = await fn();
        if (value === false) throw new Error('вернуло false');
        state.passed += 1;
        console.log('✓', name, value === true || value === undefined ? '' : `→ ${JSON.stringify(value).slice(0, 110)}`);
      } catch (error) {
        state.failed += 1;
        console.log('✗', name, '—', error.message);
      }
    },
    result() {
      console.log(`--- ${title}: ${state.passed} прошло, ${state.failed} провалено`);
      return state.failed;
    },
  };
}

export function click(window, node) {
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

export function submit(window, form) {
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}
