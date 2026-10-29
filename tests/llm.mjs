/* Проверки клиента нейросети: поток Ollama и OpenAI, отмена, ошибки, промпты, проверка соединения. */

import { bootApp, reporter, wait } from './harness.mjs';

const { check, result } = reporter('Нейросеть');

const OLLAMA = { provider: 'ollama', model: 'qwen2.5-coder:7b', baseUrl: 'http://localhost:11434' };
const OPENAI = { provider: 'openai', model: 'gpt-test', baseUrl: 'https://api.example.com', apiKey: 'sk-test' };

function streamFrom(chunks) {
  let index = 0;
  return {
    getReader: () => ({
      read: async () => (index < chunks.length
        ? { value: new TextEncoder().encode(chunks[index++]), done: false }
        : { value: undefined, done: true }),
    }),
  };
}

await check('поток NDJSON от Ollama', async () => {
  const { window, K } = await bootApp(OLLAMA);
  let url = null;
  window.fetch = async (target) => {
    url = target;
    return {
      ok: true,
      status: 200,
      body: streamFrom([
        '{"message":{"content":"При"},"done":false}\n',
        '{"message":{"content":"вет"},"done":false}\n',
        '{"message":{"content":""},"done":true}\n',
      ]),
    };
  };
  const text = await K.llm.chat({ messages: [{ role: 'user', content: 'тест' }] });
  if (text !== 'Привет') throw new Error(`собрано «${text}»`);
  if (url !== 'http://localhost:11434/api/chat') throw new Error(`неверный адрес: ${url}`);
  return text;
});

await check('поток SSE от OpenAI-совместимого API', async () => {
  const { window, K } = await bootApp(OPENAI);
  let captured = null;
  window.fetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      body: streamFrom([
        'data: {"choices":[{"delta":{"content":"При"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"вет"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    };
  };
  const tokens = [];
  const text = await K.llm.chat({ messages: [{ role: 'user', content: 'привет' }], onToken: (t) => tokens.push(t) });
  if (text !== 'Привет') throw new Error(`собрано «${text}»`);
  if (tokens.join('') !== 'Привет') throw new Error('onToken не получал куски');
  if (captured.url !== 'https://api.example.com/v1/chat/completions') throw new Error(`адрес: ${captured.url}`);
  if (captured.options.headers.Authorization !== 'Bearer sk-test') throw new Error('нет авторизации');
  const body = JSON.parse(captured.options.body);
  if (!body.stream || body.model !== 'gpt-test' || body.temperature === undefined) throw new Error('тело запроса неполное');
  return text;
});

await check('ошибка сети объясняется с подсказкой', async () => {
  const { window, K } = await bootApp(OLLAMA);
  window.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try {
    await K.llm.chat({ messages: [{ role: 'user', content: 'x' }] });
    throw new Error('ошибки не было');
  } catch (error) {
    if (error.code !== 'network') throw new Error(`код ${error.code}`);
    if (!error.message.includes('OLLAMA_ORIGINS')) throw new Error('нет подсказки про CORS');
    return error.message.slice(0, 60);
  }
});

await check('HTTP-ошибка показывает статус и тело', async () => {
  const { window, K } = await bootApp(OLLAMA);
  window.fetch = async () => ({ ok: false, status: 404, text: async () => 'model "qwen" not found' });
  try {
    await K.llm.chat({ messages: [{ role: 'user', content: 'x' }] });
    throw new Error('ошибки не было');
  } catch (error) {
    if (error.code !== 'http' || !error.message.includes('404')) throw new Error(error.message);
    if (!error.detail.includes('not found')) throw new Error('нет тела ответа');
    return error.message;
  }
});

await check('битый JSON в потоке не роняет запрос', async () => {
  const { window, K } = await bootApp(OLLAMA);
  window.fetch = async () => ({
    ok: true,
    status: 200,
    body: streamFrom(['{"message":{"content":"А"}', '}\n', 'мусор без json\n', '{"message":{"content":"Б"}}\n']),
  });
  const text = await K.llm.chat({ messages: [{ role: 'user', content: 'x' }] });
  if (text !== 'АБ') throw new Error(`собрано «${text}»`);
  return text;
});

await check('без провайдера — ошибка no-provider', async () => {
  const { K } = await bootApp();
  try {
    await K.llm.chat({ messages: [{ role: 'user', content: 'x' }] });
    throw new Error('ошибки не было');
  } catch (error) {
    if (error.code !== 'no-provider') throw new Error(error.code);
    return true;
  }
});

await check('isConfigured учитывает ключ и модель', async () => {
  const { K } = await bootApp({ provider: 'openai', model: 'gpt', baseUrl: 'https://api.example.com' });
  if (K.llm.isConfigured()) throw new Error('без ключа должно быть false');
  K.updateSettings({ apiKey: 'sk-x' });
  if (!K.llm.isConfigured()) throw new Error('с ключом должно быть true');
  return true;
});

await check('проверка соединения с Ollama', async () => {
  const { window, K } = await bootApp(OLLAMA);
  let url = null;
  window.fetch = async (target) => {
    url = target;
    return { ok: true, json: async () => ({ models: [{ name: 'qwen2.5-coder:7b' }, { name: 'llama3:8b' }] }) };
  };
  const value = await K.llm.test();
  if (!url.endsWith('/api/tags')) throw new Error(`адрес: ${url}`);
  if (!value.text.includes('qwen2.5-coder:7b')) throw new Error('нет списка моделей');
  return value.text;
});

await check('потоковый ответ отрисовывается в чате с markdown', async () => {
  const { window, doc, K } = await bootApp(OLLAMA);
  K.llm.setMock(async ({ messages }) => {
    const hasFile = messages.some((message) => message.content.includes('src/utils.js'));
    return `### Итог\n- файл в контексте: ${hasFile ? 'да' : 'нет'}\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n`;
  });
  const row = Array.from(doc.querySelectorAll('.tree-row')).find((item) => item.dataset.path === 'src/utils.js');
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  doc.querySelector('#chat-input').value = 'Что в файле?';
  doc.querySelector('#chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(1200);

  const messages = Array.from(doc.querySelectorAll('.chat-msg'));
  const last = messages[messages.length - 1];
  if (!last.textContent.includes('файл в контексте: да')) throw new Error('нет ответа модели');
  if (!last.querySelector('.md-code')) throw new Error('блок кода не отрисован');
  if (!last.querySelector('.md-copy')) throw new Error('нет кнопки копирования');
  if (!last.querySelector('li')) throw new Error('список не отрисован');
  return 'markdown + код + контекст файла';
});

await check('отмена запроса кнопкой «Остановить»', async () => {
  const { window, doc, K } = await bootApp(OLLAMA);
  K.llm.setMock(() => new Promise((resolve) => setTimeout(() => resolve('долгий ответ'), 4000)));
  doc.querySelector('#chat-input').value = 'тест отмены';
  doc.querySelector('#chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(150);
  const stop = doc.querySelector('#chat-stop');
  if (stop.hidden) throw new Error('кнопка «Остановить» не появилась');
  stop.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(150);
  if (doc.querySelector('#chat-send').disabled) throw new Error('кнопка отправки осталась заблокированной');
  return true;
});

await check('промпт: система, файл, история, вопрос', async () => {
  const { buildMessages, MAX_CONTEXT_CHARS } = await import('../js/prompts.js');
  const messages = buildMessages({
    prompt: 'Что не так?',
    history: [{ role: 'user', text: 'привет' }, { role: 'assistant', text: 'здравствуйте' }],
    file: { path: 'src/utils.js', content: 'x'.repeat(MAX_CONTEXT_CHARS + 500) },
    projectName: 'demo',
  });
  if (messages[0].role !== 'system' || !messages[0].content.includes('Kaitos')) throw new Error('нет системного промпта');
  if (!messages[1].content.includes('src/utils.js')) throw new Error('нет контекста файла');
  if (messages[1].content.length > MAX_CONTEXT_CHARS + 400) throw new Error('контекст не обрезан');
  if (!messages.map((m) => m.role).join(',').endsWith('assistant,user')) throw new Error('неверный порядок ролей');
  if (messages[messages.length - 1].content !== 'Что не так?') throw new Error('вопрос потерялся');
  return `${messages.length} сообщений`;
});

await check('план утверждается и создаёт несколько файлов автономно', async () => {
  const { window, doc, K } = await bootApp(OLLAMA);
  let calls = 0;
  const plan = '```kaitos-plan\n{"title":"Мини-страница","steps":["Создать HTML","Добавить CSS"],"files":["tests/generated/index.html","tests/generated/app.css"]}\n```';
  const implementation = [
    'Создал страницу и стили.',
    '```kaitos-write tests/generated/index.html\n<main>Привет!</main>\n```',
    '```kaitos-write tests/generated/app.css\nmain { color: green; }\n```',
    '```kaitos-write README.md\n# неожиданное изменение\n```',
  ].join('\n');
  K.llm.setMock(async () => (++calls === 1 ? plan : implementation));

  doc.querySelector('#chat-plan-toggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  doc.querySelector('#chat-input').value = 'Создай простую страницу приветствия';
  doc.querySelector('#chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(500);

  const card = doc.querySelector('.plan-card');
  if (!card) throw new Error('план не показан');
  if (!card.textContent.includes('Мини-страница')) throw new Error(card.textContent);
  if (K.fs.has('tests/generated/index.html')) throw new Error('изменения применились до подтверждения плана');
  card.querySelector('[data-run-plan]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(700);

  if (!K.fs.read('tests/generated/index.html').includes('Привет!')) throw new Error('HTML не создан');
  if (!K.fs.read('tests/generated/app.css').includes('color: green')) throw new Error('CSS не создан');
  if (K.fs.read('README.md').includes('неожиданное изменение')) throw new Error('правка вне плана применена');
  if (!card.classList.contains('plan-card--done')) throw new Error('план не помечен выполненным');
  if (!card.textContent.includes('Выполнено частично')) throw new Error('не показана блокировка файла вне плана');
  if (calls !== 2) throw new Error(`вызовов модели ${calls}`);
  return 'два согласованных файла созданы, лишняя правка заблокирована';
});

await check('markdown экранирует HTML', async () => {
  const { renderMarkdown } = await import('../js/markdown.js');
  const html = renderMarkdown('<img src=x onerror=alert(1)> и `a < b`');
  if (html.includes('<img')) throw new Error('HTML не экранирован');
  if (!html.includes('&lt;img')) throw new Error('неверное экранирование');
  return true;
});

await check('OpenAI-совместимый провайдер получает изображение как data URL', async () => {
  const { window, K } = await bootApp(OPENAI);
  let captured = null;
  window.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'На снимке окно редактора.' } }] }) };
  };
  const answer = await K.llm.analyzeImage({ base64: 'aGVsbG8=', mimeType: 'image/png', question: 'Что видно?' });
  const body = JSON.parse(captured.options.body);
  const content = body.messages[0].content;
  if (answer !== 'На снимке окно редактора.') throw new Error(answer);
  if (!captured.url.endsWith('/v1/chat/completions') || body.stream !== false) throw new Error('неверный endpoint или потоковый режим');
  if (content[0].text !== 'Что видно?' || content[1].image_url.url !== 'data:image/png;base64,aGVsbG8=') throw new Error(JSON.stringify(content));
  return answer;
});

await check('Ollama получает изображение в поле images', async () => {
  const { window, K } = await bootApp(OLLAMA);
  let payload = null;
  window.fetch = async (url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ message: { content: 'Скриншот читаемый.' } }) };
  };
  const answer = await K.llm.analyzeImage({ base64: 'aGVsbG8=', mimeType: 'image/jpeg', question: 'Опиши экран' });
  if (answer !== 'Скриншот читаемый.') throw new Error(answer);
  if (payload.messages[0].images[0] !== 'aGVsbG8=' || payload.stream !== false) throw new Error(JSON.stringify(payload));
  return answer;
});

await check('веб-поиск показывает только проверяемые источники', async () => {
  const { window, doc, K } = await bootApp(OPENAI);
  K.api = { search: async (query) => ({ query, results: [
    { title: 'Источник', url: 'https://example.org/a', snippet: 'Фрагмент результата' },
    { title: 'Небезопасно', url: 'javascript:alert(1)', snippet: 'не показывать' },
  ] }) };
  K.llm.setMock(async () => 'Краткий ответ со ссылкой [1].');
  doc.querySelector('#chat-search-toggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  doc.querySelector('#chat-input').value = 'Вопрос';
  doc.querySelector('#chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(500);
  const result = doc.querySelector('.search-result__title');
  if (!result || result.href !== 'https://example.org/a') throw new Error('источник не показан');
  if (doc.querySelectorAll('.search-result').length !== 1) throw new Error('небезопасная ссылка показана');
  if (!doc.querySelector('#chat-messages').textContent.includes('[1]')) throw new Error('нет сводки модели');
  return result.href;
});

await check('кнопка снимка анализирует только полученное API-изображение', async () => {
  const { window, doc, K } = await bootApp(OPENAI);
  K.storage = { mode: 'disk' };
  let requested = null;
  K.api = { screenshot: async (options) => {
    requested = options;
    return { imageBase64: 'aGVsbG8=', mimeType: 'image/png', width: 800, height: 600 };
  } };
  K.llm.setMock(async ({ mode, question, imageBase64 }) => {
    if (mode !== 'image' || imageBase64 !== 'aGVsbG8=' || !question.includes('Опиши')) throw new Error('неверные аргументы анализа');
    return 'На снимке — локальная страница.';
  });
  doc.querySelector('#chat-screenshot').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(500);
  if (!requested || requested.url !== 'http://localhost:5173') throw new Error(JSON.stringify(requested));
  if (!doc.querySelector('.chat-screenshot-preview')) throw new Error('предпросмотр снимка не показан');
  if (!doc.querySelector('#chat-messages').textContent.includes('На снимке — локальная страница.')) throw new Error('ответ модели отсутствует');
  return `${requested.width}×${requested.height}`;
});

await check('ошибка HTTP анализа изображения читаема', async () => {
  const { window, K } = await bootApp(OPENAI);
  window.fetch = async () => ({ ok: false, status: 413, text: async () => 'payload too large' });
  try {
    await K.llm.analyzeImage({ base64: 'aGVsbG8=', mimeType: 'image/png' });
    throw new Error('HTTP-ошибка не показана');
  } catch (error) {
    if (error.code !== 'http' || !error.message.includes('413') || !error.detail.includes('too large')) throw new Error(JSON.stringify(error));
    return error.message;
  }
});

await check('провайдер явно сообщает, если модель не принимает изображение', async () => {
  const { window, K } = await bootApp(OPENAI);
  window.fetch = async () => ({ ok: false, status: 400, text: async () => 'model does not support image input' });
  try {
    await K.llm.analyzeImage({ base64: 'aGVsbG8=' });
    throw new Error('ошибка поддержки изображения скрыта');
  } catch (error) {
    if (error.code !== 'unsupported-image' || !error.message.includes('vision') || !error.detail.includes('support image')) throw new Error(error.message);
    return error.message;
  }
});

await check('анализ изображения ограничивает размер и длину вопроса', async () => {
  const { window, K } = await bootApp(OPENAI);
  let sent = false;
  window.fetch = async () => { sent = true; return { ok: true, json: async () => ({}) }; };
  const tooLarge = 'A'.repeat(7 * 1024 * 1024);
  try {
    await K.llm.analyzeImage({ base64: tooLarge });
    throw new Error('слишком большое изображение принято');
  } catch (error) {
    if (error.code !== 'image-too-large') throw new Error(error.code);
  }
  try {
    await K.llm.analyzeImage({ base64: 'aGVsbG8=', question: 'x'.repeat(2001) });
    throw new Error('слишком длинный вопрос принят');
  } catch (error) {
    if (error.code !== 'prompt-too-long') throw new Error(error.code);
  }
  if (sent) throw new Error('невалидное изображение отправили провайдеру');
  return 'больше 5 МиБ и вопрос длиннее 2000 символов отклонены до fetch';
});

await check('модель без поддержки vision возвращает понятную ошибку', async () => {
  const { window, K } = await bootApp(OPENAI);
  window.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '' } }] }) });
  try {
    await K.llm.analyzeImage({ base64: 'aGVsbG8=' });
    throw new Error('пустой ответ принят');
  } catch (error) {
    if (error.code !== 'provider' || !error.message.includes('vision')) throw new Error(error.message);
    return error.message;
  }
});

await check('анализ изображения отклоняет неподдерживаемый формат', async () => {
  const { K } = await bootApp(OPENAI);
  try {
    await K.llm.analyzeImage({ base64: 'aGVsbG8=', mimeType: 'image/gif' });
    throw new Error('GIF принят');
  } catch (error) {
    if (error.code !== 'invalid-image') throw new Error(error.code);
    return error.code;
  }
});

process.exit(result() ? 1 : 0);
