/*
 * Клиент нейросети: Ollama (локально) и OpenAI-совместимые API.
 * Умеет потоковые ответы, отмену запроса, проверку соединения и подмену ответа для тестов.
 */

export const PROVIDERS = {
  none: {
    id: 'none',
    label: 'Без модели',
    defaultBaseUrl: '',
    defaultModel: '',
    hint: 'Ассистент отвечает демо-текстом. Выберите провайдера в настройках.',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (локально)',
    defaultBaseUrl: 'http://localhost:11434',
    defaultModel: 'qwen3.5:9b',
    hint: 'Запустите Ollama и разрешите браузеру обращаться к ней: переменная OLLAMA_ORIGINS=*',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI-совместимый API',
    defaultBaseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-4o-mini',
    hint: 'Нужен адрес API и ключ. Ключ хранится только в браузере.',
  },
};

export class LlmError extends Error {
  constructor(code, message, detail = '') {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.detail = detail;
  }
}

function trimSlash(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

export function resolveConfig(settings = {}) {
  const provider = PROVIDERS[settings.provider] ? settings.provider : 'none';
  const meta = PROVIDERS[provider];
  const baseUrl = trimSlash(settings.baseUrl || meta.defaultBaseUrl);
  const model = String(settings.model || meta.defaultModel || '').trim();
  return {
    provider,
    meta,
    baseUrl,
    model,
    apiKey: String(settings.apiKey || '').trim(),
    temperature: Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.2,
    maxTokens: Number(settings.maxTokens) > 0 ? Number(settings.maxTokens) : 2048,
  };
}

export function isConfigured(settings = {}) {
  const config = resolveConfig(settings);
  if (config.provider === 'none') return false;
  if (!config.model || !config.baseUrl) return false;
  if (config.provider === 'openai' && !config.apiKey) return false;
  return true;
}

/* Разбирает поток по строкам: подходит и для NDJSON (Ollama), и для SSE (OpenAI). */
function createLineParser(onLine) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) onLine(line);
        index = buffer.indexOf('\n');
      }
    },
    flush() {
      const line = buffer.trim();
      buffer = '';
      if (line) onLine(line);
    },
  };
}

function parseOllamaLine(line) {
  const data = JSON.parse(line);
  if (data.error) throw new LlmError('provider', String(data.error));
  return data.message && data.message.content ? data.message.content : '';
}

function parseOpenAiLine(line) {
  const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
  if (!payload || payload === '[DONE]') return '';
  const data = JSON.parse(payload);
  if (data.error) throw new LlmError('provider', String(data.error.message || data.error));
  const choice = (data.choices || [])[0];
  if (!choice) return '';
  if (choice.delta && choice.delta.content) return choice.delta.content;
  if (choice.message && choice.message.content) return choice.message.content;
  return '';
}

/* Гонка «ответ против отмены»: позволяет прервать даже заглушку, которая не следит за сигналом. */
function raceAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new LlmError('aborted', 'Запрос отменён'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new LlmError('aborted', 'Запрос отменён'));
    if (typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        if (typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        if (typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export function createLlm(ctx) {
  let mock = null;

  function config() {
    return resolveConfig(ctx.settings);
  }

  function setMock(handler) {
    mock = handler;
  }

  function clearMock() {
    mock = null;
  }

  function headers(cfg) {
    const result = { 'Content-Type': 'application/json' };
    if (cfg.provider === 'openai' && cfg.apiKey) result.Authorization = `Bearer ${cfg.apiKey}`;
    return result;
  }

  function endpoint(cfg) {
    if (cfg.provider === 'ollama') return `${cfg.baseUrl}/api/chat`;
    return `${cfg.baseUrl}/v1/chat/completions`;
  }

  function payload(cfg, messages, stream) {
    if (cfg.provider === 'ollama') {
      return {
        model: cfg.model,
        messages,
        stream,
        options: { temperature: cfg.temperature, num_predict: cfg.maxTokens },
      };
    }
    return {
      model: cfg.model,
      messages,
      stream,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
    };
  }

  /* Ошибки сети и HTTP превращаем в понятный текст с подсказкой. */
  function describeError(error, cfg) {
    if (error instanceof LlmError) return error;
    if (error && error.name === 'AbortError') return new LlmError('aborted', 'Запрос отменён');
    const hint = cfg.meta.hint ? ` Подсказка: ${cfg.meta.hint}` : '';
    if (error instanceof TypeError || (error && error.name === 'TypeError')) {
      return new LlmError(
        'network',
        `Не удалось связаться с ${cfg.baseUrl}. Проверьте, что сервер модели запущен и разрешает запросы из браузера.${hint}`,
        error.message,
      );
    }
    return new LlmError('unknown', `Ошибка запроса: ${error && error.message ? error.message : error}.${hint}`);
  }

  /* Читает поток ответа и складывает куски текста; каждый кусок сразу уходит в onToken. */
  async function readStream(response, cfg, onToken) {
    const parse = cfg.provider === 'ollama' ? parseOllamaLine : parseOpenAiLine;
    let full = '';
    const parser = createLineParser((line) => {
      let chunk = '';
      try {
        chunk = parse(line);
      } catch (error) {
        if (error instanceof SyntaxError) return; // неполная строка или служебный мусор
        throw error;
      }
      if (!chunk) return;
      full += chunk;
      if (onToken) onToken(chunk);
    });

    if (!response.body || typeof response.body.getReader !== 'function') {
      parser.push(`${await response.text()}\n`);
      parser.flush();
      return full;
    }

    const reader = response.body.getReader();
    const Decoder = typeof TextDecoder === 'function' ? TextDecoder : null;
    if (!Decoder) throw new LlmError('unsupported', 'Браузер не поддерживает потоковое чтение ответа (TextDecoder).');
    const decoder = new Decoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.flush();
    return full;
  }

  async function chat({ messages, onToken = null, signal = null }) {
    const cfg = config();

    if (mock) {
      const pending = Promise.resolve(mock({ messages, model: cfg.model, provider: cfg.provider, signal }));
      pending.catch(() => {}); // заглушка может не успеть — не оставляем необработанную ошибку
      const answer = signal ? await raceAbort(pending, signal) : await pending;
      const text = String(answer || '');
      const parts = text.match(/[\s\S]{1,24}/g) || [];
      let full = '';
      for (const part of parts) {
        if (signal && signal.aborted) throw new LlmError('aborted', 'Запрос отменён');
        full += part;
        if (onToken) onToken(part);
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
      return full;
    }

    if (cfg.provider === 'none') {
      throw new LlmError('no-provider', 'Модель не выбрана. Откройте «Настройки» и укажите провайдера и модель.');
    }

    let response;
    try {
      response = await fetch(endpoint(cfg), {
        method: 'POST',
        headers: headers(cfg),
        body: JSON.stringify(payload(cfg, messages, true)),
        signal: signal || undefined,
      });
    } catch (error) {
      throw describeError(error, cfg);
    }

    if (!response.ok) {
      let body = '';
      try {
        body = (await response.text()).slice(0, 400);
      } catch (error) {
        body = '';
      }
      throw new LlmError('http', `Сервер модели ответил ${response.status}.`, body);
    }

    try {
      return await readStream(response, cfg, onToken);
    } catch (error) {
      throw describeError(error, cfg);
    }
  }

  /* Анализ локального снимка: данные изображения отправляются только выбранному провайдеру. */
  async function analyzeImage({ base64, mimeType = 'image/png', question = 'Опиши содержимое изображения.', signal = null } = {}) {
    const cfg = config();
    if (cfg.provider === 'none') {
      throw new LlmError('no-provider', 'Модель не выбрана. Откройте «Настройки» и укажите провайдера и модель.');
    }
    if (!['image/png', 'image/jpeg'].includes(mimeType)) {
      throw new LlmError('invalid-image', 'Поддерживаются только PNG и JPEG.');
    }
    const encoded = String(base64 || '').trim();
    const maxBytes = 5 * 1024 * 1024;
    if (encoded.length > Math.ceil(maxBytes / 3) * 4) {
      throw new LlmError('image-too-large', 'Изображение больше 5 МиБ.');
    }
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    const contentLength = encoded.length - padding;
    const validBase64 = encoded.length > 0
      && encoded.length % 4 === 0
      && !/[^A-Za-z0-9+/=]/.test(encoded)
      && !encoded.slice(0, contentLength).includes('=')
      && (padding === 0 || (padding === 1 && contentLength % 4 === 3) || (padding === 2 && contentLength % 4 === 2));
    if (!validBase64) throw new LlmError('invalid-image', 'Изображение имеет неверный формат base64.');
    const imageBytes = encoded.length * 3 / 4 - padding;
    if (imageBytes > maxBytes) throw new LlmError('image-too-large', 'Изображение больше 5 МиБ.');
    const prompt = String(question || '').trim();
    if (!prompt) throw new LlmError('invalid-prompt', 'Укажите, что нужно проверить на снимке.');
    if (prompt.length > 2000) throw new LlmError('prompt-too-long', 'Вопрос к изображению не должен превышать 2000 символов.');

    if (mock) {
      const pending = Promise.resolve(mock({
        mode: 'image', imageBase64: encoded, mimeType, question: prompt,
        model: cfg.model, provider: cfg.provider, signal,
      }));
      pending.catch(() => {});
      const answer = signal ? await raceAbort(pending, signal) : await pending;
      return String(answer ?? '');
    }

    const messages = cfg.provider === 'ollama'
      ? [{ role: 'user', content: prompt, images: [encoded] }]
      : [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${encoded}` } },
      ] }];
    const body = cfg.provider === 'ollama'
      ? { model: cfg.model, stream: false, messages, options: { temperature: cfg.temperature, num_predict: cfg.maxTokens } }
      : { model: cfg.model, stream: false, messages, temperature: cfg.temperature, max_tokens: cfg.maxTokens };

    let response;
    try {
      response = await fetch(endpoint(cfg), {
        method: 'POST', headers: headers(cfg), body: JSON.stringify(body), signal: signal || undefined,
      });
    } catch (error) {
      throw describeError(error, cfg);
    }
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.text()).slice(0, 400); } catch (error) { detail = ''; }
      if ([400, 415, 422].includes(response.status)) {
        throw new LlmError('unsupported-image', `Провайдер отклонил изображение (HTTP ${response.status}). Проверьте, что выбранная модель поддерживает vision.`, detail);
      }
      throw new LlmError('http', `Сервер модели ответил ${response.status}.`, detail);
    }
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new LlmError('provider', 'Сервер модели вернул некорректный JSON.');
    }
    if (data.error) {
      const detail = String(data.error.message || data.error).slice(0, 400);
      if (/(image|vision|multimodal|изображ|картин)/i.test(detail)) {
        throw new LlmError('unsupported-image', 'Провайдер или выбранная модель не поддерживает анализ изображений. Выберите vision-модель.', detail);
      }
      throw new LlmError('provider', `Ошибка провайдера: ${detail}`, detail);
    }
    const text = cfg.provider === 'ollama'
      ? data.message?.content
      : data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new LlmError('provider', 'Модель не вернула анализ изображения. Проверьте, что выбранная модель поддерживает vision.');
    }
    return text;
  }

  /* Проверка соединения: короткий запрос к модели. */
  async function test() {
    const cfg = config();
    if (cfg.provider === 'none') throw new LlmError('no-provider', 'Сначала выберите провайдера.');
    if (mock) return { ok: true, provider: cfg.provider, model: cfg.model, text: 'проверка заглушкой' };

    if (cfg.provider === 'ollama') {
      let response;
      try {
        response = await fetch(`${cfg.baseUrl}/api/tags`);
      } catch (error) {
        throw describeError(error, cfg);
      }
      if (!response.ok) throw new LlmError('http', `Сервер ответил ${response.status}.`);
      const data = await response.json();
      const names = (data.models || []).map((item) => item.name);
      return {
        ok: true,
        provider: cfg.provider,
        model: cfg.model,
        text: names.length
          ? `доступны модели: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}`
          : 'сервер отвечает, список моделей пуст',
      };
    }

    const text = await chat({
      messages: [
        { role: 'system', content: 'Ответь одним словом.' },
        { role: 'user', content: 'ping' },
      ],
    });
    return { ok: true, provider: cfg.provider, model: cfg.model, text: text.slice(0, 120) || 'пустой ответ' };
  }

  return {
    chat,
    analyzeImage,
    test,
    setMock,
    clearMock,
    get config() {
      return config();
    },
    isConfigured: () => isConfigured(ctx.settings),
  };
}
