/*
 * Клиент локального сервера Kaitos (server/index.js).
 * По умолчанию ходит на /api — Vite проксирует запросы на http://127.0.0.1:5178.
 */

export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

export function createApi({ baseUrl = '/api', token = '', timeoutMs = 4000 } = {}) {
  const base = trimSlash(baseUrl || '/api');

  async function request(path, { method = 'GET', body = null, timeout = timeoutMs } = {}) {
    const headers = {};
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (token) headers['X-Kaitos-Token'] = token;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;

    let response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw new ApiError('timeout', `Сервер не ответил за ${timeout} мс`);
      throw new ApiError('network', 'Локальный сервер недоступен');
    } finally {
      if (timer) clearTimeout(timer);
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      const message = payload && payload.error ? payload.error : `Сервер ответил ${response.status}`;
      throw new ApiError(response.status === 401 ? 'auth' : 'http', message, response.status);
    }
    if (payload && payload.ok === false) {
      throw new ApiError('api', payload.error || 'Ошибка сервера');
    }
    return payload || {};
  }

  return {
    baseUrl: base,
    health: () => request('/health', { timeout: 2500 }),
    listFiles: (dir = '.') => request(`/files?dir=${encodeURIComponent(dir)}`),
    readFile: (path) => request(`/file?path=${encodeURIComponent(path)}`),
    writeFile: (path, content) => request('/file', { method: 'POST', body: { path, content } }),
    removeFile: (path) => request(`/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
    /* Изменения файлов на диске после отметки since. */
    changes: (since = 0) => request(`/changes?since=${encodeURIComponent(since)}`, { timeout: 2500 }),
    request,
  };
}
