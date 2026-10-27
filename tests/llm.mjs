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

process.exit(result() ? 1 : 0);
