/*
 * Локальный сервер Kaitos: даёт браузеру доступ к настоящим файлам проекта.
 * Запуск: npm run server (по умолчанию http://127.0.0.1:5178).
 * Только локальный адрес: наружу сервер не смотрит и чужие запросы не принимает.
 */

import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFileService } from './files.js';
import { createGit, GitError } from './git.js';
import { createRunner } from './run.js';
import { createWatcher } from './watch.js';
import { PathError } from './paths.js';

const PORT = Number(process.env.KAITOS_PORT || 5178);
const HOST = process.env.KAITOS_HOST || '127.0.0.1';
const ROOT = process.env.KAITOS_ROOT || process.cwd();
const TOKEN = process.env.KAITOS_TOKEN || '';
const MAX_BODY = 2 * 1024 * 1024;
const MAX_SEARCH_QUERY = 500;
const MAX_SEARCH_RESULTS = 5;
const MAX_SEARCH_HTML = 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const SCREENSHOT_TIMEOUT_MS = 20_000;

class ServiceError extends Error {
  constructor(message, statusCode = 500, code = 'service') {
    super(message);
    this.name = 'ServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function decodeHtml(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : ' '; } catch (error) { return ' '; }
    }
    return named[entity.toLowerCase()] || ' ';
  });
}

function textFromHtml(value, limit) {
  return decodeHtml(String(value || '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function safeResultUrl(value) {
  try {
    const decoded = decodeHtml(value).trim();
    const url = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded, 'https://html.duckduckgo.com');
    if (url.hostname === 'duckduckgo.com' && url.pathname === '/l/') {
      const target = url.searchParams.get('uddg');
      if (target) return safeResultUrl(target);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.href;
  } catch (error) {
    return '';
  }
}

export function parseSearchResults(html) {
  const source = String(html || '').slice(0, MAX_SEARCH_HTML);
  const results = [];
  const anchors = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = anchors.exec(source)) && results.length < MAX_SEARCH_RESULTS) {
    if (!/\bclass\s*=\s*["'][^"']*\bresult__a\b[^"']*["']/i.test(match[1])) continue;
    const href = match[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
    const url = safeResultUrl(href);
    const title = textFromHtml(match[2], 240);
    if (!url || !title) continue;
    const tail = source.slice(anchors.lastIndex, anchors.lastIndex + 3000);
    const snippetMatch = tail.match(/<([a-z0-9]+)\b([^>]*\bclass\s*=\s*["'][^"']*\bresult__snippet\b[^"']*["'][^>]*)>([\s\S]*?)<\/\1\s*>/i);
    const snippet = snippetMatch ? textFromHtml(snippetMatch[3], 600) : '';
    results.push({ title, url, snippet });
  }
  return results;
}

function searchDuckDuckGo(query, { signal = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL('https://html.duckduckgo.com/html/');
    url.searchParams.set('q', query);
    let settled = false;
    let size = 0;
    const chunks = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value);
    };
    const request = https.get(url, {
      headers: { 'User-Agent': 'Kaitos/0.1 local search', Accept: 'text/html' },
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        finish(new ServiceError(`Поиск вернул HTTP ${response.statusCode || 'ошибку'}.`, 502, 'search-provider'));
        return;
      }
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_SEARCH_HTML) {
          request.destroy();
          finish(new ServiceError('Ответ поиска больше 1 МиБ.', 502, 'search-provider'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
      response.on('error', (error) => finish(new ServiceError(`Не удалось прочитать ответ поиска: ${error.message}`, 502, 'search-provider')));
    });
    const timer = setTimeout(() => {
      request.destroy();
      finish(new ServiceError('Поиск не ответил за 10 секунд.', 504, 'search-timeout'));
    }, 10_000);
    const abort = () => {
      request.destroy();
      finish(new ServiceError('Поиск отменён.', 499, 'aborted'));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    request.on('error', (error) => finish(new ServiceError(`Не удалось выполнить поиск: ${error.message}`, 502, 'search-provider')));
  });
}

function localScreenshotUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch (error) { return false; }
  return url.protocol === 'http:' && !url.username && !url.password && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
}

function pngDimensions(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature) || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new ServiceError('Браузер вернул не PNG-изображение.', 502, 'invalid-image');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function findBrowser() {
  const configured = String(process.env.KAITOS_BROWSER_PATH || '').trim();
  const windows = process.platform === 'win32';
  const candidates = configured ? [configured] : windows ? [
    join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ] : [
    '/usr/bin/google-chrome', '/usr/bin/microsoft-edge', '/opt/google/chrome/chrome',
  ];
  return candidates.find((path) => path && existsSync(path)) || '';
}

function terminateBrowser(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { child.kill('SIGKILL'); }
}

function execBrowser(browser, args, { signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ServiceError('Снимок экрана отменён.', 499, 'aborted'));
      return;
    }
    let timedOut = false;
    let timer = null;
    let abort = null;
    const child = execFile(browser, args, { windowsHide: true, detached: process.platform !== 'win32', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      if (error) {
        if (signal?.aborted) reject(new ServiceError('Снимок экрана отменён.', 499, 'aborted'));
        else if (timedOut) reject(new ServiceError('Браузер не завершил снимок за 20 секунд.', 504, 'screenshot-timeout'));
        else reject(new ServiceError(`Не удалось снять экран в браузере: ${String(stderr || error.message).slice(0, 500)}`, 502, 'screenshot-failed'));
        return;
      }
      resolve({ stdout, stderr });
    });
    abort = () => terminateBrowser(child);
    timer = setTimeout(() => {
      timedOut = true;
      terminateBrowser(child);
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function captureLocalScreenshot({ url, width, height, signal = null }) {
  const browser = findBrowser();
  if (!browser) throw new ServiceError('Не найден Microsoft Edge или Google Chrome. Установите один из браузеров; Kaitos ничего не скачивает.', 503, 'browser-not-found');
  const directory = await mkdtemp(join(tmpdir(), 'kaitos-screenshot-'));
  const imagePath = join(directory, 'capture.png');
  try {
    const args = [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-background-networking', `--user-data-dir=${join(directory, 'profile')}`,
      '--force-device-scale-factor=1', `--window-size=${width},${height}`, `--screenshot=${imagePath}`,
      ...(process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage']),
      url,
    ];
    await execBrowser(browser, args, { signal, timeoutMs: SCREENSHOT_TIMEOUT_MS });
    let info;
    try { info = await stat(imagePath); } catch (error) {
      throw new ServiceError('Браузер завершился, но не создал PNG-снимок.', 502, 'screenshot-failed');
    }
    if (info.size > MAX_SCREENSHOT_BYTES) throw new ServiceError('Снимок экрана больше 5 МиБ.', 413, 'image-too-large');
    const image = await readFile(imagePath);
    const dimensions = pngDimensions(image);
    if (dimensions.width < 320 || dimensions.width > 1920 || dimensions.height < 240 || dimensions.height > 1200) {
      throw new ServiceError('Размер PNG-снимка вышел за допустимый диапазон.', 502, 'invalid-image-size');
    }
    return { image, ...dimensions };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Kaitos-Token',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, JSON_HEADERS);
  res.end(body);
}

function fail(res, status, message) {
  send(res, status, { ok: false, error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new PathError('Тело запроса больше 2 МБ'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new PathError('Тело запроса — не JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createServer({
  root = ROOT,
  token = TOKEN,
  watchFiles = true,
  allowRun = true,
  searchProvider = searchDuckDuckGo,
  screenshotCapture = captureLocalScreenshot,
} = {}) {
  const files = createFileService(root);
  const gitApi = createGit({ root });
  const runner = allowRun ? createRunner({ root }) : null;
  const watcher = watchFiles ? createWatcher({ root }).start() : null;
  const requiredToken = String(token || '');

  function authorized(req, url) {
    if (!requiredToken) return true;
    const header = req.headers['x-kaitos-token'];
    const query = url.searchParams.get('token');
    return header === requiredToken || query === requiredToken;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, JSON_HEADERS);
      res.end();
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      fail(res, 404, 'Только /api/… — интерфейс открывается через Vite (npm run dev)');
      return;
    }

    if (!authorized(req, url)) {
      fail(res, 401, 'Неверный или отсутствующий токен (X-Kaitos-Token)');
      return;
    }

    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        /*
         * health — это проверка связи, а не инспекция проекта: он отвечает 200 всегда,
         * даже если обход файлов споткнулся. Иначе приложение уходит в демо-режим из-за
         * одного недоступного каталога.
         */
        try {
          const list = await files.list();
          send(res, 200, { ok: true, root: files.root, files: list.length, version: 1 });
        } catch (error) {
          send(res, 200, {
            ok: true,
            root: files.root,
            files: 0,
            version: 1,
            warning: `Не удалось прочитать список файлов: ${error.message}`,
          });
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/search') {
        const query = String(url.searchParams.get('q') || '').trim();
        if (!query) {
          fail(res, 400, 'Нужно указать поисковый запрос q.');
          return;
        }
        if (query.length > MAX_SEARCH_QUERY) {
          fail(res, 400, `Поисковый запрос не должен быть длиннее ${MAX_SEARCH_QUERY} символов.`);
          return;
        }
        const controller = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) controller.abort();
        });
        const html = await searchProvider(query, { signal: controller.signal });
        if (!res.destroyed) send(res, 200, { ok: true, query, results: parseSearchResults(html) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/browser/screenshot') {
        const body = await readBody(req);
        const target = String(body.url || '').trim();
        const width = Number(body.width);
        const height = Number(body.height);
        if (!localScreenshotUrl(target)) {
          fail(res, 400, 'Снимок разрешён только для HTTP-страниц localhost, 127.0.0.1 или [::1].');
          return;
        }
        if (!Number.isInteger(width) || width < 320 || width > 1920 || !Number.isInteger(height) || height < 240 || height > 1200) {
          fail(res, 400, 'Размер снимка должен быть в диапазоне 320–1920 × 240–1200 пикселей.');
          return;
        }
        const controller = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) controller.abort();
        });
        const captured = await screenshotCapture({ url: target, width, height, signal: controller.signal });
        const image = Buffer.isBuffer(captured) ? captured : Buffer.from(captured?.image || captured?.png || []);
        if (!image.length) throw new ServiceError('Браузер не вернул снимок экрана.', 502, 'invalid-image');
        if (image.length > MAX_SCREENSHOT_BYTES) throw new ServiceError('Снимок экрана больше 5 МиБ.', 413, 'image-too-large');
        const dimensions = pngDimensions(image);
        if (!res.destroyed) send(res, 200, {
          ok: true,
          imageBase64: image.toString('base64'),
          mimeType: 'image/png',
          width: dimensions.width,
          height: dimensions.height,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/changes') {
        const since = Number(url.searchParams.get('since') || 0);
        if (!watcher) {
          send(res, 200, { ok: true, seq: since, changes: [], watching: false });
          return;
        }
        const batch = watcher.drain(since);
        send(res, 200, { ok: true, watching: watcher.running, ...batch });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/files') {
        const list = await files.list(url.searchParams.get('dir') || '.');
        send(res, 200, { ok: true, files: list });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/run') {
        if (!runner) {
          fail(res, 400, 'Запуск команд выключен (allowRun: false)');
          return;
        }
        const body = await readBody(req);
        if (typeof body.command !== 'string' || !body.command.trim()) {
          fail(res, 400, 'Нужно поле command (непустая строка)');
          return;
        }
        const controller = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) controller.abort();
        });
        const result = await runner.run(body.command, { signal: controller.signal });
        if (!res.destroyed) send(res, 200, result);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/git/status') {
        send(res, 200, await gitApi.status());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/git/branches') {
        send(res, 200, await gitApi.branches());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/git/compare') {
        send(res, 200, await gitApi.compare(url.searchParams.get('branch')));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/git/checkout') {
        const body = await readBody(req);
        if (typeof body.branch !== 'string') {
          fail(res, 400, 'Нужно поле branch (строка)');
          return;
        }
        send(res, 200, await gitApi.checkout(body.branch));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/git/diff') {
        const path = url.searchParams.get('path');
        if (path) files.guard.resolveInside(path); // проверка пути до вызова git
        send(res, 200, await gitApi.diff(path || ''));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/git/log') {
        send(res, 200, await gitApi.log(Number(url.searchParams.get('limit') || 10)));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/git/commit') {
        const body = await readBody(req);
        send(res, 200, await gitApi.commit(body.message));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/file') {
        const path = url.searchParams.get('path');
        if (!path) {
          fail(res, 400, 'Нужен параметр path');
          return;
        }
        const content = await files.read(path);
        send(res, 200, { ok: true, path, content });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/file') {
        const body = await readBody(req);
        if (!body.path) {
          fail(res, 400, 'Нужно поле path');
          return;
        }
        if (typeof body.content !== 'string') {
          fail(res, 400, 'Нужно поле content (строка)');
          return;
        }
        const result = await files.write(body.path, body.content);
        send(res, 200, { ok: true, ...result });
        return;
      }

      if (req.method === 'DELETE' && url.pathname === '/api/file') {
        const path = url.searchParams.get('path');
        if (!path) {
          fail(res, 400, 'Нужен параметр path');
          return;
        }
        const result = await files.remove(path);
        send(res, 200, { ok: true, ...result });
        return;
      }

      fail(res, 404, `Неизвестный маршрут: ${req.method} ${url.pathname}`);
    } catch (error) {
      const knownPath = error instanceof PathError || error.name === 'PathError';
      const knownGit = error instanceof GitError || error.name === 'GitError';
      const knownService = error instanceof ServiceError || error.name === 'ServiceError';
      if (!knownPath && !knownGit && !knownService) console.error('[kaitos] ошибка:', error);
      fail(res, knownPath ? 400 : knownGit || knownService ? error.statusCode || 400 : 500, error.message || 'Внутренняя ошибка сервера');
    }
  });

  server.on('close', () => {
    if (watcher) watcher.close();
  });

  return server;
}

/*
 * Запуск из командной строки.
 * Сравниваем абсолютные пути: на Windows в argv[1] обратные слэши, и проверка
 * `endsWith('server/index.js')` там всегда ложна — сервер молча не стартовал.
 */
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const server = createServer();
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Порт ${PORT} занят: возможно, сервер уже запущен. Другой порт: KAITOS_PORT=5179 npm run server`);
      process.exit(1);
    }
    throw error;
  });
  server.listen(PORT, HOST, () => {
    console.log(`Kaitos server: http://${HOST}:${server.address().port}`);
    console.log(`Проект:       ${ROOT}`);
    console.log(`Токен:        ${TOKEN ? 'задан через KAITOS_TOKEN' : 'не требуется (только локально)'}`);
    console.log('Слежение:     включено (правки других программ подхватываются)');
    console.log('Остановить:   Ctrl+C');
  });
}
