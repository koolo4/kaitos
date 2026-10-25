/*
 * Локальный сервер Kaitos: даёт браузеру доступ к настоящим файлам проекта.
 * Запуск: npm run server (по умолчанию http://127.0.0.1:5178).
 * Только локальный адрес: наружу сервер не смотрит и чужие запросы не принимает.
 */

import http from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFileService } from './files.js';
import { createGit } from './git.js';
import { createRunner } from './run.js';
import { createWatcher } from './watch.js';
import { PathError } from './paths.js';

const PORT = Number(process.env.KAITOS_PORT || 5178);
const HOST = process.env.KAITOS_HOST || '127.0.0.1';
const ROOT = process.env.KAITOS_ROOT || process.cwd();
const TOKEN = process.env.KAITOS_TOKEN || '';
const MAX_BODY = 2 * 1024 * 1024;

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

export function createServer({ root = ROOT, token = TOKEN, watchFiles = true, allowRun = true } = {}) {
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
        const result = await runner.run(body.command);
        send(res, 200, result);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/git/status') {
        send(res, 200, await gitApi.status());
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
      const known = error instanceof PathError || error.name === 'PathError';
      if (!known) console.error('[kaitos] ошибка:', error);
      fail(res, known ? 400 : 500, error.message || 'Внутренняя ошибка сервера');
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
